/* Aide-mémoire : liste des enchaînements et éditeur (échiquier + titre + notes). Logique pure dans memo.js.
 * Données propres à l'appareil (localStorage « memos ») : jamais envoyées, ni partagées, ni exportées.
 * Enregistrement automatique à chaque changement ; une fiche restée vide n'est pas conservée.
 * Mode « S'entraîner » : le joueur rejoue la ligne de mémoire (coups et notes masqués), l'adversaire est joué seul. */
(function () {
  'use strict';
  var MV = window.MemoView = {};

  function load() { return Memo.sanitizeList(U.store.get('memos', [])); }
  function persist(list) { U.store.set('memos', list); }

  /* ---------- Liste ---------- */
  MV.renderList = function () {
    var box = U.$('mm-list'), all = Memo.sortList(load());
    var list = Memo.filter(all, U.$('mm-search').value);
    U.$('mm-search').style.display = all.length ? 'block' : 'none';
    U.clear(box);
    if (!all.length) {
      box.appendChild(U.el('p', 'hint center', 'Aucun enchaînement pour l’instant. Crée-en un et joue ses coups sur l’échiquier.'));
      return;
    }
    if (!list.length) { box.appendChild(U.el('p', 'hint center', 'Aucun résultat.')); return; }
    list.forEach(function (m) {
      var item = U.el('div', 'item');
      var main = U.el('div', 'main');
      main.appendChild(U.el('div', 'ititle', m.title || 'Sans titre'));
      var line = Memo.moveText(m.moves);
      main.appendChild(U.el('div', 'isub', (line ? (line.length > 70 ? line.slice(0, 70) + '…' : line) : 'Aucun coup') +
        ' · ' + m.moves.length + ' coup' + (m.moves.length > 1 ? 's' : '')));
      U.on(main, 'click', function () { open(m); });
      item.appendChild(main);
      item.appendChild(U.button('Suppr.', 'btn small danger', function () { remove(m.id, MV.renderList); }));
      box.appendChild(item);
    });
  };

  function remove(id, done) {
    U.confirm('Supprimer cet enchaînement ?', 'Cette action est définitive.', 'Supprimer', 'Annuler', function () {
      persist(load().filter(function (m) { return m.id !== id; }));
      if (done) done();
    }, null, true);
  }

  /* ---------- Éditeur ---------- */
  // ed : {memo, ply (position affichée), sel (case choisie, -1), orient, board}
  var ed = { memo: null, ply: 0, sel: -1, orient: 'w', board: null };
  // tr (entraînement en cours, sinon null) : {side 'w'|'b'|'both', ply (coups déjà joués), errors, hints, hint (montrer
  // la case de départ), done, timer}. Le joueur rejoue ses coups de mémoire, ceux de l'adversaire sont joués seuls.
  var tr = null, TRAIN_REPLY_MS = 600;

  function newMemo() {
    var now = new Date().getTime();
    return { id: String(now) + Math.floor(Math.random() * 1000), title: '', notes: '', moves: [], created: now, updated: now };
  }

  function open(memo) {
    stopTraining();
    ed.memo = memo; ed.ply = memo.moves.length; ed.sel = -1; ed.orient = 'w';
    if (!ed.board) { ed.board = new Board(U.$('mme-board')); ed.board.onSquare = onSquare; }
    U.$('mme-title').value = memo.title;
    U.$('mme-notes').value = memo.notes;
    U.$('mme-del').style.display = 'block';
    App.show('memo-edit');
    layout();
    refresh();
  }

  // Enregistre la fiche en cours (ou l'efface du stockage si elle est vide).
  function save() {
    var m = ed.memo, list = load(), i, found = false;
    if (!m) return;
    m.updated = new Date().getTime();
    for (i = 0; i < list.length; i++) if (list[i].id === m.id) { list[i] = m; found = true; }
    if (!found) list.push(m);
    if (Memo.isEmpty(m)) list = list.filter(function (x) { return x.id !== m.id; });
    persist(list);
  }

  function game(ply) { return Chess.replay(Chess.START, ed.memo.moves.slice(0, ply)); }

  function refresh() {
    if (tr) { refreshTraining(); return; }
    var m = ed.memo, n = m.moves.length;
    ed.ply = Math.max(0, Math.min(n, ed.ply));
    var g = game(ed.ply), last = null, check = -1;
    if (ed.ply > 0) last = { from: Chess.sqIndex(m.moves[ed.ply - 1].from), to: Chess.sqIndex(m.moves[ed.ply - 1].to) };
    if (g.inCheck()) check = g.kingSquare(g.turn());
    var targets = ed.sel >= 0 && U.getSetting('hints') ? g.targets(ed.sel) : [];
    ed.board.render({ board: g.board(), orient: ed.orient, last: last, sel: ed.sel, targets: targets, check: check, coords: U.getSetting('coords'), faceTop: null });
    U.$('mme-count').textContent = ed.ply + ' / ' + n;
    var st = g.status();
    U.$('mme-status').textContent = st.over ? 'Fin : ' + GameView.reasonText(st.reason).toLowerCase() :
      'Trait aux ' + U.colorName(g.turn()) + (ed.ply < n ? ' · jouer ici remplace la suite' : '');
    U.$('mme-undo').disabled = !n;
    U.$('mme-train').disabled = !n;
    renderMoves();
  }

  function renderMoves() {
    var box = U.$('mme-moves'), moves = ed.memo.moves, i;
    U.clear(box);
    if (!moves.length) { box.appendChild(U.el('span', 'hint', 'Joue les coups sur l’échiquier.')); return; }
    for (i = 0; i < moves.length; i++) {
      if (i % 2 === 0) box.appendChild(U.el('span', 'mnum', (i / 2 + 1) + '.'));
      var s = U.el('span', 'mv' + (i + 1 === ed.ply ? ' cur' : ''), moves[i].san);
      (function (p) { U.on(s, 'click', function () { ed.sel = -1; ed.ply = p; refresh(); }); })(i + 1);
      box.appendChild(s);
      box.appendChild(document.createTextNode(' '));
      if (i + 1 === ed.ply) {
        var cur = s;
        setTimeout(function () {
          if (cur.offsetTop < box.scrollTop || cur.offsetTop > box.scrollTop + box.clientHeight - 30) box.scrollTop = cur.offsetTop - 30;
        }, 0);
      }
    }
  }

  function onSquare(idx) {
    if (tr) { onTrainSquare(idx); return; }
    var g = game(ed.ply), turn = g.turn(), piece = g.board()[idx], i;
    if (g.status().over) return;
    if (ed.sel >= 0) {
      var targets = g.targets(ed.sel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = ed.sel;
          ed.sel = -1;
          if (targets[i].promo) askPromotion(turn, from, idx, play); else play(from, idx, null);
          return;
        }
      }
    }
    ed.sel = piece && piece.charAt(0) === turn && idx !== ed.sel ? idx : -1;
    refresh();
  }

  function askPromotion(color, from, to, done) {
    var node = U.el('div', 'promo');
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.fontSize = Math.round(size * 0.8) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { U.closeDialog(); done(from, to, t.toLowerCase()); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: refresh });
  }

  // Joue un coup depuis la position affichée. Au milieu de la ligne, on remplace la suite (après confirmation
  // si le coup diffère de celui déjà noté ; le même coup avance simplement).
  function play(from, to, promo) {
    var m = ed.memo, g = game(ed.ply), rec = g.move(from, to, promo);
    if (!rec) { refresh(); return; }
    var mv = { from: rec.from, to: rec.to, promo: rec.promo || null, san: rec.san };
    var next = m.moves[ed.ply];
    if (next && next.from === mv.from && next.to === mv.to && (next.promo || null) === mv.promo) {
      ed.ply++; U.fx('move'); refresh(); return;
    }
    function apply() {
      m.moves = m.moves.slice(0, ed.ply).concat([mv]);
      ed.ply = m.moves.length;
      U.fx('move');
      save();
      refresh();
    }
    var rest = m.moves.length - ed.ply;
    if (rest > 0) {
      U.confirm('Remplacer la suite ?', 'Les ' + rest + ' coup' + (rest > 1 ? 's' : '') + ' suivant' + (rest > 1 ? 's' : '') +
        ' seront remplacés par ' + mv.san + '.', 'Remplacer', 'Annuler', apply, refresh);
    } else apply();
  }

  function undo() {
    var m = ed.memo;
    if (!m.moves.length) return;
    m.moves = m.moves.slice(0, m.moves.length - 1);
    ed.ply = m.moves.length; ed.sel = -1;
    save();
    refresh();
  }

  /* ---------- Entraînement ---------- */
  function startTraining(side) {
    stopTraining();
    tr = { side: side, ply: 0, errors: 0, hints: 0, hint: false, done: false, timer: null };
    ed.sel = -1;
    ed.orient = side === 'b' ? 'b' : 'w';
    U.$('mme-editpane').style.display = 'none';
    U.$('mme-trainpane').style.display = 'block';
    U.$('mme-nav').style.display = 'none';
    U.$('mme-title').readOnly = true;
    advance();
  }

  function stopTraining() {
    if (!tr) return;
    clearTimeout(tr.timer);
    tr = null;
    ed.sel = -1;
    U.$('mme-editpane').style.display = 'block';
    U.$('mme-trainpane').style.display = 'none';
    U.$('mme-nav').style.display = '';
    U.$('mme-title').readOnly = false;
  }

  // Après chaque coup : fin de la ligne, ou réponse automatique de l'adversaire, ou main au joueur.
  function advance() {
    var t = tr;
    if (t.ply >= ed.memo.moves.length) { t.done = true; U.fx('end'); refresh(); return; }
    if (!Memo.isTrainerMove(t.ply, t.side)) {
      t.timer = setTimeout(function () {
        if (tr !== t) return;
        t.ply++; U.fx('move'); advance();
      }, TRAIN_REPLY_MS);
    }
    refresh();
  }

  function trainerTurn() { return !!tr && !tr.done && tr.ply < ed.memo.moves.length && Memo.isTrainerMove(tr.ply, tr.side); }

  function refreshTraining() {
    var m = ed.memo, n = m.moves.length, g = game(tr.ply), last = null, check = -1;
    if (tr.ply > 0) last = { from: Chess.sqIndex(m.moves[tr.ply - 1].from), to: Chess.sqIndex(m.moves[tr.ply - 1].to) };
    if (g.inCheck()) check = g.kingSquare(g.turn());
    var sel = ed.sel;
    if (sel < 0 && tr.hint && trainerTurn()) sel = Chess.sqIndex(m.moves[tr.ply].from);
    var targets = ed.sel >= 0 && U.getSetting('hints') ? g.targets(ed.sel) : [];
    ed.board.render({ board: g.board(), orient: ed.orient, last: last, sel: sel, targets: targets, check: check, coords: U.getSetting('coords'), faceTop: null });
    var status = U.$('mme-tr-status');
    U.toggleClass(status, 'ok', tr.done && !tr.errors && !tr.hints);
    if (tr.done) status.textContent = !tr.errors && !tr.hints ? 'Parfait ! Ligne entière retrouvée sans faute.' : 'Ligne terminée.';
    else if (trainerTurn()) status.textContent = 'À toi : coup des ' + U.colorName(g.turn()) + (tr.hint ? ' (la pièce à jouer est surlignée)' : '');
    else status.textContent = 'L’adversaire joue…';
    U.$('mme-tr-score').textContent = 'Coup ' + Math.min(tr.ply + 1, n) + ' / ' + n + ' · ' + tr.errors + ' erreur' + (tr.errors > 1 ? 's' : '') +
      ' · ' + tr.hints + ' indice' + (tr.hints > 1 ? 's' : '');
    U.$('mme-tr-hint').disabled = !trainerTurn() || tr.hint;
    U.$('mme-tr-show').disabled = !trainerTurn();
  }

  function onTrainSquare(idx) {
    if (!trainerTurn()) return;
    var g = game(tr.ply), turn = g.turn(), piece = g.board()[idx], i;
    if (ed.sel >= 0) {
      var targets = g.targets(ed.sel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = ed.sel;
          ed.sel = -1;
          if (targets[i].promo) askPromotion(turn, from, idx, tryTrainMove); else tryTrainMove(from, idx, null);
          return;
        }
      }
    }
    ed.sel = piece && piece.charAt(0) === turn && idx !== ed.sel ? idx : -1;
    refresh();
  }

  // Coup du joueur : bon -> on avance ; faux -> compté comme erreur, la position ne bouge pas, il réessaie.
  function tryTrainMove(from, to, promo) {
    if (!trainerTurn()) return;
    var rec = game(tr.ply).move(from, to, promo);
    if (rec && Memo.sameMove(rec, ed.memo.moves[tr.ply])) {
      tr.ply++; tr.hint = false; U.fx('move'); advance();
      return;
    }
    tr.errors++;
    U.fx('warn');
    U.toast(rec ? rec.san + ' : ce n’est pas le coup noté, réessaie.' : 'Coup impossible.');
    refresh();
  }

  function layout() {
    if (!ed.board) return;
    U.layoutSideBoard(ed.board, 'scr-memo-edit', { port: 330, land: 130 });
  }
  window.addEventListener('resize', function () { if (U.hasClass(U.$('scr-memo-edit'), 'active')) layout(); }, false);

  function step(p) { ed.sel = -1; ed.ply = p; refresh(); }

  MV.initScreen = function () {
    U.$('mme-title').maxLength = Memo.TITLE_MAX;
    U.$('mme-notes').maxLength = Memo.NOTES_MAX;
    U.on(U.$('mm-new'), 'click', function () { open(newMemo()); U.$('mme-del').style.display = 'none'; });
    U.on(U.$('mm-search'), 'input', MV.renderList);
    U.on(U.$('mme-back'), 'click', function () { stopTraining(); save(); ed.memo = null; App.show('memo'); });
    U.on(U.$('mme-title'), 'input', function () { ed.memo.title = this.value; save(); });
    U.on(U.$('mme-notes'), 'input', function () { ed.memo.notes = this.value; save(); });
    U.on(U.$('mme-first'), 'click', function () { step(0); });
    U.on(U.$('mme-prev'), 'click', function () { step(ed.ply - 1); });
    U.on(U.$('mme-next'), 'click', function () { step(ed.ply + 1); });
    U.on(U.$('mme-last'), 'click', function () { step(ed.memo.moves.length); });
    U.on(U.$('mme-undo'), 'click', undo);
    U.on(U.$('mme-flip'), 'click', function () { ed.orient = ed.orient === 'w' ? 'b' : 'w'; refresh(); });
    U.on(U.$('mme-train'), 'click', function () {
      if (!ed.memo.moves.length) return;
      U.dialog({
        title: 'S’entraîner', text: 'Rejoue la ligne de mémoire. Quel camp joues-tu ? (l’autre est joué automatiquement)',
        vertical: true,
        buttons: [
          { label: 'Blancs', primary: true, fn: function () { startTraining('w'); } },
          { label: 'Noirs', primary: true, fn: function () { startTraining('b'); } },
          { label: 'Les deux camps', fn: function () { startTraining('both'); } },
          { label: 'Annuler' }
        ]
      });
    });
    U.on(U.$('mme-tr-hint'), 'click', function () {
      if (!trainerTurn() || tr.hint) return;
      tr.hint = true; tr.hints++; ed.sel = -1; refresh();
    });
    U.on(U.$('mme-tr-show'), 'click', function () {
      if (!trainerTurn()) return;
      var mv = ed.memo.moves[tr.ply];
      tr.errors++;
      U.toast('Le coup était ' + mv.san);
      ed.sel = -1; tr.ply++; tr.hint = false; U.fx('move'); advance();
    });
    U.on(U.$('mme-tr-retry'), 'click', function () { if (tr) startTraining(tr.side); });
    U.on(U.$('mme-tr-quit'), 'click', function () { stopTraining(); ed.ply = ed.memo.moves.length; refresh(); });
    U.on(U.$('mme-del'), 'click', function () {
      var id = ed.memo.id;
      remove(id, function () { ed.memo = null; App.show('memo'); });
    });
  };
})();
