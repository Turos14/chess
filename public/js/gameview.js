/* Écran de partie partagé par le mode local et le mode en ligne.
 * Le contrôleur (ctrl) fournit :
 *   game, clock (ChessClock|null), names {w,b}, view {mode:'white'|'black'|'auto', faceToFace},
 *   canMove(color) -> bool, attemptMove(from, to, promo), getResult() -> {result,reason,winner}|null,
 *   head() -> texte d'en-tête, status(color) -> texte sous le nom, menuItems() -> [{label, fn, danger}],
 *   pausable (bool), onPause(), quit(), mode ('local'|'online'|'spectator'), trackElo() -> bool (comptabiliser en Elo)
 */
(function () {
  'use strict';
  var REASONS = {
    checkmate: 'Échec et mat', stalemate: 'Pat', insufficient: 'Matériel insuffisant',
    repetition: 'Triple répétition', fifty: 'Règle des 50 coups', resign: 'Abandon',
    timeout: 'Temps écoulé', agreement: 'Accord mutuel'
  };

  var V = {};
  var ctrl = null, board = null, sel = -1, targets = [], timer = null, shownResult = false;
  var el = {}, lastWarn = { w: -1, b: -1 }, promoOpen = false;

  V.reasonText = function (r) { return REASONS[r] || ''; };

  V.resultText = function (res, names) {
    if (!res) return '';
    var w = res.winner, nm = w && names ? names[w] : null;
    var who = nm && nm !== U.colorName(w) ? nm + ' (' + U.colorName(w) + ')' : 'Les ' + U.colorName(w);
    var head = w ? who + (nm && nm !== U.colorName(w) ? ' gagne' : ' gagnent') : 'Partie nulle';
    return head + ' — ' + (REASONS[res.reason] || '').toLowerCase();
  };

  V.init = function () {
    el.scr = U.$('scr-game');
    el.head = U.$('g-head'); el.info = U.$('g-info'); el.rec = U.$('g-rec');
    el.top = U.$('g-top'); el.bottom = U.$('g-bottom'); el.tools = U.$('g-tools');
    board = new Board(U.$('g-board'));
    board.onSquare = onSquare;
    [el.top, el.bottom].forEach(function (b) {
      b.appendChild(U.el('span', 'pdot'));
      b.appendChild(U.el('span', 'pname'));
      b.appendChild(U.el('span', 'pmat'));
      b.appendChild(U.el('span', 'pstat'));
      b.appendChild(U.el('span', 'ptime'));
    });
    window.addEventListener('resize', layout, false);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); }, false);
  };

  /* ---------- Orientation et bandes ---------- */
  V.orient = function () {
    var m = ctrl.view.mode;
    if (m === 'auto') return ctrl.game.turn();
    return m === 'black' ? 'b' : 'w';
  };
  V.flip = function () {
    ctrl.view.mode = V.orient() === 'w' ? 'black' : 'white';
    V.refresh();
  };

  /* ---------- Mise en page (positions absolues calculées : portrait et paysage) ---------- */
  function place(e, x, y, w, h) {
    e.style.left = Math.round(x) + 'px'; e.style.top = Math.round(y) + 'px';
    e.style.width = Math.round(w) + 'px'; e.style.height = Math.round(h) + 'px';
  }
  function layout() {
    if (!ctrl) return;
    var vp = U.viewport(), W = vp.w, H = vp.h;
    var headH = 24, barH = Math.max(44, Math.min(64, H * 0.08)), toolH = 54, pad = 6;
    var land = W > H * 1.25;
    var size, x, y;
    if (land) {
      size = Math.min(H - headH - pad, W - 190);
      size = board.setSize(size);
      x = pad; y = headH + Math.max(0, (H - headH - size) / 2);
      place(el.head, 0, 0, W, headH);
      place(U.$('g-board'), x, y, size, size);
      var sx = x + size + 10, sw = W - sx - pad;
      place(el.top, sx, y, sw, barH);
      place(el.bottom, sx, y + size - barH, sw, barH);
      place(el.tools, sx, y + barH + 8, sw, size - 2 * barH - 16);
      U.addClass(el.tools, 'land');
    } else {
      size = Math.min(W, H - headH - 2 * barH - toolH - 2 * pad);
      size = board.setSize(size);
      var total = headH + barH + size + barH + toolH;
      var y0 = Math.max(0, (H - total) / 2);
      x = (W - size) / 2;
      place(el.head, 0, y0, W, headH);
      place(el.top, x, y0 + headH, size, barH);
      place(U.$('g-board'), x, y0 + headH + barH, size, size);
      place(el.bottom, x, y0 + headH + barH + size, size, barH);
      place(el.tools, x, y0 + headH + 2 * barH + size + 4, size, toolH);
      U.removeClass(el.tools, 'land');
    }
  }

  /* ---------- Ouverture ---------- */
  V.open = function (c) {
    ctrl = c;
    Rec.reset();
    sel = -1; targets = []; shownResult = false;
    lastWarn = { w: -1, b: -1 };
    buildTools();
    App.show('game');
    App.setLive(true);
    U.fs.enter();
    U.wake.on();
    layout();
    V.refresh();
    clearInterval(timer);
    timer = setInterval(tick, 100);
  };

  V.close = function () {
    clearInterval(timer);
    timer = null;
    U.closeDialog();
    U.fs.exit();
    U.wake.off();
    App.setLive(false);
    ctrl = null;
  };

  V.isLive = function () { return !!ctrl; };
  V.controller = function () { return ctrl; };

  function buildTools() {
    U.clear(el.tools);
    if (ctrl.pausable) el.tools.appendChild(U.button('Pause', 'tbtn', function () { ctrl.onPause(); }));
    el.tools.appendChild(U.button('Vue', 'tbtn', function () { V.flip(); }));
    el.recBtn = U.button('Enreg.', 'tbtn', function () { Rec.toggle(ctrl); V.refresh(); });
    el.tools.appendChild(el.recBtn);
    el.tools.appendChild(U.button('Menu', 'tbtn', function () { V.menu(); }));
  }

  /* ---------- Interaction ---------- */
  function onSquare(idx) {
    if (!ctrl || promoOpen) return;
    var g = ctrl.game;
    if (ctrl.getResult() || U.dialogOpen()) return;
    var i, piece = g.board()[idx], turn = g.turn();
    if (sel >= 0) {
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = sel, t = targets[i];
          sel = -1; targets = [];
          if (t.promo) askPromotion(turn, function (p) { doMove(from, idx, p); });
          else doMove(from, idx, null);
          return;
        }
      }
    }
    if (piece && piece.charAt(0) === turn && idx !== sel && ctrl.canMove(turn)) {
      sel = idx; targets = g.targets(idx);
    } else { sel = -1; targets = []; }
    V.refresh();
  }

  function doMove(from, to, promo) {
    ctrl.attemptMove(from, to, promo);
    V.refresh();
  }

  function askPromotion(color, cb) {
    var node = U.el('div', 'promo');
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    promoOpen = true;
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.fontSize = Math.round(size * 0.8) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { promoOpen = false; U.closeDialog(); cb(t.toLowerCase()); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: function () { promoOpen = false; V.refresh(); } });
  }

  /* ---------- Rendu ---------- */
  V.refresh = function () {
    if (!ctrl) return;
    var g = ctrl.game, orient = V.orient(), res = ctrl.getResult();
    if (sel >= 0) {
      var p = g.board()[sel];
      if (!p || p.charAt(0) !== g.turn() || res) { sel = -1; targets = []; }
      else targets = g.targets(sel);
    }
    var last = g.lastMove();
    var checkSq = (!res || res.reason === 'checkmate') && g.inCheck() ? g.kingSquare(g.turn()) : -1;
    var faceTop = ctrl.view.faceToFace ? Chess.other(orient) : null;
    board.render({
      board: g.board(), orient: orient,
      last: last ? { from: Chess.sqIndex(last.from), to: Chess.sqIndex(last.to) } : null,
      sel: sel, targets: U.getSetting('hints') ? targets : [],
      check: checkSq, coords: U.getSetting('coords'), faceTop: faceTop
    });
    // Barres des joueurs : haut = adversaire de l'orientation
    paintBar(el.top, Chess.other(orient), !!ctrl.view.faceToFace);
    paintBar(el.bottom, orient, false);
    el.info.textContent = ctrl.head();
    el.rec.textContent = Rec.active() ? '● REC' : '';
    if (el.recBtn) U.toggleClass(el.recBtn, 'recon', Rec.active());
    tick();
    if (res && !shownResult) { shownResult = true; V.gameOver(res); }
  };

  function paintBar(bar, color, rotated) {
    var g = ctrl.game, res = ctrl.getResult();
    var turn = !res && g.turn() === color;
    var m = Chess.material(g.board());
    bar.className = 'pbar' + (turn ? ' turn' : '') + (rotated ? ' rot' : '') + (color === 'w' ? ' cw' : ' cb');
    bar.childNodes[0].className = 'pdot ' + (color === 'w' ? 'w' : 'b');
    bar.childNodes[1].textContent = ctrl.names[color];
    bar.childNodes[2].textContent = m.diff !== 0 && (color === 'w') === (m.diff > 0) ? '+' + Math.abs(m.diff) : '';
    bar.childNodes[3].textContent = ctrl.status(color) || '';
    bar.setAttribute('data-color', color);
  }

  function tick() {
    if (!ctrl) return;
    var orient = V.orient();
    [[el.top, Chess.other(orient)], [el.bottom, orient]].forEach(function (pair) {
      var t = pair[0].childNodes[4], c = pair[1];
      if (!ctrl.clock) { t.textContent = ''; return; }
      var ms = ctrl.clock.get(c);
      t.textContent = U.fmtClock(ms);
      U.toggleClass(t, 'low', ms < 10000 && ctrl.clock.running && ctrl.clock.active === c);
    });
    if (ctrl.clock) {
      if (ctrl.clock.running) {
        var c = ctrl.clock.active, ms = ctrl.clock.get(c);
        if (ms < 10000 && ctrl.mode !== 'spectator' && (ctrl.mode === 'local' || ctrl.myColor === c)) {
          var sec = Math.ceil(ms / 1000);
          if (sec !== lastWarn[c]) { lastWarn[c] = sec; U.fx('warn'); }
        }
      }
      if (ctrl.onClockTick) ctrl.onClockTick();
    }
  }

  /* ---------- Fin de partie ---------- */
  V.gameOver = function (res) {
    U.fx('end');
    var text = V.resultText(res, ctrl.names);
    U.closeDialog();
    if (typeof ctrl.trackElo === 'function' && ctrl.trackElo()) {
      var st = typeof ctrl.eloStart === 'function' ? ctrl.eloStart() : null;
      EloView.record(ctrl.names.w, ctrl.names.b, res.result, ctrl.mode, st && st.w, st && st.b);
    }
    Rec.promptSave(ctrl, text, function () { V.refresh(); });
  };

  /* ---------- Menu et réglages ---------- */
  V.menu = function () {
    var items = [];
    items.push({ label: 'Réglages', fn: function () { V.settings(); } });
    (ctrl.menuItems ? ctrl.menuItems() : []).forEach(function (i) { items.push(i); });
    items.push({ label: Rec.active() ? 'Arrêter l’enregistrement' : 'Enregistrer la suite de la partie', fn: function () { Rec.toggle(ctrl); V.refresh(); } });
    items.push({ label: U.fs.active() ? 'Quitter le plein écran' : 'Plein écran', fn: function () { U.fs.toggle(); } });
    items.push({ label: 'Quitter la partie', danger: true, fn: function () { V.quit(); } });
    var buttons = items.map(function (it) {
      return { label: it.label, danger: it.danger, fn: it.fn };
    });
    buttons.push({ label: 'Reprendre', primary: true });
    U.dialog({ title: 'Menu', buttons: buttons, vertical: true });
  };

  V.quit = function () {
    U.confirm('Quitter la partie ?',
      ctrl.getResult() ? 'Retour à l’accueil.' : (ctrl.quitText || 'La partie en cours sera abandonnée.'),
      'Quitter', 'Continuer', function () { ctrl.quit(); }, null, true);
  };

  V.settings = function () {
    var node = U.el('div', 'settings');
    node.appendChild(U.el('h3', null, 'Vue de l’échiquier'));
    var seg = U.el('div');
    node.appendChild(seg);
    var opts = [{ v: 'white', label: 'Blancs en bas' }, { v: 'black', label: 'Noirs en bas' }];
    if (ctrl.mode === 'local') opts.push({ v: 'auto', label: 'Alternée' });
    U.segmented(seg, opts, ctrl.view.mode, function (v) { ctrl.view.mode = v; V.refresh(); });
    if (ctrl.mode === 'local') {
      node.appendChild(U.checkbox('Face à face : pièces du joueur du haut inversées', ctrl.view.faceToFace, function (v) {
        ctrl.view.faceToFace = v; V.refresh();
      }));
    }
    node.appendChild(U.checkbox('Afficher les coups possibles', U.getSetting('hints'), function (v) { U.setSetting('hints', v); V.refresh(); }));
    node.appendChild(U.checkbox('Afficher les coordonnées', U.getSetting('coords'), function (v) { U.setSetting('coords', v); V.refresh(); }));
    node.appendChild(U.el('h3', null, 'Alertes'));
    var sc = U.el('div');
    node.appendChild(sc);
    U.soundControl(sc);
    U.dialog({ title: 'Réglages', node: node, buttons: [{ label: 'Fermer', primary: true }] });
  };

  V.layout = layout;
  window.GameView = V;
})();
