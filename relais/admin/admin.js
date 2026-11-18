(function () {
  'use strict';

  var API = '/api/admin';
  var SITE = 'https://turos14.github.io/chess/';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- utilitaires DOM (tout texte via textContent) ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  var flashTimer = null;
  function flash(msg, ok) {
    var f = $('flash');
    f.textContent = msg;
    f.className = 'flash ' + (ok ? 'ok' : 'err');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.className = 'flash hidden'; }, ok ? 8000 : 15000);
  }

  // ---------- API ----------
  function api(action, opts) {
    opts = opts || {};
    var init = { credentials: 'same-origin', headers: {} };
    var url = API + '?a=' + encodeURIComponent(action);
    if (opts.query) for (var k in opts.query) url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]);
    if (opts.body !== undefined || opts.post) {
      init.method = 'POST';
      init.headers['X-Admin'] = '1';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body || {});
    }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && action !== 'login') { showLogin(); }
        if (!r.ok) {
          var err = new Error(data.error || ('Erreur ' + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- connexion ----------
  var loaded = { mod: false, live: false, stats: false, log: false };

  function showLogin(msg) {
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('pw').value = '';
    $('loginError').textContent = msg || '';
    loaded = { mod: false, live: false, stats: false, log: false };
    if (typeof resetLive === 'function') resetLive();
    clear($('queue')); clear($('stats')); clear($('log'));
  }
  function showApp() {
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    selectTab('mod');
    if (!live.fetchedAt) loadLive();   // pour le badge « en cours » (puis rafraîchi seulement quand l'onglet est ouvert)
  }

  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('loginBtn');
    btn.disabled = true;
    $('loginError').textContent = '';
    api('login', { body: { password: $('pw').value } }).then(function () {
      showApp();
    }).catch(function (e) {
      var m;
      if (e.status === 401) m = 'Mot de passe incorrect.';
      else if (e.status === 429) m = 'Trop d’essais : réessayez dans un moment.';
      else if (e.status === 503) m = 'L’administration est désactivée (aucun mot de passe configuré sur le serveur).';
      else m = e.message || 'Connexion impossible.';
      $('loginError').textContent = m;
    }).then(function () { btn.disabled = false; });
  });

  $('logoutBtn').addEventListener('click', function () {
    api('logout', { post: true }).catch(function () {}).then(function () { showLogin(); });
  });

  // ---------- installation (appli dans sa propre fenêtre) ----------
  // Pas de service worker ici : la page affiche des données de modération, rien ne doit être gardé en cache.
  var installOffer = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installOffer = e;
    $('installBtn').classList.remove('hidden');
  });
  window.addEventListener('appinstalled', function () { installOffer = null; $('installBtn').classList.add('hidden'); });
  $('installBtn').addEventListener('click', function () {
    if (!installOffer) return;
    var o = installOffer;
    installOffer = null;
    $('installBtn').classList.add('hidden');
    o.prompt();
  });

  // ---------- onglets ----------
  function selectTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === name);
    ['mod', 'live', 'stats', 'log'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== name); });
    syncLive();
    if (!loaded[name]) {
      loaded[name] = true;
      if (name === 'mod') loadQueue();
      else if (name === 'live') { /* chargé par syncLive */ }
      else if (name === 'stats') setPreset(30);
      else loadLog();
    }
  }
  $('tabs').addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.tab') : null;
    if (t) selectTab(t.getAttribute('data-tab'));
  });

  // ---------- pièces et mini-échiquier ----------
  var KIND_LABEL = { propose: 'Proposition', edit: 'Modification', 'delete': 'Suppression' };

  function parseSolution(fen, raw) {
    // Retourne { ok, fens:[…], sans:[…], last:[from,to] par coup } ou { ok:false, text }
    var list = Array.isArray(raw) ? raw.map(String) : String(raw || '').trim().split(/\s+/).filter(Boolean);
    var text = list.join(' ');
    if (!window.Chess || !list.length) return { ok: false, text: text };
    try {
      var g = new window.Chess.Game(fen);
      var boards = [g.board().slice()], sans = [], moves = [];
      for (var i = 0; i < list.length; i++) {
        var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(list[i]);
        if (!m) return { ok: false, text: text };
        var rec = g.move(m[1].toLowerCase(), m[2].toLowerCase(), m[3] ? m[3].toLowerCase() : null);
        if (!rec) return { ok: false, text: text };
        sans.push(rec.san);
        moves.push([window.Chess.sqIndex(rec.from), window.Chess.sqIndex(rec.to)]);
        boards.push(g.board().slice());
      }
      return { ok: true, boards: boards, sans: sans, moves: moves, text: text, turn: window.Chess.parseFen(fen).turn };
    } catch (e) { return { ok: false, text: text }; }
  }

  function drawBoard(container, board, hl) {
    clear(container);
    for (var i = 0; i < 64; i++) {
      var sq = el('div', 'sq ' + (((i >> 3) + (i & 7)) % 2 ? 'd' : 'l') + (hl && (hl[0] === i || hl[1] === i) ? ' hl' : ''));
      if (board[i]) {
        var img = document.createElement('img');
        img.src = SITE + 'pieces/' + board[i] + '.svg';
        img.alt = board[i];
        img.draggable = false;
        sq.appendChild(img);
      }
      container.appendChild(sq);
    }
  }

  // Bloc « version d'un problème » : échiquier + solution rejouable.
  function puzzleBlock(fen, solutionRaw) {
    var wrap = el('div', 'pz');
    var board, parsed = null;
    var boardDiv = el('div', 'board');
    try {
      board = window.Chess.parseFen(fen);
    } catch (e) { board = null; }
    if (!board) {
      wrap.appendChild(el('p', 'warn', 'FEN illisible : ' + fen));
      return wrap;
    }
    wrap.appendChild(boardDiv);
    parsed = parseSolution(fen, solutionRaw);
    var idx = 0;
    drawBoard(boardDiv, board.board);
    if (parsed.ok) {
      var st = el('div', 'stepper');
      var prev = el('button', 'btn', '‹'), next = el('button', 'btn', '›'), pos = el('span', 'pos', 'Position de départ');
      prev.type = next.type = 'button';
      prev.setAttribute('aria-label', 'Coup précédent');
      next.setAttribute('aria-label', 'Coup suivant');
      st.appendChild(prev); st.appendChild(pos); st.appendChild(next);
      wrap.appendChild(st);
      var update = function () {
        drawBoard(boardDiv, parsed.boards[idx], idx ? parsed.moves[idx - 1] : null);
        pos.textContent = idx ? 'Coup ' + idx + '/' + parsed.sans.length + ' : ' + parsed.sans[idx - 1] : 'Position de départ';
        prev.disabled = idx === 0;
        next.disabled = idx === parsed.sans.length;
      };
      prev.addEventListener('click', function () { if (idx > 0) { idx--; update(); } });
      next.addEventListener('click', function () { if (idx < parsed.sans.length) { idx++; update(); } });
      update();
      var t = el('p', 'sol-text mono', parsed.text);
      wrap.appendChild(t);
      wrap.appendChild(el('p', 'hint', 'Trait aux ' + (board.turn === 'w' ? 'Blancs' : 'Noirs') + '. Solution : ' + parsed.sans.join(' ')));
    } else {
      wrap.appendChild(el('p', 'sol-text mono', 'Solution : ' + (parsed.text || '(vide)')));
      wrap.appendChild(el('p', 'warn', 'Solution non rejouable (format ou coup illégal) : affichée en texte.'));
    }
    return wrap;
  }

  // ---------- problèmes publiés ----------
  var puzzlesPromise = null;
  function getPuzzles() {
    if (!puzzlesPromise) {
      puzzlesPromise = fetch(SITE + 'data/puzzles.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function () { puzzlesPromise = null; return null; });
    }
    return puzzlesPromise;
  }
  function findPuzzle(list, id) {
    if (!list) return undefined;
    id = String(id).trim();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === id) return list[i];
    return null;
  }

  // ---------- modération ----------
  function fmtDate(v) {
    var d = new Date(typeof v === 'number' ? v : Date.parse(v));
    if (isNaN(d.getTime())) return String(v || '');
    return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fieldsList(fields, skip) {
    var dl = el('dl', 'fields');
    Object.keys(fields || {}).forEach(function (k) {
      if (skip && skip.indexOf(k) >= 0) return;
      dl.appendChild(el('dt', '', k));
      var v = fields[k];
      dl.appendChild(el('dd', /FEN|Solution|Identifiant/.test(k) ? 'mono' : '', v === '' || v == null ? '—' : String(v)));
    });
    return dl;
  }
  function pickField(fields, prefix) {
    var ks = Object.keys(fields || {});
    for (var i = 0; i < ks.length; i++) if (ks[i].indexOf(prefix) === 0) return fields[ks[i]];
    return '';
  }

  function oldPuzzleInfo(p) {
    var d = el('dl', 'fields');
    var rows = [['Titre', p.title], ['Pseudo', p.author], ['Catégorie', Array.isArray(p.category) ? p.category.join(', ') : p.category],
      ['Niveau', p.difficulty], ['Description', p.description]];
    rows.forEach(function (r) {
      d.appendChild(el('dt', '', r[0]));
      d.appendChild(el('dd', '', r[1] ? String(r[1]) : '—'));
    });
    return d;
  }

  function buildCard(it, onDone) {
    var card = el('article', 'card ticket');
    var head = el('div', 't-head');
    head.appendChild(el('span', 'kind ' + it.kind, KIND_LABEL[it.kind] || it.kind));
    head.appendChild(el('span', 't-title', it.title || '(sans titre)'));
    card.appendChild(head);

    var meta = el('div', 't-meta');
    var a = el('a', '', 'Ticket #' + it.number);
    var safe = /^https:\/\/github\.com\//.test(it.url || '');
    if (safe) { a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    meta.appendChild(a);
    meta.appendChild(document.createTextNode(' · ' + fmtDate(it.createdAt)));
    card.appendChild(meta);

    var body = el('div', 't-body');
    var fen = pickField(it.fields, 'FEN');
    var sol = pickField(it.fields, 'Solution');
    var hasBoard = it.kind !== 'delete' && !!fen;
    if (hasBoard) body.classList.add('has-board');
    var fieldsDiv = el('div');
    var holder = el('div');

    if (it.kind === 'delete') {
      body.appendChild(fieldsList(it.fields));
      var targets = el('div', 'targets');
      targets.appendChild(el('p', 'hint', 'Chargement des problèmes visés…'));
      body.appendChild(targets);
      var idsRaw = pickField(it.fields, 'Identifiant');
      getPuzzles().then(function (list) {
        clear(targets);
        var ids = String(idsRaw).split(/[\s,;]+/).filter(Boolean);
        if (!ids.length) targets.appendChild(el('p', 'hint', 'Aucun identifiant indiqué.'));
        ids.forEach(function (id) {
          var t = el('div', 'target');
          t.appendChild(el('div', 't-id', id));
          var p = findPuzzle(list, id);
          if (p === undefined) t.appendChild(el('p', 'warn', 'Liste publiée indisponible : problème non vérifié.'));
          else if (p === null) t.appendChild(el('p', 'missing', 'Introuvable dans la liste publiée.'));
          else {
            t.appendChild(el('p', '', p.title || '(sans titre)'));
            t.appendChild(oldPuzzleInfo(p));
            t.appendChild(puzzleBlock(p.fen, p.solution));
          }
          targets.appendChild(t);
        });
      });
    } else {
      if (hasBoard) {
        var left = el('div', 'ver');
        left.appendChild(el('div', 'ver-title', it.kind === 'edit' ? 'Nouvelle version' : 'Problème proposé'));
        left.appendChild(puzzleBlock(fen, sol));
        holder.appendChild(left);
        body.appendChild(holder);
      }
      body.appendChild(fieldsDiv);
      fieldsDiv.appendChild(fieldsList(it.fields, hasBoard ? ['FEN de départ', 'Solution'] : null));
      if (it.kind === 'edit') {
        var oldWrap = el('div', 'ver old');
        oldWrap.appendChild(el('div', 'ver-title', 'Ancienne version'));
        oldWrap.appendChild(el('p', 'hint', 'Chargement…'));
        var idv = pickField(it.fields, 'Identifiant');
        getPuzzles().then(function (list) {
          clear(oldWrap);
          oldWrap.appendChild(el('div', 'ver-title', 'Ancienne version'));
          var p = findPuzzle(list, idv);
          if (p === undefined) oldWrap.appendChild(el('p', 'warn', 'Liste publiée indisponible.'));
          else if (p === null) oldWrap.appendChild(el('p', 'missing', 'Problème « ' + idv + ' » introuvable dans la liste publiée.'));
          else { oldWrap.appendChild(oldPuzzleInfo(p)); oldWrap.appendChild(puzzleBlock(p.fen, p.solution)); }
        });
        if (hasBoard) {
          var versions = el('div', 'versions');
          body.classList.remove('has-board');
          body.removeChild(holder);
          versions.appendChild(holder);
          versions.appendChild(oldWrap);
          body.insertBefore(versions, fieldsDiv);
        } else fieldsDiv.appendChild(oldWrap);
      }
    }
    card.appendChild(body);

    // actions
    var actions = el('div', 'actions');
    var bOk = el('button', 'btn primary', 'Approuver');
    var bNo = el('button', 'btn danger', 'Refuser');
    bOk.type = bNo.type = 'button';
    var panel = el('div');
    actions.appendChild(bOk); actions.appendChild(bNo); actions.appendChild(panel);
    card.appendChild(actions);

    function busy(v) { bOk.disabled = bNo.disabled = v; }
    function finish(promise, okMsg) {
      busy(true);
      promise.then(function () {
        flash(okMsg, true);
        onDone(card);
      }).catch(function (e) {
        if (e.status !== 401) flash('Échec sur le ticket #' + it.number + ' : ' + e.message, false);
        busy(false);
      });
    }
    bOk.addEventListener('click', function () {
      clear(panel);
      var c = el('div', 'confirm');
      c.appendChild(el('p', '', 'Approuver le ticket #' + it.number + ' (' + (KIND_LABEL[it.kind] || it.kind).toLowerCase() + ') ? L’étiquette sera posée ; la publication suivra via les Actions GitHub.'));
      var y = el('button', 'btn primary', 'Oui, approuver'), n = el('button', 'btn', 'Annuler');
      y.type = n.type = 'button';
      y.addEventListener('click', function () { clear(panel); finish(api('approve', { body: { number: it.number } }), 'Ticket #' + it.number + ' approuvé : la publication suivra dans quelques minutes (Actions GitHub).'); });
      n.addEventListener('click', function () { clear(panel); });
      c.appendChild(y); c.appendChild(n); panel.appendChild(c);
    });
    bNo.addEventListener('click', function () {
      clear(panel);
      var b = el('div', 'refusebox');
      b.appendChild(el('label', '', 'Raison du refus (obligatoire, visible sur le ticket)'));
      var inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 300;
      var err = el('p', 'error');
      var y = el('button', 'btn danger', 'Confirmer le refus'), n = el('button', 'btn', 'Annuler');
      y.type = n.type = 'button';
      y.addEventListener('click', function () {
        var reason = inp.value.trim();
        if (!reason) { err.textContent = 'Une raison est obligatoire.'; inp.focus(); return; }
        clear(panel);
        finish(api('refuse', { body: { number: it.number, reason: reason } }), 'Ticket #' + it.number + ' refusé et fermé.');
      });
      n.addEventListener('click', function () { clear(panel); });
      b.appendChild(inp); b.appendChild(err); b.appendChild(y); b.appendChild(n);
      panel.appendChild(b);
      inp.focus();
    });
    return card;
  }

  function loadQueue() {
    var q = $('queue');
    clear(q);
    q.appendChild(el('p', 'empty', 'Chargement…'));
    api('queue').then(function (d) {
      clear(q);
      var items = d.items || [];
      var count = items.length;
      var upd = function () { $('modBadge').textContent = count ? String(count) : ''; if (!count) { clear(q); q.appendChild(el('p', 'empty', 'Aucun ticket en attente.')); } };
      items.forEach(function (it) {
        q.appendChild(buildCard(it, function (card) { card.parentNode.removeChild(card); count--; upd(); }));
      });
      upd();
    }).catch(function (e) {
      if (e.status === 401) return;
      clear(q);
      q.appendChild(el('p', 'error', 'Impossible de charger la file : ' + e.message));
    });
  }
  $('reloadQueue').addEventListener('click', loadQueue);

  // ---------- statistiques ----------
  var L = {
    m: { local: 'Local', ai: 'Contre l’IA', online: 'En ligne', spectator: 'Spectateur', multi_local: 'À plusieurs (local)', multi_online: 'À plusieurs en ligne' },
    'var': { classic: 'Classique', '960': 'Fischer 960', yalta: 'Yalta (3 joueurs)', cross4: 'Croix (4 joueurs)' },
    r: { checkmate: 'Échec et mat', stalemate: 'Pat', insufficient: 'Matériel insuffisant', repetition: 'Répétition', fifty: 'Règle des 50 coups', resign: 'Abandon', timeout: 'Temps écoulé', agreement: 'Accord mutuel (nulle)', multi: 'Fin à plusieurs' },
    b: { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera', samsung: 'Samsung Internet', other: 'Autre' },
    o: { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS / iPadOS', other: 'Autre' },
    pwa: { '1': 'Appli installée', '0': 'Navigateur' },
    k: { server: 'Serveur injoignable', peer_unavailable: 'Partie introuvable', webrtc: 'Connexion WebRTC impossible', timeout: 'Délai dépassé', host_lost: 'Hôte perdu', rejected: 'Refusé', other: 'Autre' },
    ph: { connect: 'À la connexion', game: 'En cours de partie' },
    g: { duo: 'À deux', multi: 'À plusieurs' },
    role: { host: 'Hôte', guest: 'Invité' }
  };
  function lab(map, v) { return (L[map] && L[map][v]) || v; }
  function nf(n) { return Number(n).toLocaleString('fr-FR'); }
  function pct(n, tot) { return tot ? (Math.round(n / tot * 1000) / 10).toLocaleString('fr-FR') + ' %' : '0 %'; }

  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); }

  function setPreset(n) {
    var to = isoDay(new Date());
    $('to').value = to;
    $('from').value = addDays(to, -(n - 1));
    markPreset(n);
    loadStats();
  }
  function markPreset(n) {
    var bs = document.querySelectorAll('.preset');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', Number(bs[i].getAttribute('data-days')) === n);
  }
  document.querySelector('.presets').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.preset') : null;
    if (b) setPreset(Number(b.getAttribute('data-days')));
  });
  $('applyDates').addEventListener('click', function () { markPreset(0); loadStats(); });

  function sumDays(days) {
    var t = {};
    Object.keys(days || {}).forEach(function (d) {
      var row = days[d];
      Object.keys(row).forEach(function (k) { t[k] = (t[k] || 0) + (Number(row[k]) || 0); });
    });
    return t;
  }
  // Valeurs d'une propriété : { valeur: n } pour les champs "e=<ev>|<prop>=<val>"
  function breakdown(t, ev, prop) {
    var pre = 'e=' + ev + '|' + prop + '=', out = {};
    Object.keys(t).forEach(function (k) { if (k.indexOf(pre) === 0) out[k.slice(pre.length)] = t[k]; });
    return out;
  }

  function hbars(card, data, map, opts) {
    opts = opts || {};
    var keys = Object.keys(data).filter(function (k) { return data[k] > 0; });
    if (opts.numeric) keys.sort(function (a, b) { return Number(b) - Number(a); });
    else keys.sort(function (a, b) { return data[b] - data[a]; });
    if (!keys.length) { card.appendChild(el('p', 'hint', 'Pas de données.')); return; }
    var total = 0, max = 0;
    keys.forEach(function (k) { total += data[k]; if (data[k] > max) max = data[k]; });
    keys.forEach(function (k) {
      var row = el('div', 'hbar');
      row.appendChild(el('div', 'lab', opts.labelFn ? opts.labelFn(k) : lab(map, k)));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = (data[k] / max * 100) + '%';
      track.appendChild(fill);
      track.appendChild(el('span', 'val', nf(data[k]) + ' · ' + pct(data[k], total)));
      row.appendChild(track);
      card.appendChild(row);
    });
  }
  function distCard(parent, title, data, map, opts) {
    var c = el('div', 'card');
    c.appendChild(el('h2', '', title));
    hbars(c, data, map, opts);
    parent.appendChild(c);
  }

  function dailyChart(days, from, to) {
    var list = [], d = from, guard = 0;
    while (d <= to && guard++ < 800) { list.push(d); d = addDays(d, 1); }
    var open = list.map(function (x) { return (days[x] && days[x]['e=app_open']) || 0; });
    var game = list.map(function (x) { return (days[x] && days[x]['e=game_start']) || 0; });
    var max = Math.max.apply(null, open.concat(game).concat([1]));
    var W = 800, H = 220, pl = 36, pr = 6, pt = 8, pb = 24, iw = W - pl - pr, ih = H - pt - pb;
    var svg = svgEl('svg', { 'class': 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Ouvertures et parties lancées par jour' });
    var nice = max <= 5 ? max : Math.ceil(max / 4 / Math.pow(10, Math.floor(Math.log(max / 4) / Math.LN10))) * Math.pow(10, Math.floor(Math.log(max / 4) / Math.LN10)) * 4;
    if (nice < max) nice = max;
    for (var g = 0; g <= 4; g++) {
      var v = nice * g / 4, y = pt + ih - ih * g / 4;
      svg.appendChild(svgEl('line', { 'class': 'grid', x1: pl, x2: W - pr, y1: y, y2: y }));
      var tx = svgEl('text', { x: pl - 4, y: y + 4, 'text-anchor': 'end' });
      tx.textContent = String(Math.round(v * 10) / 10);
      svg.appendChild(tx);
    }
    var slot = iw / list.length, bw = Math.max(1, slot * 0.38);
    var step = Math.ceil(list.length / 8);
    list.forEach(function (day, i) {
      var x0 = pl + slot * i + slot / 2;
      [[open[i], 'c-open', -bw], [game[i], 'c-game', 0]].forEach(function (b) {
        if (!b[0]) return;
        var h = ih * b[0] / nice;
        var r = svgEl('rect', { 'class': b[1], x: x0 + b[2], y: pt + ih - h, width: bw, height: h });
        var t = svgEl('title', {}); t.textContent = day + ' : ' + b[0];
        r.appendChild(t);
        svg.appendChild(r);
      });
      if (i % step === 0) {
        var lt = svgEl('text', { x: x0, y: H - 6, 'text-anchor': 'middle' });
        lt.textContent = day.slice(8) + '/' + day.slice(5, 7);
        svg.appendChild(lt);
      }
    });
    return svg;
  }

  var statsReq = 0;
  function loadStats() {
    var box = $('stats'), from = $('from').value, to = $('to').value, me = ++statsReq;
    clear(box);
    if (!from || !to || from > to) { box.appendChild(el('p', 'error', 'Période invalide.')); return; }
    box.appendChild(el('p', 'empty', 'Chargement…'));
    api('stats', { query: { from: from, to: to } }).then(function (d) {
      if (me !== statsReq) return;
      clear(box);
      renderStats(box, d, from, to);
    }).catch(function (e) {
      if (me !== statsReq || e.status === 401) return;
      clear(box);
      box.appendChild(el('p', 'error', 'Impossible de charger les statistiques : ' + e.message));
    });
  }

  function renderStats(box, d, from, to) {
    var days = d.days || {};
    var t = sumDays(days);
    if (!Object.keys(days).length) {
      box.appendChild(el('p', 'empty', 'Aucune donnée sur cette période.'));
      return;
    }
    var g = function (k) { return t[k] || 0; };

    var tots = el('div', 'totals');
    [['Ouvertures de l’appli', g('e=app_open')], ['Parties lancées', g('e=game_start')], ['Parties terminées', g('e=game_end')],
      ['Problèmes ouverts', g('e=puzzle_open')], ['Problèmes résolus', g('e=puzzle_solved')], ['Messages de chat', g('e=chat_msg')],
      ['Connexions en ligne réussies', g('e=online_ok')], ['Connexions en ligne échouées', g('e=online_error')]
    ].forEach(function (x) {
      var c = el('div', 'tot');
      c.appendChild(el('div', 'n', nf(x[1])));
      c.appendChild(el('div', 'l', x[0]));
      tots.appendChild(c);
    });
    box.appendChild(tots);

    box.appendChild(el('h3', 'sec-title', 'Activité par jour (UTC)'));
    var cc = el('div', 'card');
    var lg = el('div', 'legend');
    var l1 = el('span'); l1.appendChild(el('i', 'i-open')); l1.appendChild(document.createTextNode('Ouvertures de l’appli'));
    var l2 = el('span'); l2.appendChild(el('i', 'i-game')); l2.appendChild(document.createTextNode('Parties lancées'));
    lg.appendChild(l1); lg.appendChild(l2);
    cc.appendChild(lg);
    cc.appendChild(dailyChart(days, from, to));
    box.appendChild(cc);

    box.appendChild(el('h3', 'sec-title', 'Répartitions'));
    var grid = el('div', 'grid2');
    distCard(grid, 'Modes de jeu (parties lancées)', breakdown(t, 'game_start', 'm'), 'm');
    distCard(grid, 'Variantes', breakdown(t, 'game_start', 'var'), 'var');
    distCard(grid, 'Fins de partie', breakdown(t, 'game_end', 'r'), 'r');
    distCard(grid, 'Navigateurs', breakdown(t, 'app_open', 'b'), 'b');
    distCard(grid, 'Systèmes', breakdown(t, 'app_open', 'o'), 'o');
    distCard(grid, 'Appli installée ou non', breakdown(t, 'app_open', 'pwa'), 'pwa');
    distCard(grid, 'Versions de l’appli', breakdown(t, 'app_open', 'ver'), null, { numeric: true, labelFn: function (k) { return 'Version ' + k; } });
    box.appendChild(grid);

    box.appendChild(el('h3', 'sec-title', 'Parties en ligne'));
    var g2 = el('div', 'grid2');
    distCard(g2, 'Erreurs par type', breakdown(t, 'online_error', 'k'), 'k');
    distCard(g2, 'Erreurs par phase', breakdown(t, 'online_error', 'ph'), 'ph');
    distCard(g2, 'Connexions réussies par rôle', breakdown(t, 'online_ok', 'role'), 'role');
    distCard(g2, 'Erreurs par format', breakdown(t, 'online_error', 'g'), 'g');
    box.appendChild(g2);

    box.appendChild(el('h3', 'sec-title', 'Taux d’échec des connexions en ligne'));
    var g3 = el('div', 'grid2');
    g3.appendChild(rateCard('Par navigateur', t, 'b'));
    g3.appendChild(rateCard('Par système', t, 'o'));
    box.appendChild(g3);
  }

  function rateCard(title, t, prop) {
    var c = el('div', 'card');
    c.appendChild(el('h2', '', title));
    var ok = breakdown(t, 'online_ok', prop), er = breakdown(t, 'online_error', prop);
    var keys = {};
    Object.keys(ok).concat(Object.keys(er)).forEach(function (k) { keys[k] = 1; });
    var rows = Object.keys(keys).map(function (k) {
      var o = ok[k] || 0, e = er[k] || 0;
      return { k: k, ok: o, err: e, tot: o + e, rate: (o + e) ? e / (o + e) : 0 };
    }).filter(function (r) { return r.tot > 0; }).sort(function (a, b) { return b.rate - a.rate || b.tot - a.tot; });
    if (!rows.length) { c.appendChild(el('p', 'hint', 'Pas de données.')); return c; }
    rows.forEach(function (r) {
      var row = el('div', 'hbar');
      row.appendChild(el('div', 'lab', lab(prop, r.k)));
      var track = el('div', 'track');
      var fill = el('div', 'fill red');
      fill.style.width = (r.rate * 100) + '%';
      track.appendChild(fill);
      track.appendChild(el('span', 'val', pct(r.err, r.tot) + ' (' + nf(r.err) + ' échecs / ' + nf(r.tot) + ')'));
      row.appendChild(track);
      c.appendChild(row);
    });
    return c;
  }

  // ---------- journal ----------
  var ACT = { approve: 'Approbation', refuse: 'Refus', login: 'Connexion', login_fail: 'Connexion échouée', live_view: 'Consultation du direct' };
  function loadLog() {
    var box = $('log');
    clear(box);
    box.appendChild(el('p', 'empty', 'Chargement…'));
    api('log').then(function (d) {
      clear(box);
      var es = d.entries || [];
      if (!es.length) { box.appendChild(el('p', 'empty', 'Journal vide.')); return; }
      es.forEach(function (e) {
        var r = el('div', 'logrow');
        r.appendChild(el('span', 'when', fmtDate(e.at)));
        r.appendChild(el('span', 'act', ACT[e.action] || e.action));
        if (e.number != null) r.appendChild(el('span', '', 'Ticket #' + e.number + (e.kind ? ' (' + (KIND_LABEL[e.kind] || e.kind).toLowerCase() + ')' : '')));
        box.appendChild(r);
      });
    }).catch(function (e) {
      if (e.status === 401) return;
      clear(box);
      box.appendChild(el('p', 'error', 'Impossible de charger le journal : ' + e.message));
    });
  }
  $('reloadLog').addEventListener('click', loadLog);

  // ---------- en direct ----------
  // Parties partagées par les joueurs consentants (sans noms). Rafraîchi toutes les 5 s tant que l'onglet est visible.
  var LIVE_EVERY = 5000;
  var LIVE_MODES = { local: 'Local', ai: 'Contre l’IA', online: 'En ligne', multi_local: 'À plusieurs (local)', multi_online: 'À plusieurs en ligne' };
  var LIVE_GROUPS = [['all', 'Tous les modes'], ['local', 'Local'], ['ai', 'IA'], ['online', 'En ligne'], ['multi', 'À plusieurs']];
  var LIVE_STATES = [['all', 'Toutes'], ['running', 'En cours'], ['done', 'Terminées']];
  var END_R = { checkmate: 'Échec et mat', stalemate: 'Pat', insufficient: 'Matériel insuffisant', repetition: 'Triple répétition', fifty: 'Règle des 50 coups',
    resign: 'Abandon', timeout: 'Temps écoulé', agreement: 'Accord mutuel', multi: 'Fin de partie à plusieurs', quit: 'Partie quittée' };
  var OUT_R = { mate: 'mat', stalemate: 'pat', resign: 'abandon', king: 'roi pris' };
  var CAMP_CLASS = ['c0', 'c1', 'c2', 'c3'];

  var live = { cards: {}, status: 'all', mode: 'all', fetchedAt: 0, serverNow: 0, busy: false, timer: null, ticker: null, ready: false, running: 0, total: 0 };

  // Petit « U » pour multiboard.js (qui vient de l'appli) : seulement clear et on.
  if (!window.U) window.U = { clear: clear, on: function (e, ev, fn) { e.addEventListener(ev, fn); } };

  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) + ' min';
  }
  function fmtAgo(ms) { return ms < 3000 ? 'à l’instant' : 'il y a ' + fmtDur(ms); }
  function liveNow() { return live.serverNow + (Date.now() - live.fetchedAt); }
  function fmtTc(tc) {
    if (!Array.isArray(tc) || !(tc[0] > 0)) return 'sans pendule';
    var b = tc[0] / 60000, base = b >= 1 ? (Math.round(b * 10) / 10).toLocaleString('fr-FR') + ' min' : Math.round(tc[0] / 1000) + ' s';
    return 'pendule ' + base + (tc[1] > 0 ? ' + ' + Math.round(tc[1] / 1000) + ' s' : '');
  }
  function groupOf(m) { return String(m).indexOf('multi') === 0 ? 'multi' : m; }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  // --- modèle de rejeu ---
  function buildTwo(g) {
    var fail = { error: 'Rejeu indisponible (chess.js non chargé).', boards: [], moves: [], tokens: [], total: 0 };
    if (!window.Chess) return fail;
    var list = (g.mv || []).map(String), game, start;
    try {
      game = new window.Chess.Game(g.sf || undefined);
      start = window.Chess.parseFen(game.startFen);
    } catch (e) { fail.error = 'Position de départ illisible.'; return fail; }
    var boards = [game.board().slice()], moves = [], tokens = [], bad = null;
    for (var i = 0; i < list.length; i++) {
      var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(list[i]), rec = null;
      try { rec = m ? game.move(m[1], m[2], m[3] || null) : null; } catch (e) { rec = null; }
      if (!rec) { bad = i + 1; break; }
      var white = ((start.turn === 'w') === (i % 2 === 0)), no = start.full + Math.floor(((start.turn === 'w' ? 0 : 1) + i) / 2);
      tokens.push({ ply: i + 1, san: rec.san, no: white ? no + '.' : (i === 0 ? no + '…' : '') });
      moves.push([window.Chess.sqIndex(rec.from), window.Chess.sqIndex(rec.to)]);
      boards.push(game.board().slice());
    }
    return { kind: 'two', boards: boards, moves: moves, tokens: tokens, total: boards.length - 1, turn: game.turn(),
      error: bad ? 'Coup ' + bad + ' illégal : rejeu arrêté avant.' : '' };
  }

  function buildMulti(g) {
    var fail = { error: 'Rejeu indisponible (échiquier à plusieurs non chargé).', boards: [], moves: [], tokens: [], total: 0 };
    if (!window.MultiChess || !window.MultiBoard || !window.MultiChess.VARIANTS[g.var]) return fail;
    var game, bad = null, list = (g.mv || []).map(String);
    try { game = new window.MultiChess.Game(g.var, { teams: !!g.teams }); } catch (e) { return fail; }
    for (var i = 0; i < list.length; i++) {
      var a = /^(\d+)-(\d+)([qrbn])?$/.exec(list[i]), r = /^r(\d)$/.exec(list[i]), ok = false;
      try {
        if (a) ok = !!game.move(Number(a[1]), Number(a[2]), a[3] ? a[3].toUpperCase() : null);
        else if (r) ok = !!game.resign(Number(r[1]));
      } catch (e) { ok = false; }
      if (!ok) { bad = i + 1; break; }
    }
    var names = game.v.players.map(function (p) { return p.name; });
    var tokens = [], moves = [];
    game.history.forEach(function (h, i) {
      if (h.resign != null) { tokens.push({ ply: i + 1, san: 'Abandon', camp: h.resign, no: '' }); moves.push(null); }
      else { tokens.push({ ply: i + 1, san: h.san, camp: h.color, no: '' }); moves.push([h.from, h.to]); }
    });
    return { kind: 'multi', boards: game.boards, moves: moves, tokens: tokens, total: game.history.length, game: game, names: names,
      error: bad ? 'Coup ' + bad + ' illégal : rejeu arrêté avant.' : '' };
  }

  function statusText(g, model) {
    var ended = g.end;
    if (model.kind === 'two') {
      var side = function (c) { return c === 'w' ? 'Blancs' : 'Noirs'; };
      if (!ended) return 'Trait aux ' + side(model.turn);
      if (ended.r === 'quit') return 'Partie quittée sans résultat';
      var why = END_R[ended.r] || ended.r;
      if (ended.w === 'd') return 'Partie nulle — ' + why;
      return 'Victoire des ' + side(ended.w) + ' — ' + why;
    }
    var gm = model.game, names = model.names, out = [];
    if (ended && ended.r === 'quit') return 'Partie quittée sans résultat';
    if (gm) gm.out.forEach(function (o, c) { if (o) out.push(names[c] + ' (' + (OUT_R[o] || o) + ')'); });
    var txt;
    if (ended) {
      var w = (Array.isArray(ended.w) ? ended.w : []).map(function (c) { return names[c] || ('Camp ' + c); });
      txt = w.length ? (g.teams ? 'Victoire de l’équipe ' : 'Victoire : ') + w.join(g.teams ? ' + ' : ', ') : 'Partie nulle';
      if (ended.r && ended.r !== 'multi' && END_R[ended.r]) txt += ' — ' + END_R[ended.r];
    } else txt = gm ? 'Trait aux ' + names[gm.turn] : '';
    if (out.length) txt += ' · Éliminés : ' + out.join(', ');
    return txt;
  }

  // --- dessin du plateau d'une carte ---
  function renderMulti(board, st) {
    // multiboard.js adresse ses pièces en relatif (pieces/…) : on les redirige vers le site public pendant le rendu.
    var P = window.SVGImageElement && window.SVGImageElement.prototype;
    if (!P) { board.render(st); return; }
    var sa = P.setAttribute, sns = P.setAttributeNS;
    var fix = function (v) { return typeof v === 'string' && v.indexOf('pieces/') === 0 ? SITE + v : v; };
    P.setAttribute = function (n, v) { return sa.call(this, n, n === 'href' ? fix(v) : v); };
    P.setAttributeNS = function (ns, n, v) { return sns.call(this, ns, n, /href$/.test(n) ? fix(v) : v); };
    try { board.render(st); } finally { delete P.setAttribute; delete P.setAttributeNS; }
  }

  function shownPly(c) { return c.idx == null ? c.model.total : Math.min(c.idx, c.model.total); }

  function show(c) {
    var md = c.model, p = shownPly(c), last = p ? md.moves[p - 1] : null;
    if (md.boards.length) {
      if (md.kind === 'two') drawBoard(c.boardDiv, md.boards[p], last);
      else {
        if (!c.mboard) c.mboard = new window.MultiBoard(c.boardDiv, md.game.v);
        renderMulti(c.mboard, { board: md.boards[p], angle: 0, last: last ? { from: last[0], to: last[1] } : null, sel: -1, targets: [], checks: [] });
      }
    }
    var follow = c.idx == null || c.idx >= md.total;
    c.pos.textContent = p ? 'Coup ' + p + '/' + md.total + ' : ' + md.tokens[p - 1].san + (follow ? '' : (md.total > p ? ' (' + plural(md.total - p, 'coup', 'coups') + ' de plus)' : '')) : 'Position de départ' + (md.total ? ' (' + plural(md.total, 'coup', 'coups') + ')' : '');
    c.prev.disabled = p === 0;
    c.next.disabled = p >= md.total;
    var els = c.movesDiv.querySelectorAll('.mv');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('now', i + 1 === p);
  }

  function renderMoves(c) {
    var d = c.movesDiv, md = c.model;
    clear(d);
    if (!md.tokens.length) { d.appendChild(el('span', 'hint', 'Aucun coup joué.')); return; }
    md.tokens.forEach(function (t) {
      if (t.no) d.appendChild(el('span', 'mn', t.no));
      var s = el('button', 'mv' + (t.camp != null ? ' ' + CAMP_CLASS[t.camp] : ''), t.san);
      s.type = 'button';
      if (t.camp != null) s.title = md.names[t.camp];
      s.addEventListener('click', function () { c.idx = t.ply >= md.total ? null : t.ply; show(c); });
      d.appendChild(s);
    });
  }

  function refreshMeta(c) {
    var g = c.data, now = liveNow(), ended = !!g.end;
    var dur = fmtDur((ended ? g.updatedAt : now) - g.startedAt);
    c.meta.textContent = 'Durée ' + dur + ' · Dernière activité ' + fmtAgo(now - g.updatedAt) + ' · ' + plural((g.mv || []).length, 'coup', 'coups') +
      (g.m.indexOf('multi') === 0 ? '' : ' · ' + fmtTc(g.tc));
  }

  function makeCard(g) {
    var c = { gid: g.gid, idx: null, key: null, data: g, model: null, mboard: null };
    c.root = el('article', 'card live-card');
    var head = el('div', 't-head');
    c.kindEl = el('span', 'kind live-kind');
    c.titleEl = el('span', 't-title');
    c.stateEl = el('span', 'state');
    head.appendChild(c.kindEl); head.appendChild(c.titleEl); head.appendChild(c.stateEl);
    c.meta = el('div', 't-meta');
    c.status = el('div', 'live-status');
    var body = el('div', 'live-body');
    var left = el('div', 'live-left');
    c.boardDiv = el('div', g.var === 'yalta' || g.var === 'cross4' ? 'mboard' : 'board');
    var st = el('div', 'stepper');
    c.prev = el('button', 'btn', '‹'); c.next = el('button', 'btn', '›'); c.pos = el('span', 'pos');
    c.prev.type = c.next.type = 'button';
    c.prev.setAttribute('aria-label', 'Coup précédent');
    c.next.setAttribute('aria-label', 'Coup suivant');
    st.appendChild(c.prev); st.appendChild(c.pos); st.appendChild(c.next);
    left.appendChild(c.boardDiv); left.appendChild(st);
    var right = el('div', 'live-right');
    c.warn = el('p', 'warn');
    c.movesDiv = el('div', 'live-moves mono');
    right.appendChild(c.warn); right.appendChild(c.movesDiv);
    body.appendChild(left); body.appendChild(right);
    c.root.appendChild(head); c.root.appendChild(c.meta); c.root.appendChild(c.status); c.root.appendChild(body);
    c.prev.addEventListener('click', function () { var p = shownPly(c); if (p > 0) { c.idx = p - 1; show(c); } });
    c.next.addEventListener('click', function () { var p = shownPly(c); if (p < c.model.total) { c.idx = p + 1 >= c.model.total ? null : p + 1; show(c); } });
    return c;
  }

  function updateCard(c, g) {
    var newKey = (g.mv || []).join(',') + '|' + (g.sf || '') + '|' + (g.teams ? 1 : 0);
    c.data = g;
    if (c.key !== newKey) {
      c.key = newKey;
      var multi = g.m.indexOf('multi') === 0;
      c.model = multi ? buildMulti(g) : buildTwo(g);
      c.warn.textContent = c.model.error || '';
      renderMoves(c);
      if (!c.model.boards.length) c.boardDiv.classList.add('hidden');
    }
    c.kindEl.textContent = LIVE_MODES[g.m] || g.m;
    c.kindEl.className = 'kind live-kind m-' + groupOf(g.m);
    c.titleEl.textContent = lab('var', g.var) + (g.var === '960' ? '' : '') + (g.teams ? ' · équipes' : '');
    var ended = !!g.end, quit = ended && g.end.r === 'quit';
    c.stateEl.textContent = quit ? 'Quittée' : ended ? 'Terminée' : 'En cours';
    c.stateEl.className = 'state ' + (quit ? 'quit' : ended ? 'done' : 'run');
    c.status.textContent = statusText(g, c.model);
    c.root.setAttribute('data-running', ended ? '0' : '1');
    c.root.setAttribute('data-group', groupOf(g.m));
    refreshMeta(c);
    if (c.model.boards.length) show(c);
  }

  function chip(parent, cls, key, text, onPick) {
    var b = el('button', 'chip', text);
    b.type = 'button';
    b.setAttribute('data-k', key);
    b.addEventListener('click', function () { onPick(key); });
    parent.appendChild(b);
    return b;
  }
  function initLiveFilters() {
    if (live.ready) return;
    live.ready = true;
    live.chipsS = {}; live.chipsM = {};
    LIVE_STATES.forEach(function (s) { live.chipsS[s[0]] = chip($('liveStatus'), 's', s[0], s[1], function (k) { live.status = k; applyFilters(); }); });
    LIVE_GROUPS.forEach(function (s) { live.chipsM[s[0]] = chip($('liveMode'), 'm', s[0], s[1], function (k) { live.mode = k; applyFilters(); }); });
  }

  function applyFilters() {
    var cs = Object.keys(live.cards).map(function (k) { return live.cards[k]; });
    var cntS = { all: 0, running: 0, done: 0 }, cntM = { all: 0, local: 0, ai: 0, online: 0, multi: 0 }, shown = 0;
    cs.forEach(function (c) {
      var run = !c.data.end, grp = groupOf(c.data.m);
      var okS = live.status === 'all' || (live.status === 'running') === run;
      var okM = live.mode === 'all' || live.mode === grp;
      if (okM) { cntS.all++; cntS[run ? 'running' : 'done']++; }
      if (okS) { cntM.all++; cntM[grp]++; }
      var vis = okS && okM;
      c.root.classList.toggle('hidden', !vis);
      if (vis) shown++;
    });
    LIVE_STATES.forEach(function (s) { live.chipsS[s[0]].textContent = s[1] + ' (' + cntS[s[0]] + ')'; live.chipsS[s[0]].classList.toggle('on', live.status === s[0]); });
    LIVE_GROUPS.forEach(function (s) { live.chipsM[s[0]].textContent = s[1] + ' (' + cntM[s[0]] + ')'; live.chipsM[s[0]].classList.toggle('on', live.mode === s[0]); });
    var box = $('live'), e = $('liveEmpty');
    if (!e) { e = el('p', 'empty', ''); e.id = 'liveEmpty'; box.parentNode.insertBefore(e, box.nextSibling); }
    e.classList.toggle('hidden', shown > 0);
    e.textContent = cs.length ? 'Aucune partie ne correspond à ces filtres.' : 'Aucune partie en direct pour le moment.';
  }

  function applyLive(games) {
    initLiveFilters();
    var box = $('live'), seen = {}, running = 0;
    games.forEach(function (g) {
      if (!g || !g.gid || !g.m) return;
      g.mv = Array.isArray(g.mv) ? g.mv : [];
      seen[g.gid] = true;
      if (!g.end) running++;
      var c = live.cards[g.gid];
      if (!c) { c = live.cards[g.gid] = makeCard(g); }
      updateCard(c, g);
    });
    Object.keys(live.cards).forEach(function (k) {
      if (!seen[k]) { box.removeChild(live.cards[k].root); delete live.cards[k]; }
    });
    // ordre : dernière activité d'abord (on ne touche au DOM que si l'ordre a changé)
    var order = Object.keys(live.cards).map(function (k) { return live.cards[k]; }).sort(function (a, b) { return b.data.updatedAt - a.data.updatedAt; });
    order.forEach(function (c, i) { if (box.children[i] !== c.root) box.insertBefore(c.root, box.children[i] || null); });
    live.running = running;
    $('liveBadge').textContent = running ? String(running) : '';
    applyFilters();
  }

  function loadLive() {
    if (live.busy) return;
    live.busy = true;
    $('reloadLive').disabled = true;
    api('live').then(function (d) {
      live.serverNow = Number(d.now) || Date.now();
      live.fetchedAt = Date.now();
      $('liveError').textContent = '';
      applyLive(Array.isArray(d.games) ? d.games : []);
      tickLive();
    }).catch(function (e) {
      if (e.status === 401) return;
      $('liveError').textContent = 'Impossible de charger le direct : ' + e.message;
    }).then(function () { live.busy = false; $('reloadLive').disabled = false; });
  }
  $('reloadLive').addEventListener('click', loadLive);

  function tickLive() {
    var age = live.fetchedAt ? Date.now() - live.fetchedAt : 0;
    $('liveAge').textContent = live.fetchedAt ? 'Mis à jour ' + fmtAgo(age) + ' · actualisation automatique toutes les 5 s' : '';
    Object.keys(live.cards).forEach(function (k) { refreshMeta(live.cards[k]); });
  }

  function liveVisible() {
    return document.visibilityState === 'visible' && !$('app').classList.contains('hidden') && !$('tab-live').classList.contains('hidden');
  }
  // Démarre / arrête le rafraîchissement automatique selon la visibilité de l'onglet et de la page.
  function syncLive() {
    var on = liveVisible();
    if (on && !live.timer) {
      if (!live.fetchedAt || Date.now() - live.fetchedAt >= LIVE_EVERY) loadLive();
      live.timer = setInterval(loadLive, LIVE_EVERY);
      live.ticker = setInterval(tickLive, 1000);
    } else if (!on && live.timer) {
      clearInterval(live.timer); clearInterval(live.ticker);
      live.timer = live.ticker = null;
    }
  }
  document.addEventListener('visibilitychange', syncLive);

  function resetLive() {
    clearInterval(live.timer); clearInterval(live.ticker);
    live.timer = live.ticker = null;
    live.cards = {}; live.fetchedAt = 0;
    clear($('live'));
    $('liveBadge').textContent = '';
    $('liveError').textContent = '';
    var e = $('liveEmpty'); if (e) e.classList.add('hidden');
  }

  // ---------- démarrage ----------
  api('me').then(showApp).catch(function (e) {
    if (e.status !== 401) showLogin('Serveur injoignable : ' + e.message);
    else showLogin();
  });
})();
