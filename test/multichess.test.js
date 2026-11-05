var assert = require('assert');
var MC = require('../public/js/multichess.js');

function byLabel(v) { var m = {}; v.cells.forEach(function (c) { m[v.label(c)] = c; }); return m; }
function mv(g, L, a, b, promo) { var r = g.move(L[a], L[b], promo); assert(r, 'coup illégal ' + a + '-' + b); return r; }

['yalta', 'cross4'].forEach(function (id) {
  var v = MC.VARIANTS[id], L = byLabel(v);
  // Noms de cases uniques
  assert.strictEqual(Object.keys(L).length, v.cells.length, id + ' : noms uniques');
  // Déplacements réversibles : revenir en arrière depuis la case atteinte ramène à la case de départ
  v.cells.forEach(function (c) {
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (d) {
      v.step(c, d).forEach(function (n) {
        var back = v.step(n.cell, [-n.dir[0], -n.dir[1]]).map(function (x) { return x.cell; });
        assert(back.indexOf(c) >= 0, id + ' : retour impossible ' + v.label(c) + ' ' + d + ' -> ' + v.label(n.cell));
      });
    });
  });
  // Départ : 16 pièces par camp, 20 coups (16 de pions + 4 de cavaliers) pour le premier camp
  var g = new MC.Game(id);
  assert.strictEqual(g.board.filter(function (p) { return p; }).length, 16 * v.players.length);
  assert.strictEqual(g.legalMoves().length, 20, id + ' : 20 coups au départ');
  assert.strictEqual(v.polygon(v.cells[0]).length, 4);
});

/* ---------- Yalta ---------- */
function empty(g) { for (var i = 0; i < g.board.length; i++) g.board[i] = null; }
function put(g, L, sq, c, t) { g.board[L[sq]] = { c: c, t: t }; }

(function () {
  var v = MC.VARIANTS.yalta, L = byLabel(v);
  assert.strictEqual(v.cells.length, 96);
  // e4 (Blancs) touche e5 (Noirs) ; d4 (Blancs) touche d9 (Rouges) ; diagonale par le centre : deux suites
  assert.deepStrictEqual(v.step(L.e4, [1, 0]).map(function (n) { return v.label(n.cell); }), ['e5']);
  assert.deepStrictEqual(v.step(L.d4, [1, 0]).map(function (n) { return v.label(n.cell); }), ['d9']);
  assert.strictEqual(v.step(L.d4, [1, 1]).length, 2);

  // Tour par tour, et un pion blanc qui entre chez les Noirs puis avance vers leur 1re rangée
  var g = new MC.Game('yalta');
  mv(g, L, 'e2', 'e4'); assert.strictEqual(g.turn, 1);
  mv(g, L, 'a7', 'a6'); assert.strictEqual(g.turn, 2);
  mv(g, L, 'a11', 'a10'); assert.strictEqual(g.turn, 0);
  var r = mv(g, L, 'e4', 'e5');
  assert.strictEqual(r.san, 'e4-e5');
  g.turn = 0;   // (on regarde le pion blanc sans jouer pour les autres)
  assert.deepStrictEqual(g.targets(L.e5).map(function (m) { return v.label(m.to); }), ['e6'], 'le pion avance vers la 1re rangée noire');
  g.turn = 1;
  assert(MC.replay('yalta', null, g.history), 'rejouable');

  // Promotion : pion blanc en c2 chez les Noirs (case c7) -> c8
  g = new MC.Game('yalta'); empty(g);
  put(g, L, 'e1', 0, 'K'); put(g, L, 'e8', 1, 'K'); put(g, L, 'e12', 2, 'K'); put(g, L, 'a7', 0, 'P');
  var pm = g.targets(L.a7).filter(function (m) { return m.to === L.a8; })[0];
  assert(pm && pm.promo, 'promotion proposée');
  r = mv(g, L, 'a7', 'a8', 'N');
  assert.strictEqual(g.board[L.a8].t, 'N');
  assert.strictEqual(r.san, 'a7-a8=N');

  // Mat : roi noir en h8 bloqué par ses pions h7 g7, tour blanche en a8 qui l'attaque ; les Blancs jouent un coup
  // quelconque, les Noirs n'ont aucun coup -> éliminés (mat), le trait passe aux Rouges
  g = new MC.Game('yalta'); empty(g);
  put(g, L, 'e1', 0, 'K'); put(g, L, 'a8', 0, 'R'); put(g, L, 'h8', 1, 'K'); put(g, L, 'h7', 1, 'P'); put(g, L, 'g7', 1, 'P');
  put(g, L, 'e12', 2, 'K'); put(g, L, 'a11', 2, 'P');
  mv(g, L, 'e1', 'd1');
  assert.strictEqual(g.alive[1], false);
  assert.strictEqual(g.out[1], 'mate');
  assert.strictEqual(g.board[L.h7], null, 'pièces de l’éliminé retirées');
  assert.strictEqual(g.turn, 2);
  assert(!g.over);

  // Capture du roi : le roi rouge est laissé en prise (par un coup noir), les Blancs le prennent
  g = new MC.Game('yalta'); empty(g);
  put(g, L, 'e1', 0, 'K'); put(g, L, 'a1', 0, 'R'); put(g, L, 'h8', 1, 'K'); put(g, L, 'a12', 2, 'K'); put(g, L, 'h12', 2, 'R');
  put(g, L, 'a9', 2, 'P');
  // a1-a4 puis a4 -> a9 ? non : on place directement la tour blanche face au roi rouge par la colonne a (a4 touche a9)
  g.board[L.a9] = null; put(g, L, 'a4', 0, 'R'); g.board[L.a1] = null;
  r = mv(g, L, 'a4', 'a12');
  assert.strictEqual(r.cap, 'K');
  assert.strictEqual(g.out[2], 'king');
  assert.strictEqual(g.turn, 1);

  // Abandons : Rouges (hors de leur tour) puis Noirs -> les Blancs gagnent
  g = new MC.Game('yalta');
  assert(g.resign(2));
  assert.strictEqual(g.turn, 0);
  mv(g, L, 'e2', 'e4'); assert.strictEqual(g.turn, 1, 'les Rouges sont sautés');
  assert(g.resign(1));
  assert(g.over);
  assert.deepStrictEqual(g.winners, [0]);
  var rp = MC.replay('yalta', null, g.history);
  assert(rp && rp.over && rp.winners[0] === 0);

  // Nulle : il ne reste que des rois
  g = new MC.Game('yalta'); empty(g);
  put(g, L, 'e1', 0, 'K'); put(g, L, 'e2', 1, 'R'); put(g, L, 'e8', 1, 'K'); put(g, L, 'e12', 2, 'K');
  mv(g, L, 'e1', 'e2');
  assert(g.over);
  assert.deepStrictEqual(g.winners, []);
})();

/* ---------- Croix à 4 ---------- */
(function () {
  var v = MC.VARIANTS.cross4, L = byLabel(v);
  assert.strictEqual(v.cells.length, 160);
  var g = new MC.Game('cross4');
  assert.strictEqual(g.board[L.h1].t, 'K'); assert.strictEqual(g.board[L.h1].c, 0);   // roi rouge en h1
  assert.strictEqual(g.board[L.g14].t, 'K'); assert.strictEqual(g.board[L.g14].c, 2); // roi jaune en g14
  assert.strictEqual(g.board[L.a7].t, 'K'); assert.strictEqual(g.board[L.a7].c, 1);   // roi bleu en a7
  assert.strictEqual(g.board[L.n8].t, 'K'); assert.strictEqual(g.board[L.n8].c, 3);   // roi vert en n8
  mv(g, L, 'e2', 'e4');                 // Rouges
  mv(g, L, 'b7', 'd7');                 // Bleus (double pas vers la droite)
  mv(g, L, 'j13', 'j11');               // Jaunes
  mv(g, L, 'm8', 'k8');                 // Verts
  assert.strictEqual(g.turn, 0);
  // Promotion des Rouges sur la 8e rangée
  g = new MC.Game('cross4'); empty(g);
  put(g, L, 'h1', 0, 'K'); put(g, L, 'a7', 1, 'K'); put(g, L, 'g14', 2, 'K'); put(g, L, 'n8', 3, 'K'); put(g, L, 'e7', 0, 'P');
  assert(g.targets(L.e7)[0].promo);
  mv(g, L, 'e7', 'e8');
  assert.strictEqual(g.board[L.e8].t, 'Q');
  // Équipes : les Rouges ne peuvent pas prendre une pièce jaune ; la première équipe qui perd un joueur perd
  g = new MC.Game('cross4', { teams: true }); empty(g);
  put(g, L, 'h1', 0, 'K'); put(g, L, 'h4', 0, 'R'); put(g, L, 'h8', 2, 'P'); put(g, L, 'a7', 1, 'K'); put(g, L, 'g14', 2, 'K'); put(g, L, 'n8', 3, 'K');
  assert(!g.targets(L.h4).some(function (m) { return m.to === L.h8; }), 'pas de prise de l’allié');
  assert(g.resign(3));
  assert(g.over);
  assert.deepStrictEqual(g.winners.sort(), [0, 2]);
  assert.strictEqual(new MC.Game('yalta', { teams: true }).teams, false, 'pas d’équipes à 3');
})();

console.log('multichess OK');
