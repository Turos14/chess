// L'appli (public/js/livedata.js) et le relais (relais/lib/live.js) doivent parler exactement le même format :
// chaque corps construit par l'appli à partir de vraies parties doit être accepté et conservé par le serveur.
var assert = require('assert');
var Chess = require('../public/js/chess.js');
var MultiChess = require('../public/js/multichess.js');
var client = require('../public/js/livedata.js');
var server = require('../relais/lib/live.js');

assert.deepStrictEqual(client.MODES.slice().sort(), server.MODES.slice().sort());
assert.deepStrictEqual(client.REASONS.slice().sort(), server.REASONS.slice().sort());
assert.strictEqual(client.MAX_MOVES, server.MAX_MOVES);

function accepted(body, label) {
  var r = server.parse(JSON.parse(JSON.stringify(body)));
  assert.ok(!r.error, label + ' refusé : ' + r.error);
  return r;
}

// Partie à deux classique jusqu'au mat du berger, avec pendule
var g = new Chess.Game();
[['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']].forEach(function (m) { assert.ok(g.move(m[0], m[1])); });
var st = g.status();
var body = client.buildTwo({ gid: client.newGid(), mode: 'local', variant: 'classic', startFen: g.startFen, history: g.history,
  tc: { base: 600000, inc: 2000 }, result: { reason: st.reason, winner: st.winner } });
var r = accepted(body, 'mat du berger');
assert.deepStrictEqual(r.game.mv, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
assert.strictEqual(r.game.end.r, 'checkmate');

// Promotion + Fischer 960 + partie quittée, en ligne
var fen = '7k/P7/8/8/8/8/8/K7 w - - 0 1';
var g2 = new Chess.Game(fen);
assert.ok(g2.move('a7', 'a8', 'q'));
accepted(client.buildTwo({ gid: client.newGid(), mode: 'online', variant: 'classic', startFen: fen, history: g2.history, quit: true }), 'promotion');
var f960 = Chess.start960();
var g3 = new Chess.Game(f960);
var r3 = accepted(client.buildTwo({ gid: client.newGid(), mode: 'ai', variant: '960', startFen: f960, history: g3.history }), '960');
assert.strictEqual(r3.game.sf, f960);

// Parties à plusieurs : coups, abandon, fin, équipes
['yalta', 'cross4'].forEach(function (v) {
  var mg = new MultiChess.Game(v, { teams: v === 'cross4' });
  var moves = 0, guard = 0;
  while (moves < 6 && guard++ < 2000) {
    var c = Math.floor(Math.random() * mg.board.length), p = mg.board[c];
    if (!p || p.c !== mg.turn) continue;
    var t = mg.targets(c);
    if (t && t.length) { assert.ok(mg.move(c, t[0].to, t[0].promo ? 'q' : null)); moves++; }
  }
  mg.resign(mg.turn);
  var rb = accepted(client.buildMulti({ gid: client.newGid(), mode: 'online', variant: v, teams: v === 'cross4', history: mg.history,
    over: mg.over, winners: mg.winners || [] }), v);
  assert.strictEqual(rb.game.mv.length, mg.history.length, v + ' : tous les coups gardés');
  assert.ok(/^r\d$/.test(rb.game.mv[rb.game.mv.length - 1]), v + ' : abandon');
});

// Retrait du direct
assert.ok(server.parse(client.buildStop(client.newGid())).stop);

console.log('livecross OK');
