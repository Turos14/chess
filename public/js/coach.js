/* Hulotte, la chouette qui commente les parties enregistrées (écran de revue, records.js).
 * Analyse : Stockfish à pleine force sur chaque position de la ligne principale (ANALYSIS_MS par position),
 * résultats bruts gardés dans l'enregistrement (rec.analysis = {v, evals[]}) pour ne pas recalculer, et reprise
 * possible d'une analyse interrompue. Classement des coups, bilan et commentaires : analysis.js (module pur).
 * records.js appelle : open(rec, hooks), show(ply, mainLine), decorate(span, i), stop(). */
(function () {
  'use strict';
  var C = window.Coach = {};
  var ANALYSIS_MS = 350;

  // st : {rec, hooks {save(), goto(ply), names()}, result (Analysis.analyse) | null, run {handle, i, stopped} | null, ply, mainLine}
  var st = null;

  var OWL = '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M14 14 L20 24 L26 18 Z M50 14 L44 24 L38 18 Z" fill="#7a5230"/>' +
    '<ellipse cx="32" cy="38" rx="20" ry="22" fill="#8b5e34"/>' +
    '<ellipse cx="32" cy="45" rx="12" ry="13" fill="#e8cfa4"/>' +
    '<path d="M24 42 q2 2 4 0 M30 47 q2 2 4 0 M36 42 q2 2 4 0 M27 52 q2 2 4 0 M33 52 q2 2 4 0" stroke="#b48a5a" stroke-width="1.2" fill="none"/>' +
    '<circle cx="23" cy="29" r="9" fill="#f6efe2"/><circle cx="41" cy="29" r="9" fill="#f6efe2"/>' +
    '<circle class="pupil" cx="23" cy="29" r="4"/><circle class="pupil" cx="41" cy="29" r="4"/>' +
    '<circle cx="24.5" cy="27.5" r="1.3" fill="#fff"/><circle cx="42.5" cy="27.5" r="1.3" fill="#fff"/>' +
    '<path d="M29 35 L35 35 L32 41 Z" fill="#f2a33a"/>' +
    '<path d="M22 58 l-3 4 M26 59 l0 4 M38 59 l0 4 M42 58 l3 4" stroke="#f2a33a" stroke-width="2"/>' +
    '</svg>';

  function $(id) { return U.$(id); }
  function names() { return st.hooks.names(); }

  function positions(rec) {
    var g = Chess.replay(rec.startFen, rec.moves);
    return g ? g.fens : [rec.startFen];
  }

  function stored(rec) {
    var a = rec.analysis, n = rec.moves.length + 1;
    if (!a || a.v !== 1 || !a.evals || a.evals.length !== n) return null;
    return a.evals;
  }

  // Analyse faite avant l'ajout des variantes (pv) : commentaires moins détaillés, on propose de la refaire.
  function outdated(rec) {
    var e = stored(rec);
    return !!e && e.some(function (x) { return x && !x.pv; });
  }

  function compute() {
    var evals = stored(st.rec);
    st.result = evals ? Analysis.analyse(st.rec.startFen, st.rec.moves, evals) : null;
  }

  C.open = function (rec, hooks) {
    C.stop();
    st = { rec: rec, hooks: hooks, result: null, run: null, ply: 0, mainLine: true };
    $('rv-owl').innerHTML = OWL;
    compute();
    render();
  };

  C.stop = function () {
    if (!st || !st.run) return;
    var run = st.run;
    run.stopped = true;
    run.finish(false);     // garde ce qui est déjà calculé : l'analyse pourra reprendre plus tard
  };

  // Le coach est-il en train d'analyser ? (records.js : bloque la création de branches pendant ce temps)
  C.busy = function () { return !!(st && st.run); };

  C.show = function (ply, mainLine) {
    if (!st) return;
    st.ply = ply; st.mainLine = mainLine;
    render();
  };

  // Ajoute au coup n° i (0 = 1er coup) de la ligne principale sa classe et son symbole (?? ? ?! ★).
  C.decorate = function (span, i) {
    if (!st || !st.result) return;
    var m = st.result.moves[i];
    if (!m || !m.cls) return;
    U.addClass(span, 'c-' + m.cls);
    var sym = Analysis.CLASSES[m.cls].sym;
    if (sym) span.appendChild(U.el('sup', 'csym', sym));
  };

  /* ---------- Analyse ---------- */
  function start() {
    if (!st || st.run) return;
    if (!Engine.supported()) { U.toast('Analyse indisponible sur ce navigateur (Web Worker).'); return; }
    var rec = st.rec, fens = positions(rec), n = fens.length;
    var evals = (!outdated(rec) && rec.analysis && rec.analysis.v === 1 && rec.analysis.evals && rec.analysis.evals.length === n) ? rec.analysis.evals.slice() : [];
    while (evals.length < n) evals.push(null);
    var run = st.run = { handle: null, i: 0, n: n, stopped: false, ended: false, finish: finish };
    var mine = st;
    render();
    function finish(complete) {
      if (run.ended) return;
      run.ended = true;
      if (run.handle) { run.handle.destroy(); run.handle = null; }
      if (mine.run === run) mine.run = null;
      rec.analysis = { v: 1, ms: ANALYSIS_MS, evals: evals };
      mine.hooks.save();
      if (st !== mine) return;
      compute();
      if (complete) { U.fx('end'); st.hooks.goto(0); }
      render();
      st.hooks.refreshMoves();
    }
    function next() {
      if (run.stopped) { finish(false); return; }
      while (run.i < n && (evals[run.i] || new Chess.Game(fens[run.i]).status().over)) run.i++;
      if (run.i >= n) { finish(true); return; }
      progress();
      run.handle.analyse(fens[run.i], ANALYSIS_MS, function (ev) {
        if (run.stopped) { finish(false); return; }
        evals[run.i] = ev || { cp: 0, best: null };
        run.i++;
        next();
      });
    }
    Engine.create(function (err, h) {
      if (run.stopped) { if (h) h.destroy(); return; }
      if (err) { if (mine.run === run) mine.run = null; U.toast(err.message); render(); return; }
      run.handle = h;
      next();
    });
  }

  function progress() {
    if (!st || !st.run) return;
    var r = st.run, pct = Math.round(100 * r.i / Math.max(1, r.n));
    $('rv-bubble').textContent = 'Je réfléchis… hou hou. Position ' + Math.min(r.i + 1, r.n) + ' / ' + r.n + ' (' + pct + ' %)';
  }

  /* ---------- Rendu ---------- */
  function setMood(m) {
    var box = $('rv-coach');
    ['happy', 'shock', 'proud', 'think'].forEach(function (k) { U.toggleClass(box, 'mood-' + k, k === m); });
    // Pupilles : petites quand elle est choquée, grandes quand elle est fière (attribut SVG : fiable sur vieux Safari)
    var pupils = box.getElementsByClassName('pupil'), i, r = m === 'shock' ? '2.2' : m === 'proud' ? '5' : '4';
    for (i = 0; i < pupils.length; i++) pupils[i].setAttribute('r', r);
  }

  function render() {
    if (!st) return;
    var r = st.result, run = st.run, bubble = $('rv-bubble');
    var old = outdated(st.rec);
    $('rv-analyse').style.display = run ? 'none' : (r && r.complete && !old ? 'none' : 'block');
    $('rv-analyse').textContent = old ? 'Refaire l’analyse (explications détaillées)' : st.rec.analysis ? 'Reprendre l’analyse' : 'Analyser avec ' + Analysis.COACH;
    $('rv-analyse-stop').style.display = run ? 'block' : 'none';
    $('rv-keys').style.display = r && !run ? 'flex' : 'none';
    renderGraph();
    if (run) { setMood('think'); progress(); return; }
    if (!r) {
      setMood('happy');
      bubble.textContent = 'Hou hou ! Je suis ' + Analysis.COACH + '. Veux-tu que j’analyse cette partie ? Je repérerai les ' +
        'meilleurs coups, les erreurs et les moments clés (environ ' + Math.ceil(st.rec.moves.length * ANALYSIS_MS / 1000) + ' s).';
      return;
    }
    if (!st.mainLine) { setMood('happy'); bubble.textContent = 'Je ne commente que la ligne principale de la partie.'; return; }
    var keys = r.keyPlies;
    $('rv-key-prev').disabled = !keys.some(function (k) { return k < st.ply; });
    $('rv-key-next').disabled = !keys.some(function (k) { return k > st.ply; });
    if (st.ply === 0) {
      setMood('happy');
      bubble.textContent = r.complete ? Analysis.summary(r, names()) : 'Analyse incomplète : touche « Reprendre l’analyse ».';
      return;
    }
    var m = r.moves[st.ply - 1];
    setMood(!m || !m.cls ? 'happy' : (m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'miss') ? 'shock' : m.cls === 'best' ? 'proud' : 'happy');
    bubble.textContent = Analysis.comment(m, names());   // le commentaire annonce déjà la catégorie du coup
  }

  // Courbe des chances de gain des Blancs (zone claire) au fil de la partie ; trait vertical = position affichée,
  // traits rouges = moments clés. Toucher la courbe y amène.
  function renderGraph() {
    var box = $('rv-graph'), r = st.result;
    if (!r) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    var c = r.curve, n = Math.max(1, c.length - 1), i, d = 'M0,40';
    for (i = 0; i < c.length; i++) d += ' L' + (i / n * 100).toFixed(2) + ',' + (40 - c[i] * 0.4).toFixed(2);
    d += ' L100,40 Z';
    var marks = r.keyPlies.map(function (k) { return '<rect x="' + (k / n * 100 - 0.4).toFixed(2) + '" y="0" width="0.8" height="40" fill="#ff5a5a"/>'; }).join('');
    var cur = st.mainLine ? '<rect x="' + (Math.min(st.ply, n) / n * 100 - 0.5).toFixed(2) + '" y="0" width="1" height="40" fill="#3d7eff"/>' : '';
    box.innerHTML = '<svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">' +
      '<rect width="100" height="40" fill="#3a3d46"/><path d="' + d + '" fill="#e9e9e9"/>' +
      '<rect y="19.8" width="100" height="0.4" fill="#888"/>' + marks + cur + '</svg>';
  }

  function jumpKey(dir) {
    if (!st || !st.result) return;
    var keys = st.result.keyPlies, i, target = null;
    for (i = 0; i < keys.length; i++) {
      if (dir > 0 && keys[i] > st.ply) { target = keys[i]; break; }
      if (dir < 0 && keys[i] < st.ply) target = keys[i];
    }
    if (target !== null) st.hooks.goto(target);
  }

  C.OWL = OWL;

  C.init = function () {
    U.on($('rv-analyse'), 'click', start);
    U.on($('rv-analyse-stop'), 'click', function () { C.stop(); render(); });
    U.on($('rv-key-prev'), 'click', function () { jumpKey(-1); });
    U.on($('rv-key-next'), 'click', function () { jumpKey(1); });
    U.on($('rv-graph'), 'click', function (ev) {
      if (!st || !st.result) return;
      var rect = this.getBoundingClientRect(), n = st.result.curve.length - 1;
      if (!rect.width) return;
      st.hooks.goto(Math.round((ev.clientX - rect.left) / rect.width * n));
    });
  };
})();
