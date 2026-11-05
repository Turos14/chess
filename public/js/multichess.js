/* Échecs à plusieurs — moteur de règles pur (aucun DOM), testable sous Node. Deux variantes :
 *  - 'yalta'  : 3 joueurs (Blancs, Noirs, Rouges) sur l'échiquier hexagonal de 96 cases. Chaque camp a 4 rangées de
 *    8 colonnes ; sa moitié gauche (colonnes a-d) touche, par sa 4e rangée, la moitié droite du camp précédent et sa
 *    moitié droite celle du camp suivant. Les 6 cases du centre se touchent par un seul coin : une diagonale qui
 *    traverse le centre a deux suites possibles (règle « Yalta »).
 *  - 'cross4' : 4 joueurs (Rouges, Bleus, Jaunes, Verts) sur l'échiquier en croix 14×14 (coins 3×3 retirés), option
 *    équipes 2 contre 2 (camps opposés alliés).
 * Une case est un entier ; les déplacements passent par variant.step(case, direction) qui renvoie les cases voisines
 * dans cette direction avec la direction à suivre ensuite (repère local du camp pour Yalta : [rangée, colonne]).
 * Règles volontairement simplifiées (v1) : pas de roque ni de prise en passant ; promotion en arrivant sur la dernière
 * rangée d'un autre camp (Yalta) ou sur la 8e rangée (croix) ; un joueur sans coup légal à son tour est éliminé (mat ou
 * pat) et ses pièces quittent l'échiquier ; un roi laissé en prise peut être capturé (son camp est éliminé) ; le
 * dernier survivant gagne (équipes : la première équipe qui perd un joueur perd) ; nulle s'il ne reste que des rois.
 * Pièce : {c: n° du camp, t: 'K'|'Q'|'R'|'B'|'N'|'P'}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MultiChess = factory();
})(this, function () {
  'use strict';

  var ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ALL = ORTHO.concat(DIAG);
  var BACK = 'RNBQKBNR';
  var FILES = 'abcdefghijklmn';

  /* ---------- Variante 3 joueurs (Yalta) ---------- */
  var yalta = (function () {
    var N = 3;
    function id(p, r, f) { return p * 32 + r * 8 + f; }
    function seg(c) { return Math.floor(c / 32); }
    function rk(c) { return (c % 32) >> 3; }
    function fl(c) { return c & 7; }

    // Centre : les 6 cases (3,3)/(3,4) de chaque camp, dans l'ordre où elles tournent autour du point central.
    function ringIndex(c) { return 2 * seg(c) + (fl(c) === 4 ? 1 : 0); }
    function ringCell(j) { j = (j + 6) % 6; return id(j >> 1, 3, (j & 1) ? 4 : 3); }

    function step(c, d) {
      var p = seg(c), r = rk(c), f = fl(c), r2 = r + d[0], f2 = f + d[1];
      if (f2 < 0 || f2 > 7 || r2 < 0) return [];
      if (r2 <= 3) return [{ cell: id(p, r2, f2), dir: d }];
      var nb = f < 4 ? (p + N - 1) % N : (p + 1) % N;     // moitié gauche -> camp précédent, droite -> suivant
      if (d[1] === 0) return [{ cell: id(nb, 3, 7 - f), dir: [-1, 0] }];
      if ((f < 4) === (f2 < 4)) return [{ cell: id(nb, 3, 7 - f2), dir: [-1, -d[1]] }];
      // Diagonale par le point central : vers les deux cases centrales qui ne touchent celle-ci que par ce point
      var k = ringIndex(c), out = [], j;
      for (j = -2; j <= 2; j += 4) {
        var t = ringCell(k + j);
        out.push({ cell: t, dir: fl(t) === 3 ? [-1, -1] : [-1, 1] });
      }
      return out;
    }

    function initial() {
      var b = [], p, f;
      for (p = 0; p < 96; p++) b.push(null);
      for (p = 0; p < N; p++) {
        for (f = 0; f < 8; f++) {
          b[id(p, 0, f)] = { c: p, t: BACK.charAt(f) };
          b[id(p, 1, f)] = { c: p, t: 'P' };
        }
      }
      return b;
    }

    // Nom de case : colonnes a-h et rangées 1-4 (Blancs), 8-5 (Noirs), 12-9 (Rouges), comme si chaque camp prolongeait
    // l'échiquier classique : la case e4 des Blancs touche la e5 des Noirs.
    function label(c) {
      var p = seg(c), r = rk(c), f = fl(c);
      return FILES.charAt(p === 0 ? f : 7 - f) + (p === 0 ? r + 1 : 4 * p + 4 - r);
    }

    // Géométrie : hexagone de rayon 1 (centre 0,0, y vers le bas), côtés s0..s5 ; le camp p a sa 1re rangée sur s(2p).
    var V = [], M = [], k;
    for (k = 0; k < 6; k++) {
      var a = (120 - 60 * k) * Math.PI / 180;       // V0 en bas à gauche, puis sens inverse des aiguilles (écran)
      V.push([Math.cos(a), Math.sin(a)]);
    }
    for (k = 0; k < 6; k++) M.push([(V[k][0] + V[(k + 1) % 6][0]) / 2, (V[k][1] + V[(k + 1) % 6][1]) / 2]);
    function bilin(q, u, v) {      // q : coins [(0,0), (1,0), (0,1), (1,1)]
      return [
        (1 - u) * (1 - v) * q[0][0] + u * (1 - v) * q[1][0] + (1 - u) * v * q[2][0] + u * v * q[3][0],
        (1 - u) * (1 - v) * q[0][1] + u * (1 - v) * q[1][1] + (1 - u) * v * q[2][1] + u * v * q[3][1]
      ];
    }
    function polygon(c) {
      var p = seg(c), r = rk(c), f = fl(c), C = [0, 0], q, fu;
      if (f < 4) { q = [V[2 * p], M[2 * p], M[(2 * p + 5) % 6], C]; fu = f; }
      else { q = [M[2 * p], V[(2 * p + 1) % 6], C, M[(2 * p + 1) % 6]]; fu = f - 4; }
      return [bilin(q, fu / 4, r / 4), bilin(q, (fu + 1) / 4, r / 4), bilin(q, (fu + 1) / 4, (r + 1) / 4), bilin(q, fu / 4, (r + 1) / 4)];
    }

    var cells = [];
    for (k = 0; k < 96; k++) cells.push(k);
    return {
      id: 'yalta', name: 'Échecs à 3 (Yalta)', size: 96, cells: cells, teamsAllowed: false,
      players: [{ name: 'Blancs', code: 'w' }, { name: 'Noirs', code: 'b' }, { name: 'Rouges', code: 'r' }],
      step: step, initial: initial, label: label, polygon: polygon,
      pawnDir: function (c, color) { return seg(c) === color ? [1, 0] : [-1, 0]; },
      pawnStart: function (c, color) { return seg(c) === color && rk(c) === 1; },
      promotes: function (c, color) { return seg(c) !== color && rk(c) === 0; },
      // Teinte de la case (claire/foncée), comme sur un échiquier classique dans le repère du camp
      dark: function (c) { return ((rk(c) + fl(c)) & 1) === 0; },
      // Angle (degrés, sens des aiguilles à l'écran) dont tourner l'échiquier pour que le camp p soit en bas
      viewAngle: function (p) { return [0, 120, 240][p]; }
    };
  })();

  /* ---------- Variante 4 joueurs (croix 14×14) ---------- */
  var cross4 = (function () {
    var S = 14;
    function ok(x, y) { return x >= 0 && y >= 0 && x < S && y < S && !((x < 3 || x > 10) && (y < 3 || y > 10)); }
    function step(c, d) {
      var x = c % S + d[1], y = Math.floor(c / S) + d[0];
      return ok(x, y) ? [{ cell: y * S + x, dir: d }] : [];
    }
    // Camps : 0 Rouges (en bas), 1 Bleus (à gauche), 2 Jaunes (en haut), 3 Verts (à droite). Direction [dy, dx].
    var FWD = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    // Case de la 1re rangée du camp p, i-ème depuis sa gauche (i = 0..7), et sa rangée de pions
    function backCell(p, i, row) {
      if (p === 0) return (13 - row) * S + 3 + i;
      if (p === 1) return (3 + i) * S + row;
      if (p === 2) return row * S + 10 - i;
      return (10 - i) * S + 13 - row;
    }
    function initial() {
      var b = [], p, i;
      for (i = 0; i < S * S; i++) b.push(null);
      for (p = 0; p < 4; p++) {
        for (i = 0; i < 8; i++) {
          b[backCell(p, i, 0)] = { c: p, t: BACK.charAt(i) };
          b[backCell(p, i, 1)] = { c: p, t: 'P' };
        }
      }
      return b;
    }
    // Rangée du camp p (1 = sa 1re rangée) où se trouve la case
    function rankOf(c, p) {
      var x = c % S, y = Math.floor(c / S);
      return [14 - y, x + 1, y + 1, 14 - x][p];
    }
    var cells = [], k;
    for (k = 0; k < S * S; k++) if (ok(k % S, Math.floor(k / S))) cells.push(k);
    return {
      id: 'cross4', name: 'Échecs à 4', size: S * S, cells: cells, teamsAllowed: true,
      players: [{ name: 'Rouges', code: 'r' }, { name: 'Bleus', code: 'u' }, { name: 'Jaunes', code: 'y' }, { name: 'Verts', code: 'g' }],
      step: step, initial: initial,
      label: function (c) { return FILES.charAt(c % S) + (S - Math.floor(c / S)); },
      polygon: function (c) {
        var x = c % S, y = Math.floor(c / S), u = 2 / S;
        var x0 = -1 + x * u, y0 = -1 + y * u;
        return [[x0, y0], [x0 + u, y0], [x0 + u, y0 + u], [x0, y0 + u]];
      },
      pawnDir: function (c, color) { return FWD[color]; },
      pawnStart: function (c, color) { return rankOf(c, color) === 2; },
      promotes: function (c, color) { return rankOf(c, color) === 8; },
      dark: function (c) { return ((c % S + Math.floor(c / S)) & 1) === 0; },   // d1 foncée, k1 claire (« blanc à droite »)
      viewAngle: function (p) { return [0, 270, 180, 90][p]; }
    };
  })();

  var VARIANTS = { yalta: yalta, cross4: cross4 };

  /* ---------- Génération des coups ---------- */
  function perp(d) { return d[0] === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]; }

  // Cibles d'une pièce (cases atteintes, prises comprises) ; attacks : cases attaquées seulement (pions : diagonales).
  // isEnemy(piece) : pièce que l'on peut prendre.
  function targetsOf(v, board, c, isEnemy, attacks) {
    var pc = board[c], out = [], seen = {}, i, j, k;
    function add(t, promo) {
      if (seen[t]) return;
      seen[t] = true;
      out.push({ from: c, to: t, cap: board[t] || null, promo: !!promo });
    }
    function slide(dirs) {
      for (i = 0; i < dirs.length; i++) {
        var stack = v.step(c, dirs[i]), visited = {};
        while (stack.length) {
          var n = stack.pop();
          if (visited[n.cell] || n.cell === c) continue;
          visited[n.cell] = true;
          var occ = board[n.cell];
          if (!occ) { add(n.cell); stack = stack.concat(v.step(n.cell, n.dir)); }
          else if (attacks || isEnemy(occ)) add(n.cell);
        }
      }
    }
    var t = pc.t;
    if (t === 'R') slide(ORTHO);
    else if (t === 'B') slide(DIAG);
    else if (t === 'Q') slide(ALL);
    else if (t === 'K' || t === 'N') {
      var steps = [];
      if (t === 'K') {
        for (i = 0; i < ALL.length; i++) steps = steps.concat(v.step(c, ALL[i]));
      } else {
        for (i = 0; i < ORTHO.length; i++) {
          var s1 = v.step(c, ORTHO[i]);
          for (j = 0; j < s1.length; j++) {
            var pp = perp(s1[j].dir);
            for (k = 0; k < pp.length; k++) steps = steps.concat(v.step(s1[j].cell, [s1[j].dir[0] + pp[k][0], s1[j].dir[1] + pp[k][1]]));
          }
        }
      }
      for (i = 0; i < steps.length; i++) {
        var o = board[steps[i].cell];
        if (steps[i].cell !== c && (!o || attacks || isEnemy(o))) add(steps[i].cell);
      }
    } else if (t === 'P') {
      var fwd = v.pawnDir(c, pc.c);
      if (!attacks) {
        var f1 = v.step(c, fwd);
        for (i = 0; i < f1.length; i++) {
          if (board[f1[i].cell]) continue;
          add(f1[i].cell, v.promotes(f1[i].cell, pc.c));
          if (v.pawnStart(c, pc.c)) {
            var f2 = v.step(f1[i].cell, f1[i].dir);
            for (j = 0; j < f2.length; j++) if (!board[f2[j].cell]) add(f2[j].cell, v.promotes(f2[j].cell, pc.c));
          }
        }
      }
      var pd = perp(fwd);
      for (i = 0; i < pd.length; i++) {
        var cs = v.step(c, [fwd[0] + pd[i][0], fwd[1] + pd[i][1]]);
        for (j = 0; j < cs.length; j++) {
          var occ2 = board[cs[j].cell];
          if (attacks || (occ2 && isEnemy(occ2))) add(cs[j].cell, v.promotes(cs[j].cell, pc.c));
        }
      }
    }
    return out;
  }

  /* ---------- Partie ---------- */
  function Game(variantId, opts) {
    var v = VARIANTS[variantId];
    if (!v) throw new Error('Variante inconnue : ' + variantId);
    this.v = v;
    this.variant = variantId;
    this.n = v.players.length;
    this.teams = !!(opts && opts.teams) && v.teamsAllowed;
    this.board = v.initial();
    this.turn = 0;
    this.alive = [];
    this.out = [];          // raison de l'élimination : 'mate' | 'stalemate' | 'resign' | 'king' | null
    for (var i = 0; i < this.n; i++) { this.alive.push(true); this.out.push(null); }
    this.history = [];      // actions : {from, to, promo, san, color} ou {resign: camp}
    this.boards = [this.board.slice()];
    this.over = false;
    this.winners = null;    // camps gagnants (vide = nulle)
  }

  Game.prototype.allied = function (a, b) { return a === b || (this.teams && (a + 2) % 4 === b); };

  Game.prototype._enemyOf = function (color) {
    var self = this;
    return function (p) { return !self.allied(color, p.c) && self.alive[p.c]; };
  };

  // La case est-elle attaquée par un adversaire encore en jeu de color ?
  Game.prototype._attacked = function (board, cell, color) {
    var c, i;
    for (c = 0; c < board.length; c++) {
      var p = board[c];
      if (!p || this.allied(color, p.c) || !this.alive[p.c]) continue;
      var ts = targetsOf(this.v, board, c, function () { return true; }, true);
      for (i = 0; i < ts.length; i++) if (ts[i].to === cell) return true;
    }
    return false;
  };

  function kingCell(board, color) {
    for (var c = 0; c < board.length; c++) if (board[c] && board[c].c === color && board[c].t === 'K') return c;
    return -1;
  }

  Game.prototype.inCheck = function (color) {
    var k = kingCell(this.board, color);
    return k >= 0 && this._attacked(this.board, k, color);
  };
  Game.prototype.kingCell = function (color) { return kingCell(this.board, color); };

  // Coups légaux de color (le camp au trait par défaut) : [{from, to, cap, promo (bool : promotion à choisir)}].
  // first : s'arrêter au premier trouvé (test « a-t-il au moins un coup ? »).
  Game.prototype.legalMoves = function (color, first) {
    if (color == null) color = this.turn;
    var out = [], board = this.board, enemy = this._enemyOf(color), c, i;
    for (c = 0; c < board.length; c++) {
      if (!board[c] || board[c].c !== color) continue;
      var ts = targetsOf(this.v, board, c, enemy, false);
      for (i = 0; i < ts.length; i++) {
        var b2 = board.slice();
        b2[ts[i].to] = b2[c];
        b2[c] = null;
        var k = kingCell(b2, color);
        if (k >= 0 && this._attacked(b2, k, color)) continue;
        out.push(ts[i]);
        if (first) return out;
      }
    }
    return out;
  };

  Game.prototype.targets = function (from) {
    if (this.over) return [];
    return this.legalMoves(this.turn).filter(function (m) { return m.from === from; });
  };

  Game.prototype._eliminate = function (color, reason) {
    if (!this.alive[color]) return;
    this.alive[color] = false;
    this.out[color] = reason;
    for (var c = 0; c < this.board.length; c++) if (this.board[c] && this.board[c].c === color) this.board[c] = null;
    this._checkOver();
  };

  Game.prototype._checkOver = function () {
    var alive = [], i, c, self = this;
    for (i = 0; i < this.n; i++) if (this.alive[i]) alive.push(i);
    if (this.teams) {
      var lost = null;
      for (i = 0; i < this.n; i++) if (!this.alive[i] && this.out[i]) { lost = i; break; }
      if (lost !== null) {
        this.over = true;
        this.winners = alive.filter(function (p) { return !self.allied(p, lost); });
        return;
      }
    } else if (alive.length <= 1) { this.over = true; this.winners = alive; return; }
    for (c = 0; c < this.board.length; c++) if (this.board[c] && this.board[c].t !== 'K') return;
    this.over = true;                // il ne reste que des rois : nulle
    this.winners = [];
  };

  // Passe au camp suivant encore en jeu ; celui qui n'a aucun coup légal est éliminé (mat ou pat).
  Game.prototype._nextTurn = function () {
    var guard = 0;
    while (!this.over && guard++ < 2 * this.n) {
      var t = this.turn;
      do { t = (t + 1) % this.n; } while (!this.alive[t]);
      this.turn = t;
      if (this.legalMoves(t, true).length) return;
      this._eliminate(t, this.inCheck(t) ? 'mate' : 'stalemate');
    }
  };

  // Joue un coup du camp au trait. promo : 'Q'|'R'|'B'|'N' (dame par défaut). Retourne l'action jouée ou null.
  Game.prototype.move = function (from, to, promo) {
    if (this.over) return null;
    var list = this.legalMoves(this.turn), m = null, i;
    for (i = 0; i < list.length; i++) if (list[i].from === from && list[i].to === to) { m = list[i]; break; }
    if (!m) return null;
    var color = this.turn, pc = this.board[from], v = this.v;
    var pr = m.promo ? (/^[QRBN]$/.test(String(promo || '').toUpperCase()) ? String(promo).toUpperCase() : 'Q') : null;
    this.board[to] = pr ? { c: color, t: pr } : pc;
    this.board[from] = null;
    var san = (pc.t === 'P' ? '' : pc.t) + v.label(from) + (m.cap ? 'x' : '-') + v.label(to) + (pr ? '=' + pr : '');
    if (m.cap && m.cap.t === 'K') this._eliminate(m.cap.c, 'king');
    else if (m.cap) this._checkOver();       // plus que des rois : nulle
    var checks = false;
    for (i = 0; i < this.n; i++) if (this.alive[i] && !this.allied(color, i) && this.inCheck(i)) checks = true;
    if (checks) san += '+';
    var rec = { from: from, to: to, promo: pr, san: san, color: color, piece: pc.t, cap: m.cap ? m.cap.t : null, capColor: m.cap ? m.cap.c : null };
    this.history.push(rec);
    this._nextTurn();
    this.boards.push(this.board.slice());
    return rec;
  };

  // Abandon d'un camp (à son tour ou non).
  Game.prototype.resign = function (color) {
    if (this.over || !this.alive[color]) return false;
    var wasTurn = this.turn === color;
    this._eliminate(color, 'resign');
    if (wasTurn && !this.over) this._nextTurn();
    else if (!this.over && !this.legalMoves(this.turn, true).length) { this.turn = (this.turn + this.n - 1) % this.n; this._nextTurn(); }
    this.history.push({ resign: color });
    this.boards.push(this.board.slice());
    return true;
  };

  Game.prototype.status = function () {
    return { over: this.over, winners: this.winners, alive: this.alive.slice(), out: this.out.slice(), turn: this.turn };
  };

  // Rejoue une liste d'actions ({from, to, promo} ou {resign}) ; null si l'une est illégale.
  function replay(variantId, opts, actions) {
    var g = new Game(variantId, opts), i;
    for (i = 0; i < actions.length; i++) {
      var a = actions[i];
      var ok = a.resign != null ? g.resign(a.resign) : g.move(a.from, a.to, a.promo);
      if (!ok) return null;
    }
    return g;
  }

  return { VARIANTS: VARIANTS, Game: Game, replay: replay, targetsOf: targetsOf };
});
