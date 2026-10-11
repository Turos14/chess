/* Classement Elo côté navigateur : stockage (localStorage, propre à cet appareil), écran « Classement »,
 * et enregistrement d'une partie terminée (appelé depuis gameview.js). Calcul : public/js/elo.js. */
(function () {
  'use strict';
  var V = {};

  function load() { return U.store.get('elo', Elo.newDb()); }
  function save(db) { U.store.set('elo', db); }

  // Enregistre le résultat d'une partie si les deux noms sont éligibles ; affiche un toast le cas échéant.
  // startW/startB : note de départ si nameW/nameB est un joueur inédit (facultatif, ignoré s'il existe déjà).
  V.record = function (nameW, nameB, result, mode, startW, startB) {
    var db = load();
    var r = Elo.apply(db, nameW, nameB, result, mode, null, startW, startB);
    if (r.applied) {
      save(db);
      function fmt(d) { return (d.delta >= 0 ? '+' : '') + d.delta; }
      U.toast('Elo — ' + r.w.name + ' ' + r.w.after + ' (' + fmt(r.w) + ') · ' + r.b.name + ' ' + r.b.after + ' (' + fmt(r.b) + ')');
    }
    return r;
  };

  V.render = function () {
    var box = U.$('elo-list');
    U.clear(box);
    var list = Elo.list(load());
    if (!list.length) {
      box.appendChild(U.el('p', 'hint center', 'Aucune partie comptabilisée pour l’instant. Dans une partie locale ou en ligne, donne un nom différent à chaque joueur (pas seulement « Blancs »/« Noirs ») pour activer le classement.'));
      return;
    }
    list.forEach(function (p, i) {
      var row = U.el('div', 'item');
      var main = U.el('div', 'main');
      main.appendChild(U.el('div', 'ititle', (i + 1) + '. ' + p.name));
      main.appendChild(U.el('div', 'isub', p.games + ' partie' + (p.games > 1 ? 's' : '') + ' · ' + p.wins + 'V ' + p.draws + 'N ' + p.losses + 'D'));
      U.on(main, 'click', function () { V.detail(p); });
      row.appendChild(main);
      row.appendChild(U.el('div', 'elo-rating', String(p.rating)));
      box.appendChild(row);
    });
  };

  // Construit un petit champ « Elo de départ » lié à un champ de nom : il n'apparaît que quand le nom saisi
  // correspond à un joueur pas encore suivi (impossible d'écraser la note d'un joueur déjà existant).
  // Réutilisé par local.js, online.js et le calculateur ci-dessous.
  V.startField = function (nameInput, placeholder) {
    var wrap = U.el('span', 'elo-startfield');
    var input = U.el('input', 'num');
    input.type = 'number'; input.min = Elo.MIN_RATING; input.max = Elo.MAX_RATING;
    input.placeholder = placeholder || ('Elo (' + Elo.DEFAULT_RATING + ')');
    input.setAttribute('inputmode', 'numeric');
    wrap.appendChild(input);
    function sync() {
      var name = nameInput.value.replace(/^\s+|\s+$/g, '');
      var known = name && Elo.player(load(), name);
      wrap.style.display = (name && !known) ? 'inline-block' : 'none';
    }
    U.on(nameInput, 'input', sync);
    U.on(nameInput, 'change', sync);
    sync();
    return {
      el: wrap,
      refresh: sync,
      get: function () {
        if (wrap.style.display === 'none' || input.value === '') return null;
        var v = Math.round(Number(input.value));
        return isFinite(v) ? v : null;   // le clamp final (bornes, repli) est fait par elo.js
      }
    };
  };

  function scoreLabel(s) { return s === 1 ? 'Victoire' : (s === 0 ? 'Défaite' : 'Nulle'); }
  function modeLabel(m) { return m === 'manual' ? 'saisie manuelle' : (m === 'online' ? 'en ligne' : (m === 'local' ? 'locale' : null)); }

  // Reconstruit la courbe (du plus ancien au plus récent) à partir de l'historique (stocké du plus récent au plus ancien).
  // L'historique est borné : au-delà de 30 parties, le premier point n'est plus la note de départ réelle (1200) mais
  // celle d'avant la plus ancienne partie encore affichée.
  function buildSeries(p) {
    var hist = p.history.slice().reverse(), pts = [], i;
    pts.push({ date: hist[0].date, rating: hist[0].rating - hist[0].delta, synthetic: true });
    for (i = 0; i < hist.length; i++) {
      pts.push({ date: hist[i].date, rating: hist[i].rating, opponent: hist[i].opponent, delta: hist[i].delta, score: hist[i].score });
    }
    return pts;
  }

  V.detail = function (p) {
    var node = U.el('div');
    node.appendChild(U.el('p', 'hint', p.games + ' partie' + (p.games > 1 ? 's' : '') + ' · ' +
      p.wins + ' victoire' + (p.wins !== 1 ? 's' : '') + ', ' + p.draws + ' nulle' + (p.draws !== 1 ? 's' : '') + ', ' + p.losses + ' défaite' + (p.losses !== 1 ? 's' : '')));
    var chartBox = U.el('div');
    node.appendChild(chartBox);
    new EloChart(chartBox, buildSeries(p));
    if (p.history.length) {
      var hist = U.el('div', 'elo-hist');
      p.history.forEach(function (h) {
        var row = U.el('div', 'elo-hrow');
        var ml = modeLabel(h.mode);
        row.appendChild(U.el('span', null, U.fmtDate(h.date) + ' vs ' + h.opponent + ' — ' + scoreLabel(h.score) + (ml ? ' · ' + ml : '')));
        row.appendChild(U.el('span', h.delta >= 0 ? 'elo-up' : 'elo-down', (h.delta >= 0 ? '+' : '') + h.delta + ' → ' + h.rating));
        hist.appendChild(row);
      });
      node.appendChild(hist);
    }
    U.dialog({ title: p.name + ' — ' + p.rating, node: node, buttons: [{ label: 'Fermer', primary: true }] });
  };

  /* ---------- Calculer une partie manuellement ---------- */
  V.openCalculator = function () {
    var db = load();
    var node = U.el('div');
    var row = U.el('div', 'fieldrow');
    var aInput = U.el('input', 'txt'); aInput.placeholder = 'Joueur A'; aInput.maxLength = 20; aInput.setAttribute('list', 'elo-names'); aInput.setAttribute('autocomplete', 'off');
    var bInput = U.el('input', 'txt'); bInput.placeholder = 'Joueur B'; bInput.maxLength = 20; bInput.setAttribute('list', 'elo-names'); bInput.setAttribute('autocomplete', 'off');
    row.appendChild(aInput); row.appendChild(bInput);
    node.appendChild(row);
    var datalist = U.el('datalist'); datalist.id = 'elo-names';
    Elo.list(db).forEach(function (p) { var o = document.createElement('option'); o.value = p.name; datalist.appendChild(o); });
    node.appendChild(datalist);
    var startRow = U.el('div', 'fieldrow');
    var startA = V.startField(aInput, 'Elo A (' + Elo.DEFAULT_RATING + ')');
    var startB = V.startField(bInput, 'Elo B (' + Elo.DEFAULT_RATING + ')');
    startRow.appendChild(startA.el); startRow.appendChild(startB.el);
    node.appendChild(startRow);
    node.appendChild(U.el('p', 'hint', 'Seul le résultat compte pour le calcul : indique juste qui gagne (ou la nulle). Un nom encore inconnu démarre à ' + Elo.DEFAULT_RATING + ', modifiable ci-dessus s’il a déjà un classement ailleurs.'));
    var segWrap = U.el('div');
    node.appendChild(segWrap);
    var seg = U.segmented(segWrap, [{ v: 'a', label: 'A gagne' }, { v: 'd', label: 'Nulle' }, { v: 'b', label: 'B gagne' }], 'd');
    var err = U.el('div', 'error');
    node.appendChild(err);
    var resultBox = U.el('div', 'elo-calcresult');
    resultBox.style.display = 'none';
    node.appendChild(resultBox);

    function line(d) {
      var r = U.el('div', 'elo-calcrow');
      r.appendChild(U.el('span', null, d.name));
      r.appendChild(U.el('span', d.delta >= 0 ? 'elo-up' : 'elo-down', d.before + ' → ' + d.after + ' (' + (d.delta >= 0 ? '+' : '') + d.delta + ')'));
      resultBox.appendChild(r);
    }
    function compute() {
      var a = aInput.value, b = bInput.value;
      if (!Elo.eligible(a, b)) {
        err.textContent = 'Entre deux noms différents (pas « Blancs »/« Noirs »/« Joueur »/« Spectateur »).';
        return;
      }
      err.textContent = '';
      var result = seg.get() === 'a' ? '1-0' : (seg.get() === 'b' ? '0-1' : '1/2-1/2');
      var r = V.record(a, b, result, 'manual', startA.get(), startB.get());
      U.clear(resultBox);
      resultBox.style.display = 'block';
      line(r.w); line(r.b);
      V.render();
      // Permet d'enchaîner d'autres parties avec les mêmes noms
      var opts = Elo.list(load());
      U.clear(datalist);
      opts.forEach(function (p) { var o = document.createElement('option'); o.value = p.name; datalist.appendChild(o); });
      startA.refresh(); startB.refresh();   // les deux joueurs existent désormais : le champ de départ se masque
    }
    U.dialog({
      title: 'Calculer une partie', node: node,
      buttons: [{ label: 'Fermer' }, { label: 'Calculer', primary: true, keep: true, fn: compute }]
    });
  };

  V.initScreen = function () {
    U.on(U.$('elo-calc'), 'click', V.openCalculator);
    U.on(U.$('elo-reset'), 'click', function () {
      U.confirm('Réinitialiser le classement ?', 'Toutes les notes Elo enregistrées sur cet appareil seront supprimées. Cette action est définitive.',
        'Réinitialiser', 'Annuler', function () { U.store.remove('elo'); V.render(); }, null, true);
    });
    // Un autre onglet du même navigateur (ou une autre fenêtre de l'appli) vient de modifier le classement :
    // localStorage ne notifie pas l'onglet qui écrit, seulement les autres — sans ça l'écran resterait figé.
    U.on(window, 'storage', function (e) {
      if ((!e.key || e.key === 'chess.elo') && U.hasClass(U.$('scr-elo'), 'active')) V.render();
    });
  };

  window.EloView = V;
})();
