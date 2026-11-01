/* Aide-mémoire : liste des enchaînements et éditeur (échiquier + titre + notes). Logique pure dans memo.js.
 * Données propres à l'appareil (localStorage « memos ») : jamais envoyées, ni partagées, ni exportées.
 * Enregistrement automatique à chaque changement ; une fiche restée vide n'est pas conservée. */
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

  function newMemo() {
    var now = new Date().getTime();
    return { id: String(now) + Math.floor(Math.random() * 1000), title: '', notes: '', moves: [], created: now, updated: now };
  }

  function open(memo) {
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
    var g = game(ed.ply), turn = g.turn(), piece = g.board()[idx], i;
    if (g.status().over) return;
    if (ed.sel >= 0) {
      var targets = g.targets(ed.sel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = ed.sel;
          ed.sel = -1;
          if (targets[i].promo) askPromotion(turn, from, idx); else play(from, idx, null);
          return;
        }
      }
    }
    ed.sel = piece && piece.charAt(0) === turn && idx !== ed.sel ? idx : -1;
    refresh();
  }

  function askPromotion(color, from, to) {
    var node = U.el('div', 'promo');
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.fontSize = Math.round(size * 0.8) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { U.closeDialog(); play(from, to, t.toLowerCase()); });
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

  function layout() {
    if (!ed.board) return;
    var vp = U.viewport();
    var land = vp.w > vp.h * 1.25;
    var size = land ? Math.min(vp.h - 70, vp.w * 0.55) : Math.min(vp.w - 12, vp.h - 330);
    ed.board.setSize(Math.max(160, size));
    U.toggleClass(U.$('scr-memo-edit'), 'land', land);
  }
  window.addEventListener('resize', function () { if (U.hasClass(U.$('scr-memo-edit'), 'active')) layout(); }, false);

  function step(p) { ed.sel = -1; ed.ply = p; refresh(); }

  MV.initScreen = function () {
    U.$('mme-title').maxLength = Memo.TITLE_MAX;
    U.$('mme-notes').maxLength = Memo.NOTES_MAX;
    U.on(U.$('mm-new'), 'click', function () { open(newMemo()); U.$('mme-del').style.display = 'none'; });
    U.on(U.$('mm-search'), 'input', MV.renderList);
    U.on(U.$('mme-back'), 'click', function () { save(); ed.memo = null; App.show('memo'); });
    U.on(U.$('mme-title'), 'input', function () { ed.memo.title = this.value; save(); });
    U.on(U.$('mme-notes'), 'input', function () { ed.memo.notes = this.value; save(); });
    U.on(U.$('mme-first'), 'click', function () { step(0); });
    U.on(U.$('mme-prev'), 'click', function () { step(ed.ply - 1); });
    U.on(U.$('mme-next'), 'click', function () { step(ed.ply + 1); });
    U.on(U.$('mme-last'), 'click', function () { step(ed.memo.moves.length); });
    U.on(U.$('mme-undo'), 'click', undo);
    U.on(U.$('mme-flip'), 'click', function () { ed.orient = ed.orient === 'w' ? 'b' : 'w'; refresh(); });
    U.on(U.$('mme-del'), 'click', function () {
      var id = ed.memo.id;
      remove(id, function () { ed.memo = null; App.show('memo'); });
    });
  };
})();
