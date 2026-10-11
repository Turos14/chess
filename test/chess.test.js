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

console.log('OK');
