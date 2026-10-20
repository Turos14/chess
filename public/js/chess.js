/* Moteur d'échecs (règles complètes) - ES5, utilisable dans le navigateur et sous Node.
 * Cases : index 0..63, 0 = a8, 63 = h1 (index = ligne*8 + colonne, ligne 0 = rang 8).
 * Pièces : chaîne de 2 caractères, couleur ('w'|'b') + type ('P','N','B','R','Q','K').
 * Échecs aléatoires Fischer (Chess960) : reconnus à la notation des droits de roque dans la FEN, par colonne de la
 * tour (« Shredder-FEN », ex : HAha) au lieu de KQkq — une FEN classique garde donc exactement les règles
 * classiques. En 960, un roque se joue « roi sur sa tour » (convention UCI, comme Stockfish) : from = case du roi,
 * to = case de la tour ; Game.move accepte aussi la case d'arrivée du roi quand ce n'est pas un coup de roi normal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess = factory();
})(this, function () {
  'use strict';

  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';
  var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function sqName(s) { return FILES.charAt(s & 7) + (8 - (s >> 3)); }
  function sqIndex(n) { return (8 - parseInt(n.charAt(1), 10)) * 8 + FILES.indexOf(n.charAt(0)); }
  function other(c) { return c === 'w' ? 'b' : 'w'; }

  /* ---------- FEN ---------- */

  function parseFen(fen) {
    var parts = String(fen).replace(/^\s+|\s+$/g, '').split(/\s+/);
    if (parts.length < 4) throw new Error('FEN invalide');
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN invalide');
    var board = [], kings = { w: 0, b: 0 }, r, i, ch;
    for (r = 0; r < 8; r++) {
      var n = 0;
      for (i = 0; i < rows[r].length; i++) {
        ch = rows[r].charAt(i);
        if (/[1-8]/.test(ch)) {
          var k = parseInt(ch, 10);
          n += k;
          while (k--) board.push(null);
        } else {
          var t = ch.toUpperCase();
          if ('PNBRQK'.indexOf(t) < 0) throw new Error('FEN invalide');
          var c = ch === t ? 'w' : 'b';
          if (t === 'K') kings[c]++;
          board.push(c + t);
          n++;
        }
      }
      if (n !== 8) throw new Error('FEN invalide');
    }
    if (kings.w !== 1 || kings.b !== 1) throw new Error('FEN invalide');
    var cr = parseCastling(board, parts[2]);
    return {
      board: board,
      turn: parts[1] === 'b' ? 'b' : 'w',
      castling: cr.castling, rooks: cr.rooks, c960: cr.c960,
      ep: parts[3] === '-' ? -1 : sqIndex(parts[3]),
      half: parseInt(parts[4], 10) || 0,
      full: parseInt(parts[5], 10) || 1
    };
  }

  // Droits de roque : KQkq (classique : roi en e1/e8, tours dans les coins) ou lettres de colonne de la tour
  // (Chess960, A-H pour les Blancs, a-h pour les Noirs). Un droit incohérent avec la position est ignoré.
  function parseCastling(board, cs) {
    var castling = { wK: false, wQ: false, bK: false, bQ: false }, rooks = { wK: -1, wQ: -1, bK: -1, bQ: -1 };
    var c960 = /[A-Ha-h]/.test(cs), i;
    for (i = 0; i < cs.length; i++) {
      var ch = cs.charAt(i), color = ch === ch.toUpperCase() ? 'w' : 'b', row = color === 'w' ? 56 : 0;
      var k = findKing(board, color), side, rook;
      if (k < row || k > row + 7) continue;
      if (ch === 'K' || ch === 'k') { side = 'K'; rook = row + 7; if (k !== row + 4) continue; }
      else if (ch === 'Q' || ch === 'q') { side = 'Q'; rook = row; if (k !== row + 4) continue; }
      else if (/[A-Ha-h]/.test(ch)) { rook = row + FILES.indexOf(ch.toLowerCase()); side = rook > k ? 'K' : 'Q'; if (rook === k) continue; }
      else continue;
      if (board[rook] !== color + 'R') continue;
      castling[color + side] = true; rooks[color + side] = rook;
    }
    return { castling: castling, rooks: rooks, c960: c960 };
  }

  // Case en passant à publier dans le FEN : seulement si une prise est possible.
  function epForFen(pos) {
    if (pos.ep < 0) return '-';
    var r = pos.ep >> 3, f = pos.ep & 7;
    var pr = pos.turn === 'w' ? r + 1 : r - 1;
    var p = pos.turn + 'P';
    if ((f > 0 && pos.board[pr * 8 + f - 1] === p) || (f < 7 && pos.board[pr * 8 + f + 1] === p)) return sqName(pos.ep);
    return '-';
  }

  function fenOf(pos, noCounters) {
    var rows = [], r, f;
    for (r = 0; r < 8; r++) {
      var s = '', e = 0;
      for (f = 0; f < 8; f++) {
        var p = pos.board[r * 8 + f];
        if (!p) { e++; continue; }
        if (e) { s += e; e = 0; }
        s += p.charAt(0) === 'w' ? p.charAt(1) : p.charAt(1).toLowerCase();
      }
      if (e) s += e;
      rows.push(s);
    }
    var c = pos.castling, cs = '';
    if (pos.c960) {
      ['wK', 'wQ', 'bK', 'bQ'].forEach(function (k) {
        if (!c[k]) return;
        var l = FILES.charAt(pos.rooks[k] & 7);
        cs += k.charAt(0) === 'w' ? l.toUpperCase() : l;
      });
    } else cs = (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '');
    var out = rows.join('/') + ' ' + pos.turn + ' ' + (cs || '-') + ' ' + epForFen(pos);
    return noCounters ? out : out + ' ' + pos.half + ' ' + pos.full;
  }

  function clonePos(pos) {
    return {
      board: pos.board.slice(),
      turn: pos.turn,
      castling: { wK: pos.castling.wK, wQ: pos.castling.wQ, bK: pos.castling.bK, bQ: pos.castling.bQ },
      rooks: { wK: pos.rooks.wK, wQ: pos.rooks.wQ, bK: pos.rooks.bK, bQ: pos.rooks.bQ }, c960: pos.c960,
      ep: pos.ep, half: pos.half, full: pos.full
    };
  }

  /* ---------- Attaques et génération ---------- */

  function attacked(board, sq, by) {
    var r = sq >> 3, f = sq & 7, i, rr, ff, d, p, t;
    var pr = by === 'w' ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      if (f > 0 && board[pr * 8 + f - 1] === by + 'P') return true;
      if (f < 7 && board[pr * 8 + f + 1] === by + 'P') return true;
    }
    for (i = 0; i < 8; i++) {
      d = KN[i]; rr = r + d[0]; ff = f + d[1];
      if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && board[rr * 8 + ff] === by + 'N') return true;
      d = KG[i]; rr = r + d[0]; ff = f + d[1];
      if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && board[rr * 8 + ff] === by + 'K') return true;
    }
    for (i = 0; i < 8; i++) {
      var diag = i < 4;
      d = diag ? DIAG[i] : ORTH[i - 4];
      rr = r + d[0]; ff = f + d[1];
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        p = board[rr * 8 + ff];
        if (p) {
          if (p.charAt(0) === by) {
            t = p.charAt(1);
            if (t === 'Q' || t === (diag ? 'B' : 'R')) return true;
          }
          break;
        }
        rr += d[0]; ff += d[1];
      }
    }
    return false;
  }

  function findKing(board, color) {
    for (var s = 0; s < 64; s++) if (board[s] === color + 'K') return s;
    return -1;
  }

  function pseudo(pos) {
    var out = [], b = pos.board, us = pos.turn, them = other(us), s, i, d, r, f, rr, ff, to, c;
    function push(from, to, piece, extra) {
      var m = { from: from, to: to, piece: piece, cap: b[to] || null, promo: null, ep: false, castle: null, dbl: false };
      if (extra) for (var k in extra) m[k] = extra[k];
      out.push(m);
    }
    for (s = 0; s < 64; s++) {
      var p = b[s];
      if (!p || p.charAt(0) !== us) continue;
      var t = p.charAt(1);
      r = s >> 3; f = s & 7;
      if (t === 'P') {
        var dir = us === 'w' ? -1 : 1, startR = us === 'w' ? 6 : 1, lastR = us === 'w' ? 0 : 7;
        var r1 = r + dir;
        if (r1 < 0 || r1 > 7) continue;
        to = r1 * 8 + f;
        if (!b[to]) {
          if (r1 === lastR) { for (i = 0; i < 4; i++) push(s, to, p, { promo: 'QRBN'.charAt(i) }); }
          else {
            push(s, to, p);
            if (r === startR && !b[(r + 2 * dir) * 8 + f]) push(s, (r + 2 * dir) * 8 + f, p, { dbl: true });
          }
        }
        for (d = -1; d <= 1; d += 2) {
          ff = f + d;
          if (ff < 0 || ff > 7) continue;
          to = r1 * 8 + ff;
          c = b[to];
          if (c && c.charAt(0) === them) {
            if (r1 === lastR) { for (i = 0; i < 4; i++) push(s, to, p, { promo: 'QRBN'.charAt(i) }); }
            else push(s, to, p);
          } else if (!c && to === pos.ep) {
            push(s, to, p, { cap: them + 'P', ep: true });
          }
        }
      } else if (t === 'N' || t === 'K') {
        var deltas = t === 'N' ? KN : KG;
        for (i = 0; i < 8; i++) {
          rr = r + deltas[i][0]; ff = f + deltas[i][1];
          if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
          to = rr * 8 + ff;
          c = b[to];
          if (!c || c.charAt(0) === them) push(s, to, p);
        }
        if (t === 'K') castles(pos, s, push);
      } else {
        var dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH);
        for (i = 0; i < dirs.length; i++) {
          rr = r + dirs[i][0]; ff = f + dirs[i][1];
          while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            to = rr * 8 + ff;
            c = b[to];
            if (!c) push(s, to, p);
            else { if (c.charAt(0) === them) push(s, to, p); break; }
            rr += dirs[i][0]; ff += dirs[i][1];
          }
        }
      }
    }
    return out;
  }

  // Roques possibles du roi en s (règles communes au classique et au 960) : le roi arrive en g/c, la tour en f/d ;
  // toutes les cases entre roi, tour et leurs arrivées doivent être vides (hors roi et tour eux-mêmes), le roi ne
  // doit pas être en échec ni traverser/arriver sur une case attaquée.
  function castles(pos, s, push) {
    var b = pos.board, us = pos.turn, them = other(us), row = us === 'w' ? 56 : 0, sides = ['K', 'Q'], j, q;
    if (s < row || s > row + 7) return;
    for (j = 0; j < 2; j++) {
      var side = sides[j], key = us + side, r = pos.rooks[key];
      if (!pos.castling[key] || b[r] !== us + 'R') continue;
      var kTo = row + (side === 'K' ? 6 : 2), rTo = row + (side === 'K' ? 5 : 3);
      var lo = Math.min(s, r, kTo, rTo), hi = Math.max(s, r, kTo, rTo), ok = true;
      for (q = lo; q <= hi && ok; q++) if (q !== s && q !== r && b[q]) ok = false;
      var step = kTo > s ? 1 : -1;
      for (q = s; ok; q += step) {
        if (attacked(b, q, them)) ok = false;
        if (q === kTo) break;
      }
      if (ok) push(s, pos.c960 ? r : kTo, b[s], { castle: side, cap: null, rook: r, kto: kTo });
    }
  }

  function applyMove(pos, m) {
    var b = pos.board, us = pos.turn, t = m.piece.charAt(1), c = pos.castling, i;
    if (m.castle) {
      var row = us === 'w' ? 56 : 0;
      b[m.from] = null; b[m.rook] = null;
      b[row + (m.castle === 'K' ? 6 : 2)] = us + 'K';
      b[row + (m.castle === 'K' ? 5 : 3)] = us + 'R';
    } else {
      b[m.from] = null;
      b[m.to] = m.promo ? us + m.promo : m.piece;
      if (m.ep) b[m.to + (us === 'w' ? 8 : -8)] = null;
    }
    if (t === 'K') { c[us + 'K'] = false; c[us + 'Q'] = false; }
    var sqs = [m.from, m.to], keys = ['wK', 'wQ', 'bK', 'bQ'], k;
    for (i = 0; i < 2; i++) {
      for (k = 0; k < 4; k++) if (c[keys[k]] && pos.rooks[keys[k]] === sqs[i]) c[keys[k]] = false;
    }
    pos.ep = m.dbl ? (m.from + m.to) >> 1 : -1;
    pos.half = (t === 'P' || m.cap) ? 0 : pos.half + 1;
    if (us === 'b') pos.full++;
    pos.turn = other(us);
  }

  function legal(pos) {
    var list = pseudo(pos), out = [], us = pos.turn, them = other(us), i;
    for (i = 0; i < list.length; i++) {
      var np = clonePos(pos);
      applyMove(np, list[i]);
      if (!attacked(np.board, findKing(np.board, us), them)) out.push(list[i]);
    }
    return out;
  }

  function insufficient(board) {
    var minors = [], s, p, t;
    for (s = 0; s < 64; s++) {
      p = board[s];
      if (!p) continue;
      t = p.charAt(1);
      if (t === 'K') continue;
      if (t === 'P' || t === 'R' || t === 'Q') return false;
      minors.push({ t: t, s: s });
    }
    if (minors.length < 2) return true;
    var col = -1;
    for (s = 0; s < minors.length; s++) {
      if (minors[s].t !== 'B') return false;
      var c = ((minors[s].s >> 3) + (minors[s].s & 7)) & 1;
      if (col < 0) col = c; else if (col !== c) return false;
    }
    return true;
  }

  function sanOf(pos, m, list) {
    var san, t = m.piece.charAt(1), i;
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
    if (t === 'P') {
      san = m.cap ? FILES.charAt(m.from & 7) + 'x' + sqName(m.to) : sqName(m.to);
      if (m.promo) san += '=' + m.promo;
      return san;
    }
    san = t;
    var sameFile = false, sameRank = false, any = false;
    for (i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.piece === m.piece && o.to === m.to && o.from !== m.from) {
        any = true;
        if ((o.from & 7) === (m.from & 7)) sameFile = true;
        if ((o.from >> 3) === (m.from >> 3)) sameRank = true;
      }
    }
    if (any) {
      if (!sameFile) san += FILES.charAt(m.from & 7);
      else if (!sameRank) san += (8 - (m.from >> 3));
      else san += sqName(m.from);
    }
    if (m.cap) san += 'x';
    return san + sqName(m.to);
  }

  /* ---------- Partie ---------- */

  function Game(fen) {
    this.pos = parseFen(fen || START);
    this.chess960 = this.pos.c960;
    this.startFen = fenOf(this.pos);
    this.history = [];
    this.fens = [this.startFen];
    this.keys = [fenOf(this.pos, true)];
    this._snaps = [];
    this._legal = null;
    this._status = null;
  }

  Game.prototype.board = function () { return this.pos.board; };
  Game.prototype.turn = function () { return this.pos.turn; };
  Game.prototype.fen = function () { return fenOf(this.pos); };
  Game.prototype.lastMove = function () { return this.history.length ? this.history[this.history.length - 1] : null; };

  Game.prototype.legalMoves = function () {
    if (!this._legal) this._legal = legal(this.pos);
    return this._legal;
  };

  // Destinations légales depuis une case : [{to: index, promo: bool}]
  Game.prototype.targets = function (from) {
    var list = this.legalMoves(), out = [], seen = {}, i;
    for (i = 0; i < list.length; i++) {
      if (list[i].from === from && !seen[list[i].to]) {
        seen[list[i].to] = 1;
        out.push({ to: list[i].to, promo: !!list[i].promo, cap: !!list[i].cap });
      }
    }
    // En 960, la case d'arrivée du roi est aussi une cible du roque (en plus de la case de la tour).
    for (i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.from === from && m.castle && m.kto !== from && !seen[m.kto]) { seen[m.kto] = 1; out.push({ to: m.kto, promo: false, cap: false }); }
    }
    return out;
  };

  Game.prototype.inCheck = function () {
    return attacked(this.pos.board, findKing(this.pos.board, this.pos.turn), other(this.pos.turn));
  };

  Game.prototype.kingSquare = function (color) { return findKing(this.pos.board, color); };

  Game.prototype.status = function () {
    if (this._status) return this._status;
    var st = { over: false, result: '*', reason: null, winner: null };
    var pos = this.pos, i, n = 0;
    if (!this.legalMoves().length) {
      st.over = true;
      if (this.inCheck()) {
        st.reason = 'checkmate'; st.winner = other(pos.turn);
        st.result = st.winner === 'w' ? '1-0' : '0-1';
      } else { st.reason = 'stalemate'; st.result = '1/2-1/2'; }
    } else if (insufficient(pos.board)) {
      st.over = true; st.reason = 'insufficient'; st.result = '1/2-1/2';
    } else {
      var key = this.keys[this.keys.length - 1];
      for (i = 0; i < this.keys.length; i++) if (this.keys[i] === key) n++;
      if (n >= 3) { st.over = true; st.reason = 'repetition'; st.result = '1/2-1/2'; }
      else if (pos.half >= 100) { st.over = true; st.reason = 'fifty'; st.result = '1/2-1/2'; }
    }
    this._status = st;
    return st;
  };

  // from/to : nom ('e2') ou index ; promo : 'q','r','b','n' (dame par défaut)
  Game.prototype.move = function (from, to, promo) {
    if (this.status().over) return null;
    var fi = typeof from === 'number' ? from : sqIndex(from);
    var ti = typeof to === 'number' ? to : sqIndex(to);
    var pr = promo ? String(promo).toUpperCase() : 'Q';
    var list = this.legalMoves(), m = null, i;
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.from === fi && c.to === ti && (!c.promo || c.promo === pr)) { m = c; break; }
    }
    // Roque désigné par la case d'arrivée du roi (960 : « roi sur g1 ») ou par la case de la tour (classique :
    // « e1h1 », notation 960 d'un moteur) — seulement si ce n'est pas déjà un coup normal.
    for (i = 0; !m && i < list.length; i++) {
      if (list[i].castle && list[i].from === fi && (list[i].kto === ti || list[i].rook === ti)) m = list[i];
    }
    if (!m) return null;
    var san = sanOf(this.pos, m, list);
    this._snaps.push(clonePos(this.pos));
    applyMove(this.pos, m);
    this._legal = null; this._status = null;
    var check = this.inCheck();
    if (check) san += this.legalMoves().length ? '+' : '#';
    var rec = {
      from: sqName(m.from), to: sqName(m.to), promo: m.promo ? m.promo.toLowerCase() : null,
      san: san, piece: m.piece, cap: m.cap, castle: m.castle, ep: m.ep
    };
    this.history.push(rec);
    this.fens.push(fenOf(this.pos));
    this.keys.push(fenOf(this.pos, true));
    return rec;
  };

  Game.prototype.undo = function () {
    if (!this.history.length) return null;
    this.pos = this._snaps.pop();
    this.fens.pop(); this.keys.pop();
    this._legal = null; this._status = null;
    return this.history.pop();
  };

  Game.prototype.pgn = function (meta) {
    meta = meta || {};
    var st = this.status();
    var result = meta.Result || (st.over ? st.result : '*');
    var d = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    var tags = [
      ['Event', meta.Event || 'Partie amicale'],
      ['Site', meta.Site || '?'],
      ['Date', meta.Date || (d.getFullYear() + '.' + p2(d.getMonth() + 1) + '.' + p2(d.getDate()))],
      ['Round', '-'],
      ['White', meta.White || 'Blancs'],
      ['Black', meta.Black || 'Noirs'],
      ['Result', result]
    ];
    if (this.chess960) tags.push(['Variant', 'Chess960']);
    if (this.startFen !== START) { tags.push(['SetUp', '1']); tags.push(['FEN', this.startFen]); }
    var head = '', i;
    for (i = 0; i < tags.length; i++) head += '[' + tags[i][0] + ' "' + String(tags[i][1]).replace(/"/g, "'") + '"]\n';
    var fp = this.startFen.split(' ');
    var startTurn = fp[1], startFull = parseInt(fp[5], 10) || 1;
    var words = [];
    for (i = 0; i < this.history.length; i++) {
      var white = (startTurn === 'w') === (i % 2 === 0);
      var num = startFull + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
      if (white) words.push(num + '.');
      else if (i === 0) words.push(num + '...');
      words.push(this.history[i].san);
    }
    words.push(result);
    var lines = [], line = '';
    for (i = 0; i < words.length; i++) {
      if (line && line.length + 1 + words[i].length > 80) { lines.push(line); line = words[i]; }
      else line = line ? line + ' ' + words[i] : words[i];
    }
    lines.push(line);
    return head + '\n' + lines.join('\n') + '\n';
  };

  // Rejoue une liste de coups [{from,to,promo}] depuis une position. Retourne null si un coup est illégal.
  function replay(startFen, moves) {
    var g = new Game(startFen || START), i;
    for (i = 0; i < moves.length; i++) {
      if (!g.move(moves[i].from, moves[i].to, moves[i].promo)) return null;
    }
    return g;
  }

  function perft(fen, depth) {
    function go(pos, d) {
      var list = legal(pos);
      if (d === 1) return list.length;
      var n = 0, i;
      for (i = 0; i < list.length; i++) {
        var np = clonePos(pos);
        applyMove(np, list[i]);
        n += go(np, d - 1);
      }
      return n;
    }
    return go(parseFen(fen), depth);
  }

  // Valeur matérielle classique (pion=1 … dame=9, roi non compté) : {w, b, diff (blancs - noirs)}
  var PIECE_VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  function material(board) {
    var w = 0, b = 0, s, p;
    for (s = 0; s < 64; s++) {
      p = board[s];
      if (!p) continue;
      if (p.charAt(0) === 'w') w += PIECE_VALUE[p.charAt(1)];
      else b += PIECE_VALUE[p.charAt(1)];
    }
    return { w: w, b: b, diff: w - b };
  }

  // Rangée arrière Fischer n° n (0..959, numérotation de Scharnagl : 518 = RNBQKBNR), n absent = tirage au
  // hasard : fous de couleurs opposées, roi entre les deux tours. Retourne { back: 'RNBQKBNR', rooks: [g, d] }
  // (colonnes de la tour de gauche et de droite).
  var KNIGHTS = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
  function backRank960(n) {
    if (n == null) n = Math.floor(Math.random() * 960);
    n = Math.max(0, Math.min(959, Math.floor(n)));
    var row = [null, null, null, null, null, null, null, null], x = n;
    function empties() { var e = []; for (var f = 0; f < 8; f++) if (!row[f]) e.push(f); return e; }
    row[2 * (x % 4) + 1] = 'B'; x = Math.floor(x / 4);
    row[2 * (x % 4)] = 'B'; x = Math.floor(x / 4);
    row[empties()[x % 6]] = 'Q'; x = Math.floor(x / 6);
    var e = empties();
    row[e[KNIGHTS[x][0]]] = 'N'; row[e[KNIGHTS[x][1]]] = 'N';
    e = empties();
    row[e[0]] = 'R'; row[e[1]] = 'K'; row[e[2]] = 'R';
    return { back: row.join(''), rooks: [e[0], e[2]] };
  }

  // Position de départ Fischer : nW = n° de la rangée des Blancs, nB = celle des Noirs, chacune tirée au hasard et
  // indépendamment si absente (les deux camps n'ont en général pas le même placement) ; start960(518, 518) = position
  // classique. Les droits de roque sont notés par colonne de tour, propres à chaque camp (ex : HFca).
  function start960(nW, nB) {
    var w = backRank960(nW), b = backRank960(nB);
    var cs = FILES.charAt(w.rooks[1]).toUpperCase() + FILES.charAt(w.rooks[0]).toUpperCase() +
      FILES.charAt(b.rooks[1]) + FILES.charAt(b.rooks[0]);
    return b.back.toLowerCase() + '/pppppppp/8/8/8/8/PPPPPPPP/' + w.back + ' w ' + cs + ' - 0 1';
  }

  // Une FEN est-elle en notation Chess960 (droits de roque par colonne) ? Sert à régler le moteur.
  function is960(fen) { var p = String(fen).split(/\s+/); return p.length > 2 && /[A-Ha-h]/.test(p[2]); }

  return {
    START: START, Game: Game, replay: replay, perft: perft, start960: start960, is960: is960,
    LABEL_960: 'Échecs aléatoires Fischer (960) : pièces de la 1re rangée placées au hasard, différemment pour chaque camp',
    sqName: sqName, sqIndex: sqIndex, other: other, parseFen: parseFen, material: material
  };
});
