/* Échecs à plusieurs : écran de réglages, écran de partie (MultiView) et contrôleur « sur cet appareil ».
 * L'écran de partie est piloté par un contrôleur (comme gameview.js) que fournissent ce fichier (local) et
 * multionline.js (en ligne) :
 *   game (MultiChess.Game), names [nom par camp], view {mode:'fixed'|'turn', color (camp vu en bas si fixe)},
 *   canMove(color) -> bool, attemptMove(from, to, promo), resign(color), quit(), head() -> texte d'en-tête,
 *   menuItems() -> [{label, fn, danger}], myColors() -> camps joués sur cet appareil (abandon), mode ('local'|'online')
 * Règles : multichess.js. Pas de pendule, d'Elo ni d'enregistrement pour ces parties (v1). */
(function () {
  'use strict';
  var M = window.Multi = {};
  var DOT = { w: '#fff', b: '#111', r: '#d9473b', u: '#3d7fe0', y: '#e9b824', g: '#3e9d52' };
  var OUT = { mate: 'mat', stalemate: 'pat', resign: 'abandon', king: 'roi pris' };

  /* ---------- Écran de partie ---------- */
  var ctrl = null, board = null, sel = -1, targets = [], viewPly = null, shownOver = false, promoOpen = false;

  function colorCode(c) { return MultiBoard.CODES[ctrl.game.variant][c]; }
  M.colorName = function (variant, c) { return MultiChess.VARIANTS[variant].players[c].name; };
  M.dotColor = function (variant, c) { return DOT[MultiBoard.CODES[variant][c]]; };
  // Pastille de couleur d'un camp (bordure claire pour les Noirs, sinon invisibles sur le fond sombre)
  M.paintDot = function (dot, variant, c) {
    dot.style.background = M.dotColor(variant, c);
    if (MultiBoard.CODES[variant][c] === 'b') dot.style.borderColor = '#888';
  };

  function who(c) {
    var n = ctrl.names[c], cn = M.colorName(ctrl.game.variant, c);
    return n && n !== cn ? n + ' (' + cn + ')' : 'les ' + cn;
  }

  M.resultText = function (g, names) {
    if (!g.over) return '';
    if (!g.winners.length) return 'Partie nulle : il ne reste que des rois.';
    var list = g.winners.map(function (c) {
      var n = names[c], cn = M.colorName(g.variant, c);
      return n && n !== cn ? n + ' (' + cn + ')' : 'Les ' + cn;
    });
    return list.join(' et ') + (list.length > 1 || /^Les /.test(list[0]) ? ' gagnent !' : ' gagne !');
  };

  M.open = function (c) {
    ctrl = c;
    sel = -1; targets = []; viewPly = null; shownOver = false; promoOpen = false;
    var host = U.$('mu-board');
    board = new MultiBoard(host, ctrl.game.v);
    board.onCell = onCell;
    App.show('multi');
    App.setLive(true);
    U.wake.on();
    layout();
    M.refresh();
  };

  M.close = function () {
    U.closeDialog();
    U.wake.off();
    App.setLive(false);
    ctrl = null;
  };

  M.isLive = function () { return !!ctrl; };

  function angle() {
    var g = ctrl.game, c = ctrl.view.mode === 'turn' ? g.turn : ctrl.view.color;
    return g.v.viewAngle(c);
  }

  function reviewing() { return viewPly !== null && viewPly < ctrl.game.boards.length - 1; }

  M.review = function (step) {
    if (!ctrl) return;
    var n = ctrl.game.boards.length - 1, p = reviewing() ? viewPly : n;
    p = Math.max(0, Math.min(n, p + step));
    viewPly = p < n ? p : null;
    sel = -1; targets = [];
    M.refresh();
  };

  function onCell(c) {
    if (!ctrl || promoOpen || U.dialogOpen()) return;
    if (reviewing()) { viewPly = null; M.refresh(); return; }
    var g = ctrl.game;
    if (g.over || !ctrl.canMove(g.turn)) return;
    var i, p = g.board[c];
    if (sel >= 0) {
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === c) {
          var from = sel, t = targets[i];
          sel = -1; targets = [];
          if (t.promo) askPromotion(g.turn, function (pr) { ctrl.attemptMove(from, c, pr); M.refresh(); });
          else { ctrl.attemptMove(from, c, null); M.refresh(); }
          return;
        }
      }
    }
    if (p && p.c === g.turn && c !== sel) { sel = c; targets = g.targets(c); }
    else { sel = -1; targets = []; }
    M.refresh();
  }

  function askPromotion(color, cb) {
    var node = U.el('div', 'promo'), code = colorCode(color);
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    promoOpen = true;
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + code + t));
      U.on(b, 'click', function () { promoOpen = false; U.closeDialog(); cb(t); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: function () { promoOpen = false; M.refresh(); } });
  }

  M.refresh = function () {
    if (!ctrl) return;
    var g = ctrl.game, n = g.boards.length - 1, shown, last = null, checks = [], i;
    if (reviewing()) {
      shown = g.boards[viewPly];
      var h = g.history[viewPly - 1];
      last = h && h.from != null ? { from: h.from, to: h.to } : null;
    } else {
      viewPly = null;
      shown = g.board;
      var lh = g.history[g.history.length - 1];
      last = lh && lh.from != null ? { from: lh.from, to: lh.to } : null;
      for (i = 0; i < g.n; i++) if (g.alive[i] && g.inCheck(i)) checks.push(g.kingCell(i));
      if (sel >= 0) { var sp = g.board[sel]; if (!sp || sp.c !== g.turn || g.over) { sel = -1; targets = []; } }
    }
    board.render({ board: shown, angle: angle(), sel: sel, targets: U.getSetting('hints') ? targets : [], last: last, checks: checks });
    renderPlayers();
    var head = U.$('mu-head');
    U.toggleClass(head, 'review', reviewing());
    if (reviewing()) head.textContent = 'Revue : coup ' + viewPly + ' / ' + n + ' · touche l’échiquier pour revenir';
    else {
      var lastTxt = '';
      for (i = g.history.length - 1; i >= 0; i--) {
        var a = g.history[i];
        if (a.from != null) { lastTxt = ' · dernier coup : ' + M.colorName(g.variant, a.color) + ' ' + a.san; break; }
      }
      head.textContent = ctrl.head() + lastTxt;
    }
    U.$('mu-prev').disabled = !n || viewPly === 0;
    U.$('mu-next').disabled = !reviewing();
    if (g.over && !shownOver) { shownOver = true; gameOver(); }
  };

  function renderPlayers() {
    var g = ctrl.game, box = U.$('mu-players'), i;
    U.clear(box);
    for (i = 0; i < g.n; i++) {
      var chip = U.el('div', 'mu-p' + (!g.over && g.turn === i ? ' turn' : '') + (!g.alive[i] ? ' out' : ''));
      var dot = U.el('span', 'pdot');
      M.paintDot(dot, g.variant, i);
      chip.appendChild(dot);
      chip.appendChild(U.el('span', 'mu-name', ctrl.names[i] || M.colorName(g.variant, i)));
      var st = !g.alive[i] ? 'éliminé (' + (OUT[g.out[i]] || '') + ')' : g.inCheck(i) ? 'échec !' : (!g.over && g.turn === i ? 'au trait' : '');
      if (g.teams) st = (i % 2 === 0 ? 'équipe A' : 'équipe B') + (st ? ' · ' + st : '');
      chip.appendChild(U.el('span', 'mu-st', st));
      box.appendChild(chip);
    }
  }

  function gameOver() {
    U.fx('end');
    U.dialog({ title: 'Partie terminée', text: M.resultText(ctrl.game, ctrl.names),
      buttons: [{ label: 'Voir l’échiquier' }, { label: 'Quitter', primary: true, fn: function () { ctrl.quit(); } }] });
  }

  M.menu = function () {
    var g = ctrl.game, buttons = [];
    (ctrl.menuItems ? ctrl.menuItems() : []).forEach(function (it) { buttons.push(it); });
    buttons.push({ label: 'Afficher les coups possibles : ' + (U.getSetting('hints') ? 'oui' : 'non'), fn: function () { U.setSetting('hints', !U.getSetting('hints')); M.refresh(); } });
    buttons.push({ label: 'Quitter la partie', danger: true, fn: function () { M.quit(); } });
    buttons.push({ label: 'Reprendre', primary: true });
    U.dialog({ title: 'Menu', buttons: buttons, vertical: true });
    return g;
  };

  M.quit = function () {
    U.confirm('Quitter la partie ?', ctrl.game.over ? 'Retour à l’accueil.' : 'La partie en cours sera perdue.', 'Quitter', 'Continuer',
      function () { ctrl.quit(); }, null, true);
  };

  // Vue : tourne l'échiquier vers le camp suivant (vue fixe)
  function rotateView() {
    var g = ctrl.game;
    if (ctrl.view.mode === 'turn') { ctrl.view.mode = 'fixed'; ctrl.view.color = g.turn; }
    ctrl.view.color = (ctrl.view.color + 1) % g.n;
    M.refresh();
  }

  function layout() {
    if (!ctrl || !board) return;
    var vp = U.viewport(), land = vp.w > vp.h * 1.15;
    var size = land ? Math.min(vp.h - 34, vp.w - 250) : Math.min(vp.w - 8, vp.h - 34 - 64 * Math.ceil(ctrl.game.n / 2) / 1.6 - 60);
    board.setSize(size);
    U.toggleClass(U.$('scr-multi'), 'land', land);
  }
  window.addEventListener('resize', function () { if (ctrl) layout(); }, false);

  /* ---------- Contrôleur « sur cet appareil » ---------- */
  function startLocal(cfg) {
    var g = new MultiChess.Game(cfg.variant, { teams: cfg.teams });
    var all = [];
    for (var i = 0; i < g.n; i++) all.push(i);
    M.open({
      mode: 'local', game: g, names: cfg.names, view: { mode: cfg.view, color: 0 },
      canMove: function () { return true; },
      myColors: function () { return all; },
      attemptMove: function (from, to, promo) {
        var before = g.alive.slice(), rec = g.move(from, to, promo);
        if (!rec) return;
        U.fx('move');
        for (var k = 0; k < g.n; k++) {
          if (before[k] && !g.alive[k] && !g.over) U.toast(who(k).replace(/^les/, 'Les') + ' : éliminés (' + OUT[g.out[k]] + ')');
        }
      },
      head: function () { return g.v.name + (g.teams ? ' · équipes' : '') + ' · sur cet appareil'; },
      menuItems: function () {
        var items = [];
        if (!g.over) {
          items.push({ label: 'Abandon de ' + who(g.turn), danger: true, fn: function () {
            U.confirm('Abandonner ?', who(g.turn) + ' quitte la partie : ses pièces disparaissent.', 'Abandonner', 'Annuler', function () {
              g.resign(g.turn); M.refresh();
            }, null, true);
          } });
        }
        items.push({ label: 'Nouvelle partie', fn: function () { startLocal(cfg); } });
        return items;
      },
      quit: function () { M.close(); App.show('multi-setup'); }
    });
  }

  /* ---------- Réglages ---------- */
  var setup = { variant: 'yalta', teams: false, view: 'turn' }, variantSeg = null;

  function renderNames() {
    var box = U.$('mu-names'), v = MultiChess.VARIANTS[setup.variant], saved = U.store.get('multiNames', {}), i;
    U.clear(box);
    for (i = 0; i < v.players.length; i++) {
      var row = U.el('div', 'mu-namerow');
      var dot = U.el('span', 'pdot');
      M.paintDot(dot, setup.variant, i);
      row.appendChild(dot);
      var inp = U.el('input', 'txt');
      inp.maxLength = 20;
      inp.placeholder = v.players[i].name;
      inp.value = (saved[setup.variant] || [])[i] || '';
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('data-i', i);
      row.appendChild(inp);
      box.appendChild(row);
    }
    U.$('mu-teams').style.display = v.teamsAllowed ? 'block' : 'none';
  }

  function readNames() {
    var v = MultiChess.VARIANTS[setup.variant], inputs = U.$('mu-names').getElementsByTagName('input'), names = [], raw = [], i;
    for (i = 0; i < inputs.length; i++) {
      var t = inputs[i].value.replace(/^\s+|\s+$/g, '');
      raw.push(t);
      names.push(t || v.players[i].name);
    }
    var saved = U.store.get('multiNames', {});
    saved[setup.variant] = raw;
    U.store.set('multiNames', saved);
    return names;
  }

  M.config = function () { return { variant: setup.variant, teams: setup.teams && MultiChess.VARIANTS[setup.variant].teamsAllowed, view: setup.view, names: readNames() }; };

  M.initScreen = function () {
    variantSeg = U.segmented(U.$('mu-variant'), [{ v: 'yalta', label: '3 joueurs (Yalta)' }, { v: 'cross4', label: '4 joueurs' }], setup.variant,
      function (v) { setup.variant = v; renderNames(); if (window.MultiOnline) MultiOnline.refreshSetup(); });
    var cb = U.checkbox('Équipes 2 contre 2 (camps face à face alliés)', setup.teams, function (v) { setup.teams = v; });
    U.$('mu-teams').appendChild(cb);
    U.segmented(U.$('mu-view'), [{ v: 'turn', label: 'Tourne vers le joueur au trait' }, { v: 'fixed', label: 'Fixe' }], setup.view,
      function (v) { setup.view = v; });
    renderNames();
    U.on(U.$('mu-start'), 'click', function () { startLocal(M.config()); });
    U.on(U.$('mu-prev'), 'click', function () { M.review(-1); });
    U.on(U.$('mu-next'), 'click', function () { M.review(1); });
    U.on(U.$('mu-rot'), 'click', function () { if (ctrl) rotateView(); });
    U.on(U.$('mu-menu'), 'click', function () { if (ctrl) M.menu(); });
  };
})();
