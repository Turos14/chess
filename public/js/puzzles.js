/* Problèmes d'échecs : liste publique partagée (public/data/puzzles.json), ajoutée par n'importe qui via
 * un ticket GitHub (voir .github/ISSUE_TEMPLATE/puzzle.yml et .github/workflows/puzzle-intake.yml). L'appli
 * reste 100 % statique côté client : elle ne fait qu'ouvrir un ticket GitHub pré-rempli, c'est une Action
 * GitHub qui valide (avec ce même moteur chess.js) et publie en committant le JSON — visible de tout le
 * monde après republication du site (~1 min), sans backend à nous.
 *
 * Format d'un problème : {id, fen, solution:[coups UCI...], title, author, category, difficulty, description,
 * addedAt, editedAt}. `fen`
 * est la position où le joueur qui doit trouver le coup a le trait. `solution` alterne : le coup à trouver, puis
 * la réponse forcée de l'adversaire (rejouée automatiquement), etc. — ex: ["d1h5","g7g6","h5f7"] (1 coup à
 * trouver, 1 réponse, 1 coup à trouver). Un problème peut aussi n'avoir qu'un seul coup (mat en 1, ou simple
 * tactique). `category` (optionnel : texte libre choisi par le créateur, ou liste de textes pour classer un
 * problème dans plusieurs onglets) et `difficulty` (optionnel, un de DIFFICULTIES) servent uniquement de filtres
 * côté client — aucune incidence sur la résolution. */
(function () {
  'use strict';
  var P = {};
  var REPO = 'https://github.com/Turos14/chess';
  var DESCRIPTION_MAX = 1000;   // même limite que scripts/puzzle-common.js
  // Relais (dossier relais/ du dépôt, hébergé à part) : permet de proposer / modifier / supprimer un problème sans
  // compte GitHub. Vide = pas encore en ligne : on ouvre alors un ticket GitHub pré-rempli comme avant (et aussi
  // si le relais ne répond pas). window.PUZZLE_RELAY permet de le remplacer (tests).
  var RELAY_URL = window.PUZZLE_RELAY || 'https://chess-relais.vercel.app/api/submit';
  var DIFFICULTIES = ['facile', 'moyen', 'difficile'];
  var DIFF_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };
  var allPuzzles = null, visiblePuzzles = null;
  var filterCategory = 'all', filterDifficulty = 'all', diffFilterSeg = null, searchText = '', searchIn = null;

  function solvedIds() { return U.store.get('puzzlesSolved', []); }
  function markSolved(id) {
    var list = solvedIds();
    if (list.indexOf(id) < 0) { list.push(id); U.store.set('puzzlesSolved', list); }
  }

  function parseUci(u) {
    return { from: u.slice(0, 2), to: u.slice(2, 4), promo: u.length > 4 ? u.charAt(4) : null };
  }

  /* ---------- Validation (identique à ce que vérifie l'Action GitHub côté serveur) ---------- */
  // Retourne null si valide, sinon un message d'erreur.
  function validatePuzzle(fen, solutionRaw) {
    if (!fen || !fen.replace(/^\s+|\s+$/g, '')) return 'FEN manquante.';
    var uci = (solutionRaw || '').replace(/^\s+|\s+$/g, '').split(/\s+/).filter(function (s) { return s; });
    if (!uci.length) return 'Indique au moins un coup de solution.';
    var g;
    try { g = Chess.replay(fen, []); } catch (e) { return 'FEN invalide : ' + e.message; }
    if (!g) return 'FEN invalide.';
    for (var i = 0; i < uci.length; i++) {
      var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(uci[i]);
      if (!m) return 'Coup illisible : « ' + uci[i] + ' » (format attendu : e2e4, ou e7e8q pour une promotion).';
      var rec = g.move(m[1], m[2], m[3] || null);
      if (!rec) return 'Le coup n°' + (i + 1) + ' (« ' + uci[i] + ' ») n’est pas légal dans cette position.';
    }
    return null;
  }

  /* ---------- Chargement ---------- */
  function loadPuzzles(cb) {
    // Anti-cache volontairement agressif ici (horodatage, pas juste ?v=N) : contrairement au code, la liste
    // de problèmes change sans déploiement (dès qu'une Action GitHub committe un nouveau problème), donc la
    // convention "?v=N à incrémenter manuellement" ne suffit pas pour ces données.
    U.ajax('GET', 'data/puzzles.json?t=' + new Date().getTime(), null, function (err, list) {
      if (err || !list) { cb(err || { message: 'réponse invalide' }); return; }
      cb(null, list);
    });
  }

  /* ---------- Écran liste (avec onglets de catégorie + filtre de niveau) ---------- */
  // Catégories d'un problème, nettoyées : `category` peut être un texte ou une liste de textes.
  function categoriesOf(p) {
    var raw = p.category == null ? [] : (Object.prototype.toString.call(p.category) === '[object Array]' ? p.category : [p.category]);
    var out = [];
    raw.forEach(function (c) {
      c = String(c == null ? '' : c).replace(/^\s+|\s+$/g, '');
      if (c) out.push(c);
    });
    return out;
  }

  // Texte comparable pour la recherche : minuscules, sans accents (normalize absent des vieux navigateurs :
  // on se contente alors des minuscules).
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s;
  }

  function matchesSearch(p) {
    var words = fold(searchText).split(/\s+/).filter(function (w) { return w; });
    if (!words.length) return true;
    var hay = fold([p.title || '', p.author || '', p.id || '', p.difficulty ? DIFF_LABEL[p.difficulty] : '', p.description || ''].concat(categoriesOf(p)).join(' '));
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    return true;
  }

  // Catégories distinctes présentes dans la liste, triées, dédupliquées insensible à la casse (garde la 1ère
  // casse rencontrée pour l'affichage) — ce sont elles qui deviennent les onglets, aucune liste figée à l'avance.
  function computeCategories(list) {
    var seen = {}, out = [];
    list.forEach(function (p) {
      categoriesOf(p).forEach(function (c) {
        var key = c.toLowerCase();
        if (!seen[key]) { seen[key] = true; out.push(c); }
      });
    });
    out.sort(function (a, b) { return a.localeCompare ? a.localeCompare(b, 'fr') : (a < b ? -1 : a > b ? 1 : 0); });
    return out;
  }

  function applyFilters() {
    visiblePuzzles = (allPuzzles || []).filter(function (p) {
      if (filterCategory !== 'all' && categoriesOf(p).map(function (c) { return c.toLowerCase(); }).indexOf(filterCategory) < 0) return false;
      if (filterDifficulty !== 'all' && (p.difficulty || '') !== filterDifficulty) return false;
      return matchesSearch(p);
    });
  }

  function renderFilterBar() {
    var catBox = U.$('pz-categories');
    U.clear(catBox);
    var cats = computeCategories(allPuzzles || []);
    // Si la catégorie actuellement filtrée a disparu (ses problèmes ont tous été supprimés), repart de "Tous"
    // plutôt que de rester bloqué sur une liste vide sans onglet pour en sortir.
    if (filterCategory !== 'all' && cats.map(function (c) { return c.toLowerCase(); }).indexOf(filterCategory) < 0) {
      filterCategory = 'all';
    }
    catBox.style.display = cats.length ? '' : 'none';
    function catBtn(label, key) {
      var b = U.button(label, 'chip' + (filterCategory === key ? ' on' : ''), function () {
        filterCategory = key;
        renderFilterBar();
        applyFilters();
        renderItems();
      });
      return b;
    }
    if (cats.length) catBox.appendChild(catBtn('Tous', 'all'));
    cats.forEach(function (c) { catBox.appendChild(catBtn(c, c.toLowerCase())); });

    var diffOptions = [{ v: 'all', label: 'Tous niveaux' }];
    DIFFICULTIES.forEach(function (d) { diffOptions.push({ v: d, label: DIFF_LABEL[d] }); });
    diffFilterSeg = U.segmented(U.$('pz-difficulty'), diffOptions, filterDifficulty, function (v) {
      filterDifficulty = v;
      applyFilters();
      renderItems();
    });

    if (!searchIn) {
      searchIn = U.$('pz-search');
      var onSearch = function () {
        if (searchIn.value === searchText) return;
        searchText = searchIn.value;
        applyFilters();
        renderItems();
      };
      U.on(searchIn, 'input', onSearch);
      U.on(searchIn, 'keyup', onSearch);   // anciens navigateurs sans évènement « input » fiable
    }
    searchIn.value = searchText;
  }

  function renderItems() {
    var box = U.$('pz-list');
    U.clear(box);
    if (!allPuzzles.length) {
      box.appendChild(U.el('p', 'hint center', 'Aucun problème pour l’instant. Sois le premier à en proposer un !'));
      return;
    }
    if (!visiblePuzzles.length) {
      box.appendChild(U.el('p', 'hint center', searchText.replace(/\s+/g, '') ? 'Aucun problème ne correspond à cette recherche.' : 'Aucun problème ne correspond à ces filtres.'));
      return;
    }
    var solved = solvedIds();
    visiblePuzzles.forEach(function (p) {
      var item = U.el('div', 'item');
      var main = U.el('div', 'main');
      main.appendChild(U.el('div', 'ititle', (solved.indexOf(p.id) >= 0 ? '✓ ' : '') + (p.title || ('Problème #' + p.id))));
      var nMoves = p.solution ? p.solution.length : 0;
      var bits = [(p.author ? 'par ' + p.author : 'anonyme'), nMoves + ' coup' + (nMoves > 1 ? 's' : '') + ' à trouver'];
      if (p.difficulty) bits.push(DIFF_LABEL[p.difficulty]);
      if (categoriesOf(p).length) bits.push(categoriesOf(p).join(', '));
      main.appendChild(U.el('div', 'isub', bits.join(' · ')));
      U.on(main, 'click', function () { P.open(p); });
      item.appendChild(main);
      item.appendChild(U.button('Modif.', 'btn small', function () { P.openEditor(p); }));
      item.appendChild(U.button('Suppr.', 'btn small danger', function () { requestDeletion(p); }));
      box.appendChild(item);
    });
  }

  P.renderList = function () {
    var box = U.$('pz-list'), status = U.$('pz-status');
    U.clear(box);
    status.textContent = 'Chargement…';
    loadPuzzles(function (err, list) {
      if (!U.hasClass(U.$('scr-puzzles'), 'active')) return;   // l'utilisateur est reparti entre-temps
      if (err) { status.textContent = 'Impossible de charger les problèmes (' + err.message + ').'; return; }
      status.textContent = '';
      allPuzzles = list;
      renderFilterBar();
      applyFilters();
      renderItems();
    });
  };

  /* ---------- Écran résolution ---------- */
  // sv : {puzzle, game, sel, solIdx (prochain coup attendu), state, orient}
  var sv = null, boardInst = null;
  var revealTimer = null, flashTimer = null;

  function stopTimers() {
    clearInterval(revealTimer); revealTimer = null;
    clearTimeout(flashTimer); flashTimer = null;
  }

  function openPuzzle(p) {
    stopTimers();
    sv = { puzzle: p, game: Chess.replay(p.fen, []), sel: -1, solIdx: 0, state: 'playing', orient: null };
    if (!sv.game) { U.toast('Problème illisible.'); return; }
    sv.orient = sv.game.turn();
    if (!boardInst) { boardInst = new Board(U.$('pzs-board')); boardInst.onSquare = onSolveSquare; }
    sv.board = boardInst;
    U.$('pzs-title').textContent = p.title || ('Problème #' + p.id);
    var infoBits = [(p.author ? 'Proposé par ' + p.author : 'Anonyme'), 'trouve le coup des ' + (sv.orient === 'w' ? 'Blancs' : 'Noirs') + '.'];
    if (p.difficulty) infoBits.push(DIFF_LABEL[p.difficulty]);
    if (categoriesOf(p).length) infoBits.push(categoriesOf(p).join(', '));
    U.$('pzs-info').textContent = infoBits.join(' · ');
    var desc = U.$('pzs-desc');
    desc.textContent = p.description || '';
    desc.style.display = p.description ? '' : 'none';
    App.show('puzzle-solve');
    layoutSolve();
    renderSolve();
  }

  P.open = function (p) { openPuzzle(p); };

  function expectedMove() { return parseUci(sv.puzzle.solution[sv.solIdx]); }

  function renderSolve() {
    if (!sv) return;
    var g = sv.game, last = g.lastMove();
    var check = -1;
    if (last && /[+#]$/.test(last.san)) {
      var board = g.board();
      for (var s = 0; s < 64; s++) if (board[s] === g.turn() + 'K') check = s;
    }
    var targets = (sv.state === 'playing' && sv.sel >= 0) ? g.targets(sv.sel) : [];
    sv.board.render({
      board: g.board(), orient: sv.orient,
      last: last ? { from: Chess.sqIndex(last.from), to: Chess.sqIndex(last.to) } : null,
      sel: sv.state === 'playing' ? sv.sel : -1,
      targets: U.getSetting('hints') ? targets : [],
      check: check, coords: U.getSetting('coords'), faceTop: null
    });
    var status = U.$('pzs-status');
    status.className = 'hint center';
    if (sv.state === 'solved') { status.textContent = '✅ Résolu !'; U.addClass(status, 'ok'); }
    else if (sv.state === 'failed') { status.textContent = '❌ Ce n’est pas le bon coup — réessaie.'; status.className = 'error'; }
    else if (sv.state === 'revealed') status.textContent = sv.solIdx >= sv.puzzle.solution.length ? 'Solution affichée.' : 'Solution en cours d’affichage…';
    else status.textContent = 'Trait aux ' + (g.turn() === 'w' ? 'Blancs' : 'Noirs') + '.';
    U.$('pzs-next').disabled = false;
  }

  function onSolveSquare(idx) {
    if (!sv || sv.state !== 'playing') return;
    var g = sv.game, piece = g.board()[idx], turn = g.turn(), i;
    if (sv.sel >= 0) {
      var targets = g.targets(sv.sel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = sv.sel, promo = targets[i].promo;
          sv.sel = -1;
          if (promo) { askSolvePromotion(turn, from, idx); return; }
          trySolveMove(from, idx, null);
          return;
        }
      }
    }
    if (piece && piece.charAt(0) === turn && idx !== sv.sel) sv.sel = idx; else sv.sel = -1;
    renderSolve();
  }

  function askSolvePromotion(color, from, to) {
    var node = U.el('div', 'promo');
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.fontSize = Math.round(size * 0.8) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { U.closeDialog(); trySolveMove(from, to, t.toLowerCase()); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: function () { renderSolve(); } });
  }

  function finishIfDone() {
    if (sv.solIdx >= sv.puzzle.solution.length) {
      sv.state = 'solved';
      markSolved(sv.puzzle.id);
      U.fx('end');
      return true;
    }
    return false;
  }

  function trySolveMove(from, to, promo) {
    if (!sv) return;
    var exp = expectedMove();
    var fromName = Chess.sqName(from), toName = Chess.sqName(to);
    var matches = exp.from === fromName && exp.to === toName && (!exp.promo || exp.promo === (promo || 'q'));
    if (!matches) {
      sv.state = 'failed';
      renderSolve();
      U.fx('warn');
      flashTimer = setTimeout(function () { if (sv && sv.state === 'failed') { sv.state = 'playing'; renderSolve(); } }, 900);
      return;
    }
    var rec = sv.game.move(from, to, promo);
    if (!rec) { sv.state = 'failed'; renderSolve(); return; }
    U.fx('move');
    sv.solIdx++;
    if (finishIfDone()) { renderSolve(); return; }
    renderSolve();
    // Réponse forcée de l'adversaire, rejouée automatiquement
    flashTimer = setTimeout(function () {
      if (!sv) return;
      var reply = expectedMove();
      var r = sv.game.move(reply.from, reply.to, reply.promo);
      if (r) { sv.solIdx++; U.fx('move'); }
      finishIfDone();
      renderSolve();
    }, 550);
  }

  function retry() {
    if (!sv) return;
    stopTimers();
    sv.game = Chess.replay(sv.puzzle.fen, []);
    sv.sel = -1; sv.solIdx = 0; sv.state = 'playing';
    renderSolve();
  }

  function hint() {
    if (!sv || sv.state !== 'playing') return;
    var exp = expectedMove();
    U.toast('Indice : le coup part de la case ' + exp.from);
  }

  function revealSolution() {
    if (!sv) return;
    stopTimers();
    sv.state = 'revealed';
    renderSolve();
    revealTimer = setInterval(function () {
      if (!sv || sv.solIdx >= sv.puzzle.solution.length) { clearInterval(revealTimer); revealTimer = null; return; }
      var u = expectedMove();
      var r = sv.game.move(u.from, u.to, u.promo);
      if (r) { sv.solIdx++; U.fx('move'); renderSolve(); } else { clearInterval(revealTimer); revealTimer = null; }
    }, 650);
  }

  function next() {
    if (!sv || !visiblePuzzles || !visiblePuzzles.length) return;
    var cur = -1, i;
    for (i = 0; i < visiblePuzzles.length; i++) if (visiblePuzzles[i].id === sv.puzzle.id) { cur = i; break; }
    openPuzzle(visiblePuzzles[(cur + 1) % visiblePuzzles.length]);
  }

  P.layoutSolve = layoutSolve;
  function layoutSolve() {
    if (!sv || !sv.board) return;
    var vp = U.viewport();
    var land = vp.w > vp.h * 1.25;
    var size = land ? Math.min(vp.h - 70, vp.w * 0.55) : Math.min(vp.w - 12, vp.h - 300);
    sv.board.setSize(Math.max(160, size));
    U.toggleClass(U.$('scr-puzzle-solve'), 'land', land);
  }
  window.addEventListener('resize', function () { if (U.hasClass(U.$('scr-puzzle-solve'), 'active')) layoutSolve(); }, false);

  /* ---------- Éditeur : placement des pièces (phase 1) puis coups de la solution (phase 2) ---------- */
  // ed : {phase:1|2, board:[64], turn:'w'|'b', tool (code pièce 'wK'.. ou 'erase' ou null),
  //       fen, game, sel, moves:[uci...], sanList:[san...]} — null quand l'éditeur n'est pas ouvert.
  var ed = null, editorBoard = null, turnSeg = null;
  var PALETTE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
  var paletteBtns = null;

  function emptyBoard() { var b = [], i; for (i = 0; i < 64; i++) b.push(null); return b; }
  function startBoard() { return Chess.parseFen(Chess.START).board; }

  // Droits de roque déduits de la position : autorisé dès que le roi et la tour concernés sont
  // chacun sur leur case de départ (même convention que les éditeurs de position habituels — on ne
  // peut pas savoir, à partir d'un simple placement de pièces, si le roi/la tour ont déjà bougé).
  function castlingRights(board) {
    var cs = '';
    if (board[Chess.sqIndex('e1')] === 'wK' && board[Chess.sqIndex('h1')] === 'wR') cs += 'K';
    if (board[Chess.sqIndex('e1')] === 'wK' && board[Chess.sqIndex('a1')] === 'wR') cs += 'Q';
    if (board[Chess.sqIndex('e8')] === 'bK' && board[Chess.sqIndex('h8')] === 'bR') cs += 'k';
    if (board[Chess.sqIndex('e8')] === 'bK' && board[Chess.sqIndex('a8')] === 'bR') cs += 'q';
    return cs || '-';
  }

  function boardToFen(board, turn) {
    var rows = [], r, f, s, p, row, empty;
    for (r = 0; r < 8; r++) {
      row = ''; empty = 0;
      for (f = 0; f < 8; f++) {
        s = r * 8 + f; p = board[s];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p.charAt(0) === 'w' ? p.charAt(1) : p.charAt(1).toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/') + ' ' + turn + ' ' + castlingRights(board) + ' - 0 1';
  }

  function buildPalette() {
    var box = U.$('pze-palette');
    U.clear(box);
    paletteBtns = {};
    PALETTE.forEach(function (code) {
      var b = U.el('button', 'pzbtn');
      b.type = 'button';
      b.appendChild(U.el('div', 'pc pc-' + code));
      U.on(b, 'click', function () { if (ed) { ed.tool = code; renderPalette(); } });
      paletteBtns[code] = b;
      box.appendChild(b);
    });
    var er = U.el('button', 'pzbtn erase', '✕');
    er.type = 'button';
    U.on(er, 'click', function () { if (ed) { ed.tool = 'erase'; renderPalette(); } });
    paletteBtns.erase = er;
    box.appendChild(er);
  }

  function renderPalette() {
    if (!paletteBtns) return;
    var k;
    for (k in paletteBtns) if (paletteBtns.hasOwnProperty(k)) U.toggleClass(paletteBtns[k], 'on', !!ed && ed.tool === k);
  }

  // editing : problème existant à modifier (bouton « Modif. ») — l'éditeur s'ouvre alors directement sur ses coups
  // de solution, rejoués depuis sa position (« ‹ Échiquier » pour changer la position elle-même).
  P.openEditor = function (editing) {
    ed = { phase: 1, board: startBoard(), turn: 'w', tool: null, fen: null, game: null, sel: -1, moves: [], sanList: [], editing: editing || null };
    if (!editorBoard) { editorBoard = new Board(U.$('pze-board')); editorBoard.onSquare = onEditorSquare; }
    if (!paletteBtns) buildPalette();
    if (editing) loadIntoEditor(editing);
    if (turnSeg) turnSeg.set(ed.turn);
    U.$('pze-err1').textContent = '';
    U.$('pze-heading').textContent = editing ? 'Modifier un problème' : 'Proposer un problème';
    App.show('puzzle-editor');
    layoutEditor();
    renderEditor();
  };

  function loadIntoEditor(p) {
    var pos, g;
    try { pos = Chess.parseFen(p.fen); g = new Chess.Game(p.fen); } catch (e) { return; }
    ed.board = pos.board.slice(); ed.turn = pos.turn;
    ed.fen = p.fen; ed.game = g; ed.phase = 2;
    for (var i = 0; i < p.solution.length; i++) {
      var m = parseUci(p.solution[i]), rec = g.move(m.from, m.to, m.promo);
      if (!rec) break;
      ed.moves.push(rec.from + rec.to + (rec.promo || ''));
      ed.sanList.push(rec.san);
    }
  }

  function onEditorSquare(idx) {
    if (!ed) return;
    if (ed.phase === 1) { placePiece(idx); return; }
    var g = ed.game, piece = g.board()[idx], turn = g.turn(), i;
    if (ed.sel >= 0) {
      var targets = g.targets(ed.sel);
      for (i = 0; i < targets.length; i++) {
        if (targets[i].to === idx) {
          var from = ed.sel, promo = targets[i].promo;
          ed.sel = -1;
          if (promo) { askEditorPromotion(turn, from, idx); return; }
          playEditorMove(from, idx, null);
          return;
        }
      }
    }
    if (piece && piece.charAt(0) === turn && idx !== ed.sel) ed.sel = idx; else ed.sel = -1;
    renderEditor();
  }

  function placePiece(idx) {
    if (!ed.tool) return;   // aucun outil choisi dans la palette : rien à faire
    ed.board[idx] = ed.tool === 'erase' ? null : ed.tool;
    renderEditor();
  }

  function askEditorPromotion(color, from, to) {
    var node = U.el('div', 'promo');
    var size = Math.max(48, Math.min(72, Math.floor(U.viewport().w / 5)));
    ['Q', 'R', 'B', 'N'].forEach(function (t) {
      var b = U.el('button', 'pbtn');
      b.type = 'button';
      b.style.fontSize = Math.round(size * 0.8) + 'px';
      b.style.width = size + 'px'; b.style.height = size + 'px';
      b.appendChild(U.el('div', 'pc pc-' + color + t));
      U.on(b, 'click', function () { U.closeDialog(); playEditorMove(from, to, t.toLowerCase()); });
      node.appendChild(b);
    });
    U.dialog({ title: 'Promotion', node: node, onclose: function () { renderEditor(); } });
  }

  function playEditorMove(from, to, promo) {
    var rec = ed.game.move(from, to, promo);
    if (!rec) return;
    ed.moves.push(rec.from + rec.to + (rec.promo || ''));
    ed.sanList.push(rec.san);
    U.fx('move');
    renderEditor();
  }

  function editorUndo() {
    if (!ed || !ed.moves.length) return;
    ed.game.undo();
    ed.moves.pop(); ed.sanList.pop();
    renderEditor();
  }

  function toPhase2() {
    if (!ed) return;
    var wKings = 0, bKings = 0, i;
    for (i = 0; i < 64; i++) {
      if (ed.board[i] === 'wK') wKings++;
      else if (ed.board[i] === 'bK') bKings++;
    }
    var err = U.$('pze-err1');
    if (wKings !== 1 || bKings !== 1) { err.textContent = 'Il faut exactement un roi blanc et un roi noir.'; return; }
    var fen = boardToFen(ed.board, ed.turn), g;
    try { g = new Chess.Game(fen); } catch (e) { err.textContent = 'Position invalide : ' + e.message; return; }
    if (!g.legalMoves().length) { err.textContent = 'Cette position n’a aucun coup légal : il en faut au moins un à jouer.'; return; }
    err.textContent = '';
    ed.fen = fen; ed.game = g; ed.sel = -1; ed.moves = []; ed.sanList = []; ed.phase = 2;
    renderEditor();
  }

  function backToPhase1() {
    if (!ed) return;
    function go() { ed.phase = 1; ed.fen = null; ed.game = null; ed.moves = []; ed.sanList = []; renderEditor(); }
    if (ed.moves.length) U.confirm('Retourner à l’échiquier ?', 'Les coups déjà joués seront perdus.', 'Continuer', 'Annuler', go, null, true);
    else go();
  }

  function renderEditorMoves() {
    var box = U.$('pze-sol-list');
    if (!ed.sanList.length) { box.textContent = 'Aucun coup joué pour l’instant.'; return; }
    var fp = ed.fen.split(' '), startTurn = fp[1], startFull = parseInt(fp[5], 10) || 1, parts = [];
    ed.sanList.forEach(function (san, i) {
      var white = (startTurn === 'w') === (i % 2 === 0);
      var num = startFull + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
      if (white) parts.push(num + '.');
      else if (i === 0) parts.push(num + '…');
      parts.push(san);
    });
    box.textContent = parts.join(' ');
  }

  function renderEditor() {
    if (!ed) return;
    U.$('pze-phase1').style.display = ed.phase === 1 ? 'block' : 'none';
    U.$('pze-phase2').style.display = ed.phase === 2 ? 'block' : 'none';
    if (ed.phase === 1) {
      editorBoard.render({ board: ed.board, orient: 'w', last: null, sel: -1, targets: [], check: -1, coords: U.getSetting('coords'), faceTop: null });
      renderPalette();
    } else {
      var g = ed.game, last = g.lastMove(), check = -1;
      if (last && /[+#]$/.test(last.san)) {
        var b = g.board();
        for (var s = 0; s < 64; s++) if (b[s] === g.turn() + 'K') check = s;
      }
      var targets = ed.sel >= 0 ? g.targets(ed.sel) : [];
      editorBoard.render({
        board: g.board(), orient: 'w',
        last: last ? { from: Chess.sqIndex(last.from), to: Chess.sqIndex(last.to) } : null,
        sel: ed.sel, targets: U.getSetting('hints') ? targets : [], check: check,
        coords: U.getSetting('coords'), faceTop: null
      });
      U.$('pze-turn-label').textContent = g.turn() === 'w' ? 'Blancs' : 'Noirs';
      renderEditorMoves();
      U.$('pze-undo').disabled = !ed.moves.length;
      U.$('pze-done2').disabled = !ed.moves.length;
    }
  }

  function layoutEditor() {
    if (!editorBoard) return;
    var vp = U.viewport();
    var land = vp.w > vp.h * 1.25;
    var size = land ? Math.min(vp.h - 70, vp.w * 0.55) : Math.min(vp.w - 12, vp.h - 330);
    editorBoard.setSize(Math.max(160, size));
    U.toggleClass(U.$('scr-puzzle-editor'), 'land', land);
  }
  window.addEventListener('resize', function () { if (U.hasClass(U.$('scr-puzzle-editor'), 'active')) layoutEditor(); }, false);

  function finishEditorToSubmit() {
    if (!ed || !ed.moves.length) return;
    proposeDialog({ fen: ed.fen, solution: ed.moves.slice() }, ed.editing);
  }

  /* ---------- Demander la suppression d'un problème ---------- */
  // Ouvre un ticket GitHub pré-rempli vers le template "delete-puzzle" (voir .github/ISSUE_TEMPLATE/delete-puzzle.yml).
  // N'importe qui peut l'ouvrir, mais il ne sera traité que si Turos14 ajoute ensuite l'étiquette `delete-approved`
  // à la main (voir .github/workflows/puzzle-delete.yml) : affiché à tout le monde, le ticket restant sans effet
  // tant que ce n'est pas fait.
  function requestDeletion(p) {
    var issueTitle = '[Suppression] ' + (p.title || ('Problème #' + p.id));
    function viaGithub() {
      window.open(REPO + '/issues/new?template=delete-puzzle.yml'
        + '&title=' + encodeURIComponent(issueTitle)
        + '&ids=' + encodeURIComponent(p.id), '_blank');
    }
    if (!RELAY_URL) { viaGithub(); return; }
    var node = U.el('div');
    var reasonIn = U.el('input', 'txt'); reasonIn.placeholder = 'Raison (optionnel) : doublon, erreur…'; reasonIn.setAttribute('autocomplete', 'off');
    node.appendChild(reasonIn);
    U.dialog({
      title: 'Demander la suppression',
      text: '« ' + (p.title || ('Problème #' + p.id)) + ' » ne sera supprimé qu’après validation par Turos14.',
      node: node,
      buttons: [{ label: 'Annuler' }, { label: 'Envoyer', primary: true, fn: function () {
        sendToRelay({ kind: 'delete', ids: p.id, title: p.title || '', reason: reasonIn.value }, viaGithub,
          'Demande de suppression envoyée. Elle sera appliquée après validation par Turos14.');
      } }]
    });
  }

  // Envoie la demande au relais ; en cas de relais injoignable, retombe sur le ticket GitHub (fallback).
  function sendToRelay(payload, fallback, okText) {
    U.toast('Envoi…');
    U.ajax('POST', RELAY_URL, payload, function (err, res) {
      // Bouton (geste de l'utilisateur) plutôt qu'ouverture directe : un window.open après une requête est bloqué
      // par la plupart des navigateurs mobiles.
      if (err && (err.network || err.status >= 500)) {   // injoignable, ou clé GitHub refusée (502)
        U.dialog({ title: 'Relais indisponible', text: 'L’envoi direct ne répond pas. Tu peux passer par un ticket GitHub à la place (compte GitHub gratuit nécessaire).',
          buttons: [{ label: 'Annuler' }, { label: 'Ouvrir GitHub', primary: true, fn: function () { fallback(); } }] });
        return;
      }
      if (err) { U.dialog({ title: 'Envoi refusé', text: err.message, buttons: [{ label: 'OK', primary: true }] }); return; }
      U.dialog({ title: 'Merci !', text: okText + (res.number ? ' (suivi : demande n° ' + res.number + ')' : ''), buttons: [{ label: 'OK', primary: true }] });
    }, 20000);
  }

  /* ---------- Proposer un problème ---------- */
  // d : {fen, solutionRaw, title, author, category, difficulty, description}. editing : problème modifié (ticket
  // "edit-puzzle", traité seulement après approbation manuelle — voir .github/workflows/puzzle-edit.yml), sinon
  // nouvelle proposition (ticket "puzzle").
  function openGithubIssue(d, editing) {
    var uci = d.solutionRaw.replace(/^\s+|\s+$/g, '').split(/\s+/).join(' ');
    if (RELAY_URL) {
      var payload = { kind: editing ? 'edit' : 'propose', fen: d.fen, solution: uci, title: d.title, category: d.category,
        difficulty: d.difficulty || '', description: d.description };
      if (editing) payload.id = editing.id; else payload.author = d.author;
      sendToRelay(payload, function () { openGithubTicket(d, editing, uci); }, editing
        ? 'Modification envoyée. Elle sera appliquée après validation par Turos14.'
        : 'Problème envoyé. Il apparaîtra dans la liste après validation par Turos14.');
      return;
    }
    openGithubTicket(d, editing, uci);
  }

  function openGithubTicket(d, editing, uci) {
    var url = REPO + '/issues/new?template=' + (editing ? 'edit-puzzle.yml' : 'puzzle.yml')
      + '&title=' + encodeURIComponent(editing
        ? '[Modification] ' + (editing.title || ('Problème #' + editing.id)) + ' (' + editing.id + ')'
        : '[Problème] ' + (d.title ? d.title : 'sans titre'))
      + (editing ? '&puzzle_id=' + encodeURIComponent(editing.id) : '&author=' + encodeURIComponent(d.author || ''))
      + '&fen=' + encodeURIComponent(d.fen)
      + '&solution=' + encodeURIComponent(uci)
      + '&puzzle_title=' + encodeURIComponent(d.title || '')
      + '&category=' + encodeURIComponent(d.category || '')
      + (d.difficulty ? '&difficulty=' + encodeURIComponent(DIFF_LABEL[d.difficulty]) : '')
      + (d.description ? '&description=' + encodeURIComponent(d.description) : '');
    window.open(url, '_blank');
  }

  // prefill : {fen, solution:[uci...]} si on vient de l'éditeur visuel (champs FEN/solution masqués, déjà
  // valides par construction — revérifiés quand même avant d'ouvrir GitHub) ; sinon saisie texte libre.
  // editing : problème existant (bouton « Modif. ») dont les champs pré-remplissent le formulaire.
  function proposeDialog(prefill, editing) {
    var node = U.el('div');
    var fenIn = null, solIn = null;
    if (prefill) {
      var n = prefill.solution.length;
      node.appendChild(U.el('p', 'hint', 'Position et solution construites avec l’éditeur (' + n + ' coup' + (n > 1 ? 's' : '') + ').'));
    } else {
      fenIn = U.el('input', 'txt'); fenIn.placeholder = 'FEN de départ'; fenIn.value = editing ? editing.fen : Chess.START; fenIn.setAttribute('autocomplete', 'off');
      node.appendChild(fenIn);
      solIn = U.el('input', 'txt'); solIn.placeholder = 'Solution, coups UCI séparés par des espaces (ex: d1h5 g7g6 h5f7)'; solIn.setAttribute('autocomplete', 'off');
      if (editing) solIn.value = editing.solution.join(' ');
      node.appendChild(solIn);
    }
    var row = U.el('div', 'fieldrow');
    var titleIn = U.el('input', 'txt'); titleIn.placeholder = 'Titre (optionnel)'; titleIn.setAttribute('autocomplete', 'off');
    var authorIn = U.el('input', 'txt'); authorIn.placeholder = 'Ton pseudo (optionnel)'; authorIn.setAttribute('autocomplete', 'off');
    authorIn.value = U.store.get('puzzleAuthor', '');
    row.appendChild(titleIn);
    if (!editing) row.appendChild(authorIn);   // une modification garde l'auteur d'origine
    node.appendChild(row);
    var categoryIn = U.el('input', 'txt');
    categoryIn.placeholder = 'Catégories (optionnel, séparées par des virgules : Mats, Tactique)';
    categoryIn.setAttribute('autocomplete', 'off');
    categoryIn.value = U.store.get('puzzleCategory', '');
    node.appendChild(categoryIn);
    var descIn = U.el('textarea', 'txt pz-desc-in');
    descIn.placeholder = 'Description (optionnel) : contexte, thème, consigne…';
    descIn.setAttribute('maxlength', String(DESCRIPTION_MAX));
    descIn.rows = 3;
    node.appendChild(descIn);
    if (editing) {
      titleIn.value = editing.title || '';
      categoryIn.value = categoriesOf(editing).join(', ');
      descIn.value = editing.description || '';
    }
    node.appendChild(U.el('p', 'hint', 'Niveau de difficulté (optionnel) :'));
    var diffBox = U.el('div');
    node.appendChild(diffBox);
    var diffOptions = [{ v: '', label: 'Non précisé' }];
    DIFFICULTIES.forEach(function (d) { diffOptions.push({ v: d, label: DIFF_LABEL[d] }); });
    var diffSeg = U.segmented(diffBox, diffOptions, editing && editing.difficulty ? editing.difficulty : '', null);
    if (!prefill) node.appendChild(U.el('p', 'hint', 'Le coup à trouver, puis en alternance les réponses forcées de l’adversaire. Format UCI : « e2e4 », ou « e7e8q » pour une promotion.'));
    var err = U.el('div', 'error');
    node.appendChild(err);
    var buttons = [{ label: 'Annuler' }];
    if (!prefill) buttons.push({ label: 'Éditeur visuel', fn: function (h) { h.close(true); P.openEditor(editing); } });
    buttons.push({ label: RELAY_URL ? 'Envoyer' : 'Continuer sur GitHub', primary: true, keep: true, fn: function (h) {
      var fen = prefill ? prefill.fen : fenIn.value;
      var solRaw = prefill ? prefill.solution.join(' ') : solIn.value;
      var msg = validatePuzzle(fen, solRaw);
      var description = descIn.value.replace(/^\s+|\s+$/g, '');
      if (!msg && description.length > DESCRIPTION_MAX) msg = 'Description trop longue (' + DESCRIPTION_MAX + ' caractères maximum).';
      if (msg) { err.textContent = msg; return; }
      err.textContent = '';
      if (!editing) {
        U.store.set('puzzleAuthor', authorIn.value);
        U.store.set('puzzleCategory', categoryIn.value);
      }
      h.close(true);
      openGithubIssue({ fen: fen, solutionRaw: solRaw, title: titleIn.value, author: authorIn.value, category: categoryIn.value, difficulty: diffSeg.get(), description: description }, editing);
    } });
    U.dialog({
      title: editing ? 'Modifier le problème' : 'Proposer un problème',
      text: RELAY_URL
        ? (editing ? 'Envoyé directement, sans compte. La modification n’est appliquée qu’après validation par Turos14.'
          : 'Envoyé directement, sans compte. Le problème est vérifié puis publié après validation par Turos14.')
        : editing
          ? 'Ouvre un ticket GitHub pré-rempli (nécessite un compte GitHub gratuit). La modification n’est appliquée qu’après validation manuelle par Turos14.'
          : 'Ouvre un ticket GitHub pré-rempli (nécessite un compte GitHub gratuit). Une vérification automatique l’ajoute à la liste publique si tout est valide — visible de tout le monde en moins d’une minute.',
      node: node,
      buttons: buttons
    });
  }

  P.initScreen = function () {
    U.on(U.$('pz-propose'), 'click', function () { P.openEditor(); });
    U.on(U.$('pzs-back'), 'click', function () { stopTimers(); App.show('puzzles'); });
    U.on(U.$('pzs-hint'), 'click', hint);
    U.on(U.$('pzs-sol'), 'click', revealSolution);
    U.on(U.$('pzs-retry'), 'click', retry);
    U.on(U.$('pzs-next'), 'click', next);

    U.on(U.$('pze-back'), 'click', function () { App.show('puzzles'); });
    U.on(U.$('pze-reset-start'), 'click', function () { if (!ed) return; ed.board = startBoard(); ed.turn = 'w'; if (turnSeg) turnSeg.set('w'); U.$('pze-err1').textContent = ''; renderEditor(); });
    U.on(U.$('pze-clear'), 'click', function () { if (!ed) return; ed.board = emptyBoard(); U.$('pze-err1').textContent = ''; renderEditor(); });
    U.on(U.$('pze-next'), 'click', toPhase2);
    U.on(U.$('pze-text-mode'), 'click', function () { proposeDialog(null, ed && ed.editing); });
    U.on(U.$('pze-back1'), 'click', backToPhase1);
    U.on(U.$('pze-undo'), 'click', editorUndo);
    U.on(U.$('pze-done2'), 'click', finishEditorToSubmit);
    turnSeg = U.segmented(U.$('pze-turn'), [{ v: 'w', label: 'Trait aux Blancs' }, { v: 'b', label: 'Trait aux Noirs' }], 'w', function (v) { if (ed) ed.turn = v; });
  };

  window.Puzzles = P;
})();
