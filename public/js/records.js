/* Enregistrement des parties (plateau de départ + coups), écran de revue, et branches (variantes).
 * Une branche diverge d'un coup de la ligne principale : {id, fromPly, label, moves[], createdAt}.
 * Restriction volontaire (v1) : on ne crée/continue des branches que depuis la ligne principale, jamais
 * depuis une autre branche (pas de sous-branches) — ça évite un arbre à profondeur illimitée pour un gain
 * d'usage marginal ; « Continuer cette branche » reprend l'édition de la branche sélectionnée, point. */
(function () {
  'use strict';
  var R = {};
  var recording = null;      // {startPly}

  function load() { return U.store.get('records', []); }
  function persist(list) { U.store.set('records', list); }

  R.reset = function () { recording = null; };
  R.active = function () { return !!recording; };
  R.count = function () { return load().length; };

  function build(ctrl, fromPly, res) {
    var g = ctrl.game;
    var moves = g.history.slice(fromPly).map(function (m) {
      return { from: m.from, to: m.to, promo: m.promo || null, san: m.san };
    });
    return {
      id: String(new Date().getTime()) + Math.floor(Math.random() * 1000),
      date: new Date().getTime(),
      mode: ctrl.mode,
      white: ctrl.names.w, black: ctrl.names.b,
      result: res ? res.result : '*',
      reason: res ? res.reason : null,
      startFen: g.fens[fromPly],
      partial: fromPly > 0,
      moves: moves,
      branches: []
    };
  }

  function save(rec) {
    var list = load();
    list.unshift(rec);
    persist(list);
    U.toast('Partie enregistrée (' + rec.moves.length + ' coups)');
  }

  // Démarre ou arrête l'enregistrement en cours de partie
  R.toggle = function (ctrl) {
    if (!recording) {
      recording = { startPly: ctrl.game.history.length };
      U.toast('Enregistrement démarré : plateau actuel + prochains coups');
      return;
    }
    var from = recording.startPly;
    recording = null;
    if (ctrl.game.history.length <= from) { U.toast('Enregistrement arrêté (aucun coup)'); return; }
    save(build(ctrl, from, ctrl.getResult()));
  };

  // Demande d'enregistrement à la fin d'une partie
  R.promptSave = function (ctrl, resultText, done) {
    var from = recording ? recording.startPly : 0;
    var msg = recording && from > 0
      ? 'Enregistrer la partie à partir du coup ' + (from + 1) + ' (enregistrement en cours) ?'
      : 'Enregistrer cette partie pour la revoir plus tard ?';
    U.dialog({
      title: 'Partie terminée',
      text: resultText + '. ' + msg,
      buttons: [
        { label: 'Non', fn: function () { recording = null; if (done) done(); } },
        { label: 'Enregistrer', primary: true, fn: function () {
          recording = null;
          save(build(ctrl, from, ctrl.getResult()));
          if (done) done();
        } }
      ]
    });
  };

  /* ---------- Liste ---------- */
  function resultLabel(r) {
    if (r.result === '1-0') return 'Blancs gagnent';
    if (r.result === '0-1') return 'Noirs gagnent';
    if (r.result === '1/2-1/2') return 'Nulle';
    return 'Non terminée';
  }

  R.renderList = function () {
    var box = U.$('rec-list'), list = load();
    U.clear(box);
    if (!list.length) {
      box.appendChild(U.el('p', 'hint center', 'Aucune partie enregistrée. Une proposition d’enregistrement apparaît à la fin de chaque partie, ou utilise « Enreg. » pendant une partie.'));
      return;
    }
    list.forEach(function (r) {
      var item = U.el('div', 'item');
      var main = U.el('div', 'main');
      main.appendChild(U.el('div', 'ititle', r.white + ' – ' + r.black));
      main.appendChild(U.el('div', 'isub', U.fmtDate(r.date) + ' · ' + r.moves.length + ' coups · ' + resultLabel(r) +
        (r.partial ? ' · à partir d’une position' : '') + (r.mode === 'online' ? ' · en ligne' : '') +
        (r.branches && r.branches.length ? ' · ' + r.branches.length + ' branche' + (r.branches.length > 1 ? 's' : '') : '')));
      U.on(main, 'click', function () { R.openReplay(r.id); });
      item.appendChild(main);
      item.appendChild(U.button('Suppr.', 'btn small danger', function () { R.remove(r.id, R.renderList); }));
      box.appendChild(item);
    });
  };

  R.remove = function (id, done) {
    U.confirm('Supprimer cette partie ?', 'Cette action est définitive.', 'Supprimer', 'Annuler', function () {
      persist(load().filter(function (r) { return r.id !== id; }));
      if (done) done();
    }, null, true);
  };

  /* ---------- Revue ---------- */
  // rv : {rec, lineMoves, fens, ply, orient, branchId (null = ligne principale), timer, board}
  var rv = { rec: null, lineMoves: [], fens: [], ply: 0, orient: 'w', branchId: null, timer: null, board: null };
  // edit : {fromPly, branchId (id existant ou null = nouvelle branche), game, moves[], aiOn, engineHandle, thinking, destroyed}
  var edit = null, editSel = -1;

  function stopAuto() {
    clearInterval(rv.timer); rv.timer = null;
    var b = U.$('rv-play');
    if (b) b.textContent = 'Lecture';
  }

  function currentBranch() {
    if (!rv.branchId || !rv.rec) return null;
    var bs = rv.rec.branches || [], i;
    for (i = 0; i < bs.length; i++) if (bs[i].id === rv.branchId) return bs[i];
    return null;
  }

  // La ligne actuellement affichée : coups de la branche en édition, sinon de la branche sélectionnée, sinon la ligne principale.
  function activeMoves() {
    if (edit) return rv.rec.moves.slice(0, edit.fromPly).concat(edit.moves);
    var b = currentBranch();
    return b ? rv.rec.moves.slice(0, b.fromPly).concat(b.moves) : rv.rec.moves;
  }

  function rebuildLine() {
    rv.lineMoves = activeMoves();
    var g = Chess.replay(rv.rec.startFen, rv.lineMoves);
    rv.fens = g ? g.fens : [rv.rec.startFen];
    buildMoveList();
  }

  function persistRec() {
    var list = load(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === rv.rec.id) list[i] = rv.rec;
    persist(list);
  }

  function stopEditEngine() {
    if (edit) {
      edit.destroyed = true;
      if (edit.engineHandle) { edit.engineHandle.destroy(); edit.engineHandle = null; }
    }
  }

  function cancelEdit() {
    stopEditEngine();
    edit = null; editSel = -1;
  }

  R.openReplay = function (id) {
    var rec = null, list = load(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) rec = list[i];
    if (!rec) return;
    var g = Chess.replay(rec.startFen, rec.moves);
    if (!g) { U.toast('Partie illisible'); return; }
    if (!rec.branches) rec.branches = [];
    cancelEdit();
    rv.rec = rec; rv.ply = 0; rv.orient = 'w'; rv.branchId = null;
    if (!rv.board) { rv.board = new Board(U.$('rv-board')); rv.board.onSquare = onReplaySquare; }
    U.$('rv-title').textContent = rec.white + ' – ' + rec.black;
    var info = U.fmtDate(rec.date) + ' · ' + resultLabel(rec) + (rec.reason ? ' (' + GameView.reasonText(rec.reason).toLowerCase() + ')' : '');
    U.$('rv-info').textContent = info;
    rebuildLine();
    syncBranchUI();
    App.show('replay');
    stopAuto();
    R.layoutReplay();
    showPly(0);
  };

  function buildMoveList() {
    var box = U.$('rv-moves'), moves = rv.lineMoves, i;
    var fromPly = edit ? edit.fromPly : (currentBranch() ? currentBranch().fromPly : moves.length);
    U.clear(box);
    var fp = rv.rec.startFen.split(' '), startTurn = fp[1], startFull = parseInt(fp[5], 10) || 1;
    for (i = 0; i < moves.length; i++) {
      var white = (startTurn === 'w') === (i % 2 === 0);
      var num = startFull + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
      if (white) box.appendChild(U.el('span', 'mnum', num + '.'));
      else if (i === 0) box.appendChild(U.el('span', 'mnum', num + '…'));
      var s = U.el('span', 'mv' + (i >= fromPly ? ' branch' : ''), moves[i].san);
      s.setAttribute('data-ply', i + 1);
      (function (p) { U.on(s, 'click', function () { if (edit) return; stopAuto(); showPly(p); }); })(i + 1);
      box.appendChild(s);
      box.appendChild(document.createTextNode(' '));
    }
  }

  function showPly(p) {
    var n = rv.lineMoves.length;
    p = Math.max(0, Math.min(n, p));
    rv.ply = p;
    var pos = Chess.parseFen(rv.fens[p]);
    var last = null;
    if (p > 0) last = { from: Chess.sqIndex(rv.lineMoves[p - 1].from), to: Chess.sqIndex(rv.lineMoves[p - 1].to) };
    var check = -1;
    if (p > 0 && /[+#]$/.test(rv.lineMoves[p - 1].san)) {
      for (var s = 0; s < 64; s++) if (pos.board[s] === pos.turn + 'K') check = s;
    }
    var atTip = !!edit && p === n;
    var sel = atTip ? editSel : -1;
    var targets = (atTip && editSel >= 0) ? edit.game.targets(editSel) : [];
    rv.board.render({ board: pos.board, orient: rv.orient, last: last, sel: sel, targets: U.getSetting('hints') ? targets : [], check: check, coords: U.getSetting('coords'), faceTop: null });
    U.$('rv-count').textContent = p + ' / ' + n;
    var spans = U.$('rv-moves').getElementsByClassName('mv'), i;
    for (i = 0; i < spans.length; i++) {
      var on = parseInt(spans[i].getAttribute('data-ply'), 10) === p;
      U.toggleClass(spans[i], 'cur', on);
      if (on) {
        var box = U.$('rv-moves');
        if (spans[i].offsetTop < box.scrollTop || spans[i].offsetTop > box.scrollTop + box.clientHeight - 30) box.scrollTop = spans[i].offsetTop - 30;
      }
    }
  }

  R.layoutReplay = function () {
    if (!rv.board) return;
    var vp = U.viewport();
    var land = vp.w > vp.h * 1.25;
    var size = land ? Math.min(vp.h - 70, vp.w * 0.55) : Math.min(vp.w - 12, vp.h - 330);
    rv.board.setSize(Math.max(160, size));
    U.toggleClass(U.$('scr-replay'), 'land', land);
  };
  window.addEventListener('resize', function () { if (U.hasClass(U.$('scr-replay'), 'active')) R.layoutReplay(); }, false);

  /* ---------- Branches : création / poursuite ---------- */
  function syncBranchUI() {
    var btn = U.$('rv-branch-new');
    if (edit) { btn.style.display = 'none'; }
    else if (rv.branchId) { btn.style.display = 'block'; btn.textContent = 'Continuer cette branche'; }
    else { btn.style.display = 'block'; btn.textContent = '+ Nouvelle branche depuis ce coup'; }
    renderEdit();
    renderBranchChips();
  }

  function renderBranchChips() {
    var box = U.$('rv-branches');
    U.clear(box);
    var main = U.el('button', 'chip' + (!rv.branchId ? ' on' : ''));
    main.type = 'button';
    main.textContent = 'Ligne principale';
    U.on(main, 'click', function () {
      if (edit) return;
      rv.branchId = null; rebuildLine(); showPly(Math.min(rv.ply, rv.lineMoves.length)); syncBranchUI();
    });
    box.appendChild(main);
    (rv.rec.branches || []).forEach(function (b) {
      var chip = U.el('button', 'chip' + (rv.branchId === b.id ? ' on' : ''));
      chip.type = 'button';
      chip.textContent = b.label + ' (' + b.moves.length + ')';
      U.on(chip, 'click', function () {
        if (edit) return;
        rv.branchId = b.id; rebuildLine(); showPly(rv.lineMoves.length); syncBranchUI();
      });
      box.appendChild(chip);
    });
  }

  function startNewBranch() {
    if (edit || rv.branchId) return;
    var fromPly = rv.ply;
    var g = Chess.replay(rv.rec.startFen, rv.rec.moves.slice(0, fromPly));
    if (!g) { U.toast('Position illisible.'); return; }
    edit = { fromPly: fromPly, branchId: null, game: g, moves: [], aiOn: false, engineHandle: null, thinking: false, destroyed: false };
    editSel = -1;
    rebuildLine();
    showPly(fromPly);
    syncBranchUI();
  }

  function continueBranch(b) {
    if (edit || !b) return;
    var baseMoves = rv.rec.moves.slice(0, b.fromPly).concat(b.moves);
    var g = Chess.replay(rv.rec.startFen, baseMoves);
    if (!g) { U.toast('Branche illisible.'); return; }
    edit = { fromPly: b.fromPly, branchId: b.id, game: g, moves: b.moves.slice(), aiOn: false, engineHandle: null, thinking: false, destroyed: false };
    editSel = -1;
    rebuildLine();
    showPly(rv.lineMoves.length);
    syncBranchUI();
  }

  function renderEdit() {
    var box = U.$('rv-edit');
    box.style.display = edit ? 'block' : 'none';
    if (!edit) return;
    var g = edit.game, res = g.status(), status = U.$('rv-edit-status');
    var turnName = g.turn() === 'w' ? (rv.rec.white || 'Blancs') : (rv.rec.black || 'Noirs');
    status.textContent = edit.thinking ? 'L’IA (' + turnName + ') réfléchit…' :
      (res.over ? 'Terminé : ' + GameView.reasonText(res.reason).toLowerCase() : 'Trait aux ' + (g.turn() === 'w' ? 'Blancs' : 'Noirs') + ' (' + turnName + ')');
    U.$('rv-edit-ai').checked = edit.aiOn;
    U.$('rv-edit-ai').disabled = res.over;
    U.$('rv-edit-undo').disabled = !edit.moves.length || edit.thinking;
  }

  function onReplaySquare(idx) {
    if (!edit || edit.aiOn || edit.thinking || rv.ply !== rv.lineMoves.length || edit.game.status().over) return;
    var g = edit.game, piece = g.board()[idx], turn = g.turn(), i;
    if (editSel >= 0) {
      var targets = g.targets(editSel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = editSel, promo = targets[i].promo;
          editSel = -1;
          if (promo) { askEditPromotion(turn, from, idx); return; }
          playEditMove(from, idx, null);
          return;
        }
      }
    }
    if (piece && piece.charAt(0) === turn && idx !== editSel) editSel = idx; else editSel = -1;
    showPly(rv.ply);
  }

  function askEditPromotion(color, from, to) {
    var node = U.el('div', 'promo');
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { U.closeDialog(); playEditMove(from, to, t.toLowerCase()); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: function () { showPly(rv.ply); } });
  }

  function playEditMove(from, to, promo) {
    if (!edit) return;
    var rec = edit.game.move(from, to, promo);
    if (!rec) return;
    edit.moves.push({ from: rec.from, to: rec.to, promo: rec.promo || null, san: rec.san });
    U.fx('move');
    rebuildLine();
    showPly(rv.lineMoves.length);
    renderEdit();
    if (!edit.game.status().over && edit.aiOn) askEngineForEdit();
  }

  function editUndo() {
    if (!edit || !edit.moves.length || edit.thinking) return;
    edit.game.undo();
    edit.moves.pop();
    rebuildLine();
    showPly(rv.lineMoves.length);
    renderEdit();
  }

  // IA : joue le coup du camp au trait, avec sa propre note (celle suivie sous le nom de ce camp dans
  // l'onglet Classement, sinon la note par défaut) — « la même note » que ce joueur a actuellement.
  function askEngineForEdit() {
    if (!edit || edit.destroyed || edit.game.status().over) return;
    var g = edit.game, color = g.turn();
    var name = color === 'w' ? rv.rec.white : rv.rec.black;
    var player = name && Elo.player(U.store.get('elo', Elo.newDb()), name);
    var elo = player ? player.rating : Elo.DEFAULT_RATING;
    edit.thinking = true;
    renderEdit();
    function go() {
      edit.engineHandle.setStrength(elo);
      edit.engineHandle.bestMove(g.fen(), function (mv) {
        if (!edit || edit.destroyed) return;
        edit.thinking = false;
        if (!mv) { U.toast('L’IA n’a pas trouvé de coup.'); renderEdit(); return; }
        playEditMove(mv.from, mv.to, mv.promo);
      });
    }
    if (edit.engineHandle) { go(); return; }
    if (!Engine.supported()) { edit.thinking = false; edit.aiOn = false; U.toast('IA indisponible sur ce navigateur (Web Worker).'); renderEdit(); return; }
    Engine.create(function (err, h) {
      if (!edit || edit.destroyed) { if (h) h.destroy(); return; }
      if (err) { edit.thinking = false; edit.aiOn = false; U.toast(err.message); renderEdit(); return; }
      edit.engineHandle = h;
      go();
    });
  }

  function finishBranch() {
    if (!edit) return;
    if (!edit.moves.length) { var hadBranch = !!edit.branchId; cancelEdit(); if (!hadBranch) rv.branchId = null; rebuildLine(); showPly(rv.ply); syncBranchUI(); return; }
    var bs = rv.rec.branches || (rv.rec.branches = []), i;
    if (edit.branchId) {
      for (i = 0; i < bs.length; i++) if (bs[i].id === edit.branchId) bs[i].moves = edit.moves.slice();
      rv.branchId = edit.branchId;
    } else {
      var nb = { id: String(new Date().getTime()) + Math.floor(Math.random() * 1000), fromPly: edit.fromPly, label: 'Variante ' + (bs.length + 1), moves: edit.moves.slice(), createdAt: new Date().getTime() };
      bs.push(nb);
      rv.branchId = nb.id;
    }
    persistRec();
    cancelEdit();
    rebuildLine();
    showPly(rv.lineMoves.length);
    syncBranchUI();
    U.toast('Branche enregistrée');
  }

  function discardBranch() {
    if (!edit) return;
    if (!edit.branchId) { cancelEdit(); rv.branchId = null; rebuildLine(); showPly(rv.ply); syncBranchUI(); return; }
    var id = edit.branchId;
    U.confirm('Supprimer cette branche ?', 'Cette action est définitive.', 'Supprimer', 'Annuler', function () {
      rv.rec.branches = (rv.rec.branches || []).filter(function (b) { return b.id !== id; });
      persistRec();
      cancelEdit();
      rv.branchId = null;
      rebuildLine();
      showPly(rv.ply);
      syncBranchUI();
      U.toast('Branche supprimée');
    }, null, true);
  }

  R.initReplay = function () {
    U.on(U.$('rv-first'), 'click', function () { if (edit) return; stopAuto(); showPly(0); });
    U.on(U.$('rv-prev'), 'click', function () { if (edit) return; stopAuto(); showPly(rv.ply - 1); });
    U.on(U.$('rv-next'), 'click', function () { if (edit) return; stopAuto(); showPly(rv.ply + 1); });
    U.on(U.$('rv-last'), 'click', function () { if (edit) return; stopAuto(); showPly(rv.lineMoves.length); });
    U.on(U.$('rv-flip'), 'click', function () { rv.orient = rv.orient === 'w' ? 'b' : 'w'; showPly(rv.ply); });
    U.on(U.$('rv-play'), 'click', function () {
      if (edit) return;
      if (rv.timer) { stopAuto(); return; }
      if (rv.ply >= rv.lineMoves.length) showPly(0);
      U.$('rv-play').textContent = 'Pause';
      rv.timer = setInterval(function () {
        if (rv.ply >= rv.lineMoves.length) { stopAuto(); return; }
        showPly(rv.ply + 1);
        U.fx('move');
      }, 1200);
    });
    U.on(U.$('rv-pgn'), 'click', function () {
      var g = Chess.replay(rv.rec.startFen, rv.rec.moves);
      var text = g.pgn({ White: rv.rec.white, Black: rv.rec.black, Result: rv.rec.result });
      var ta = U.el('textarea', 'pgn');
      ta.value = text; ta.readOnly = true;
      U.dialog({
        title: 'PGN (ligne principale)', node: ta,
        buttons: [
          { label: 'Fermer' },
          { label: 'Copier', primary: true, keep: true, fn: function () { U.copy(text, function (ok) { U.toast(ok ? 'PGN copié' : 'Copie impossible : sélectionne le texte'); }); } }
        ]
      });
    });
    U.on(U.$('rv-del'), 'click', function () {
      cancelEdit();
      R.remove(rv.rec.id, function () { stopAuto(); App.show('records'); });
    });
    U.on(U.$('rv-back'), 'click', function () { cancelEdit(); stopAuto(); App.show('records'); });

    U.on(U.$('rv-branch-new'), 'click', function () {
      if (rv.branchId) continueBranch(currentBranch());
      else startNewBranch();
    });
    U.on(U.$('rv-edit-ai'), 'change', function () {
      if (!edit) return;
      edit.aiOn = this.checked;
      renderEdit();
      if (edit.aiOn && !edit.thinking && !edit.game.status().over) askEngineForEdit();
    });
    U.on(U.$('rv-edit-undo'), 'click', editUndo);
    U.on(U.$('rv-edit-done'), 'click', finishBranch);
    U.on(U.$('rv-edit-discard'), 'click', discardBranch);
  };

  window.Rec = R;
})();
