var assert = require('assert');
var Chess = require('../public/js/chess.js');
var cases = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]]
];
cases.forEach(function (c) {
  c[1].forEach(function (exp, i) {
    assert.strictEqual(Chess.perft(c[0], i + 1), exp, c[0] + ' depth ' + (i + 1));
  });
});
var g = new Chess.Game();
['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'].forEach(function (m) { assert(g.move(m.slice(0, 2), m.slice(2, 4)), m); });
assert.strictEqual(g.history[g.history.length - 1].san, 'Qxf7#');
assert.strictEqual(g.status().result, '1-0');
assert.strictEqual(g.status().reason, 'checkmate');
console.log(g.pgn());
g = new Chess.Game('r3k2r/1P6/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1');
assert(g.move('e5', 'd6') && g.history[0].ep && g.history[0].san === 'exd6');
assert(g.move('e8', 'g8') && g.history[1].san === 'O-O');
assert(g.move('b7', 'a8', 'n') && g.history[2].san === 'bxa8=N');
assert.strictEqual(new Chess.Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().reason, 'stalemate');
assert.strictEqual(new Chess.Game('8/8/8/4k3/8/8/2K5/8 w - - 0 1').status().reason, 'insufficient');
g = new Chess.Game();
'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'.split(' ').forEach(function (m) { g.move(m.slice(0, 2), m.slice(2, 4)); });
assert.strictEqual(g.status().reason, 'repetition');
g.undo(); assert(!g.status().over);
var r = Chess.replay(Chess.START, g.history);
assert.strictEqual(r.fen(), g.fen());

// Matériel : position de départ équilibrée (39 points chacun), puis après une prise
var start = new Chess.Game();
var m0 = Chess.material(start.board());
assert.strictEqual(m0.w, 39); assert.strictEqual(m0.b, 39); assert.strictEqual(m0.diff, 0);
g = new Chess.Game();
['e2e4', 'd7d5', 'e4d5'].forEach(function (m) { g.move(m.slice(0, 2), m.slice(2, 4)); });
var m1 = Chess.material(g.board());
assert.strictEqual(m1.w, 39); assert.strictEqual(m1.b, 38); assert.strictEqual(m1.diff, 1);

// Échecs aléatoires Fischer (Chess960)
// Perft de référence (suite de positions 960 de Scharnagl, valeurs vérifiées avec chessops de Lichess).
assert.strictEqual(Chess.perft('bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', 3), 12189);
assert.strictEqual(Chess.perft('2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', 3), 18002);
// La position n° 518 est la position classique ; les 960 positions sont toutes distinctes et conformes.
assert.strictEqual(Chess.start960(518, 518), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
var seen960 = {};
for (var n = 0; n < 960; n++) {
  var f = Chess.start960(n, 959 - n), back = f.split('/')[7].split(' ')[0];
  assert(!seen960[back], 'position 960 en double : ' + n); seen960[back] = 1;
  assert.strictEqual(f.split('/')[0].toUpperCase(), Chess.start960(959 - n, 0).split('/')[7].split(' ')[0], 'rangée noire indépendante : ' + n);
  var bs = [back.indexOf('B'), back.lastIndexOf('B')];
  assert((bs[0] + bs[1]) % 2 === 1, 'fous de même couleur : ' + n);
  var k = back.indexOf('K');
  assert(back.indexOf('R') < k && back.lastIndexOf('R') > k, 'roi hors des tours : ' + n);
  assert(new Chess.Game(f).legalMoves().length >= 18, 'trop peu de coups : ' + n);
}
// Une FEN classique reste classique (KQkq), une FEN 960 garde sa notation.
assert(!new Chess.Game().chess960 && new Chess.Game().fen().split(' ')[2] === 'KQkq');
assert(Chess.is960('rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1') && !Chess.is960(Chess.START));
// Placements différents par camp, et pas de roque dans les parties Fischer de l'appli.
var asym = Chess.start960(0, 959);   // Blancs : BBQNNRKR, Noirs : RKRNNQBB
assert.strictEqual(asym, 'rkrnnqbb/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1');
var nc = new Chess.Game(Chess.start960(518, 518));
['g1f3', 'g8f6', 'e2e4', 'e7e5', 'f1c4', 'f8c5'].forEach(function (m) { assert(nc.move(m.slice(0, 2), m.slice(2, 4)), m); });
assert(!nc.move('e1', 'g1') && !nc.move('e1', 'h1'), 'aucun roque en Fischer');
var differents = 0;
for (var tq = 0; tq < 50; tq++) { var ff = Chess.start960().split('/'); if (ff[0].toUpperCase() !== ff[7].split(' ')[0]) differents++; }
assert(differents > 40, 'tirages indépendants pour les deux camps');
// Roque 960 : roi b1, tour a1 (grand roque) et tour h1 (petit roque) -> roi en c1/g1, tour en d1/f1.
var g960 = new Chess.Game('rk5r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w HAha - 0 1');
var oo = g960.move('b1', 'h1');   // roi sur sa tour (convention UCI 960)
assert(oo && oo.san === 'O-O' && g960.board()[Chess.sqIndex('g1')] === 'wK' && g960.board()[Chess.sqIndex('f1')] === 'wR');
assert.strictEqual(g960.fen().split(' ')[2], 'ha');
var ooo = g960.move('b8', 'c8');  // c8 est aussi une case d'arrivée de roque, mais b8c8 est d'abord un coup de roi normal
assert(ooo && ooo.san === 'Kc8' && !ooo.castle, 'b8c8 reste un coup de roi normal');
// Le roi déjà sur sa case d'arrivée : roque avec seulement la tour qui bouge.
var g2 = new Chess.Game('1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1');
var c2 = g2.move('g1', 'h1');
assert(c2 && c2.san === 'O-O' && g2.board()[Chess.sqIndex('g1')] === 'wK' && g2.board()[Chess.sqIndex('f1')] === 'wR');
assert.strictEqual(g2.move('g8', 'c8'), null);   // le roi traverserait f8, attaquée par la tour f1
var g3 = new Chess.Game('1r4kr/8/8/8/8/8/8/1R4KR b HBhb - 0 1');
var c4 = g3.move('g8', 'c8');     // grand roque désigné par la case d'arrivée du roi
assert(c4 && c4.san === 'O-O-O' && g3.board()[Chess.sqIndex('c8')] === 'bK' && g3.board()[Chess.sqIndex('d8')] === 'bR');
// Rejouer une partie 960 depuis sa FEN de départ donne la même position ; le PGN porte la variante.
var rg = Chess.replay(g2.startFen, g2.history);
assert.strictEqual(rg.fen(), g2.fen());
assert(/\[Variant "Chess960"\]/.test(g2.pgn()) && /\[FEN "1r4kr/.test(g2.pgn()));
assert(!/Variant/.test(new Chess.Game().pgn()));
// Classique : un moteur peut annoncer le roque « roi sur tour » (e1h1), accepté aussi.
var gs = new Chess.Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert(gs.move('e1', 'h1').san === 'O-O' && gs.board()[Chess.sqIndex('g1')] === 'wK');

console.log('OK');
