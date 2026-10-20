var assert = require('assert');
var Room = require('../public/js/room.js');

function mk(opts) {
  var inbox = {};
  var t = { now: 1000000 };
  var room = new Room({
    code: 'ABCDE', tc: opts && opts.tc, restore: opts && opts.restore, startFen: opts && opts.startFen,
    now: function () { return t.now; },
    send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); }
  });
  function last(cid, type) {
    var l = inbox[cid] || [];
    for (var i = l.length - 1; i >= 0; i--) if (l[i].t === (type || 'state')) return l[i];
    return null;
  }
  return { room: room, t: t, inbox: inbox, last: last, state: function (cid) { return last(cid).state; } };
}
// --- Fischer 960 : la position de départ est diffusée et survit à une bascule d'hôte
(function () {
  var fen = 'rk5r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w HAha - 0 1';
  var x = mk({ startFen: fen });
  x.room.hello('A', { name: 'Alice', role: 'player', color: 'w' });
  x.room.hello('B', { name: 'Bob', role: 'player' });
  assert.strictEqual(x.state('A').startFen, fen);
  x.room.handle('A', { t: 'move', from: 'b1', to: 'h1' });   // petit roque 960 (roi sur tour)
  var s = x.state('B');
  assert.strictEqual(s.moves[0].san, 'O-O');
  var y = mk({ restore: { state: s } });
  assert.strictEqual(y.room.game.startFen, fen);
  assert.strictEqual(y.room.game.fen(), x.room.game.fen());
})();

// --- Création, sièges, coups, mat
var r = mk({ tc: { base: 60000, inc: 1000 } });
assert(r.room.hello('A', { name: 'Alice', role: 'player', color: 'w' }));
assert.strictEqual(r.state('A').you, 'w');
r.room.handle('A', { t: 'move', from: 'e2', to: 'e4' });
assert(/attente/.test(r.last('A', 'error').message));
assert(r.room.hello('B', { name: 'Bob', role: 'player' }));
assert.strictEqual(r.state('B').you, 'b');
assert.strictEqual(r.room.hello('C', { name: 'Carl', role: 'player' }), false);
assert(/complète/.test(r.last('C', 'reject').message));
assert(r.room.hello('S', { name: 'Sam', role: 'spectator' }));
assert.strictEqual(r.state('A').spectators, 1);

r.room.handle('B', { t: 'move', from: 'e7', to: 'e5' });
assert(/tour/.test(r.last('B', 'error').message));
r.room.handle('A', { t: 'move', from: 'e2', to: 'e5' });
assert(/illégal/.test(r.last('A', 'error').message));
r.room.handle('S', { t: 'move', from: 'e2', to: 'e4' });
assert(/ne joues pas/.test(r.last('S', 'error').message));

r.room.handle('A', { t: 'move', from: 'e2', to: 'e4' });
assert.strictEqual(r.state('B').moves.length, 1);
assert.strictEqual(r.state('B').clock.running, true);
assert.strictEqual(r.state('B').clock.turn, 'b');
r.t.now += 5000;
r.room.handle('B', { t: 'move', from: 'e7', to: 'e5' });
assert.strictEqual(r.state('A').clock.b, 56000);           // 60 s - 5 s + 1 s d'incrément
[['A', 'd1', 'h5'], ['B', 'b8', 'c6'], ['A', 'f1', 'c4'], ['B', 'g8', 'f6'], ['A', 'h5', 'f7']].forEach(function (m) {
  r.room.handle(m[0], { t: 'move', from: m[1], to: m[2] });
});
var s = r.state('S');
assert.strictEqual(s.status.reason, 'checkmate'); assert.strictEqual(s.status.winner, 'w');
assert.strictEqual(s.moves[s.moves.length - 1].san, 'Qxf7#'); assert.strictEqual(s.clock.running, false);

// --- Abandon et nulle
r = mk();
r.room.hello('A', { name: 'A', role: 'player', color: 'b' }); r.room.hello('B', { name: 'B', role: 'player' });
assert.strictEqual(r.state('A').you, 'b'); assert.strictEqual(r.state('B').you, 'w');
r.room.handle('A', { t: 'draw', action: 'offer' });
assert.strictEqual(r.state('B').drawOffer, 'b');
r.room.handle('B', { t: 'draw', action: 'decline' });
assert.strictEqual(r.state('A').drawOffer, null); assert.strictEqual(r.state('A').declined, 1);
r.room.handle('B', { t: 'draw', action: 'offer' }); r.room.handle('A', { t: 'draw', action: 'accept' });
assert.strictEqual(r.state('A').status.reason, 'agreement');
r = mk();
r.room.hello('A', { name: 'A', role: 'player', color: 'w' }); r.room.hello('B', { name: 'B', role: 'player' });
r.room.handle('B', { t: 'resign' });
assert.strictEqual(r.state('A').status.reason, 'resign'); assert.strictEqual(r.state('A').status.winner, 'w');

// --- Temps écoulé (minuterie réelle)
var real = new Room({ code: 'T', tc: { base: 200, inc: 0 }, send: function (c, m) { if (m.t === 'state') real.last = m.state; } });
real.hello('A', { name: 'A', role: 'player', color: 'w' }); real.hello('B', { name: 'B', role: 'player' });
real.handle('A', { t: 'move', from: 'e2', to: 'e4' });

// --- Elo de départ : transite par l'état synchronisé, identique pour tout le monde (hôte, invité, spectateur)
r = mk();
r.room.hello('A', { name: 'Nouveau', role: 'player', color: 'w', eloStart: 1650 });
r.room.hello('B', { name: 'Chevronné', role: 'player', eloStart: 900 });
r.room.hello('S', { name: 'Spec', role: 'spectator' });
assert.deepStrictEqual(r.state('A').eloStart, { w: 1650, b: 900 });
assert.deepStrictEqual(r.state('B').eloStart, { w: 1650, b: 900 });
assert.deepStrictEqual(r.state('S').eloStart, { w: 1650, b: 900 });
// une reconnexion (même cid) qui ne renvoie pas d'Elo de départ garde celui déjà établi (ne l'efface pas)
r.room.leave('A');
r.room.hello('A', { name: 'Nouveau', role: 'player' });
assert.strictEqual(r.state('A').eloStart.w, 1650);
r.room.destroy();

// --- Bascule d'hôte : le nouvel hôte repart du dernier état d'un client
r = mk({ tc: { base: 60000, inc: 0 } });
r.room.hello('A', { name: 'Alice', role: 'player', color: 'w', eloStart: 1400 }); r.room.hello('B', { name: 'Bob', role: 'player' }); r.room.hello('S', { name: 'Sam', role: 'spectator' });
r.room.handle('A', { t: 'move', from: 'e2', to: 'e4' });
r.t.now += 3000;
r.room.handle('B', { t: 'move', from: 'e7', to: 'e5' });
var snap = r.state('S');                                   // dernier état reçu par un spectateur
var frozen = { w: snap.clock.w - 2000, b: snap.clock.b };  // temps figé au moment de la perte de l'hôte
var n = mk({ tc: null, restore: { state: snap, frozen: frozen } });
assert.strictEqual(n.room.epoch, 1); assert(n.room.v > snap.v);
assert.strictEqual(n.room.game.history.length, 2); assert.strictEqual(n.room.game.turn(), 'w');
assert.strictEqual(n.room.tc.base, 60000);
// un intrus ne peut pas prendre un siège restauré (noms différents) : la partie est complète
assert.strictEqual(n.room.hello('X', { name: 'Mallory', role: 'player', color: 'b' }), false);
assert(/complète/.test(n.last('X', 'reject').message));
n.room.hello('B2', { name: 'Bob', role: 'player', color: 'b' });
assert.strictEqual(n.state('B2').you, 'b');
// l'Elo de départ d'Alice (saisi avant la bascule) a survécu, alors qu'elle n'est pas encore reconnectée
assert.strictEqual(n.state('B2').eloStart.w, 1400);
n.room.hello('A2', { name: 'Alice', role: 'player', color: 'w' });
assert.strictEqual(n.state('A2').you, 'w');
assert.strictEqual(n.state('A2').eloStart.w, 1400);
n.room.hello('S2', { name: 'Sam', role: 'spectator' });
var ns = n.state('A2');
assert.strictEqual(ns.moves.length, 2); assert.strictEqual(ns.clock.running, true); assert.strictEqual(ns.clock.turn, 'w');
assert.strictEqual(ns.clock.w, 58000);                      // temps figé repris, pas de perte pendant la bascule
assert.strictEqual(ns.epoch, 1);
n.room.handle('A2', { t: 'move', from: 'g1', to: 'f3' });
assert.strictEqual(n.state('B2').moves.length, 3);
// rechargement de page : même cid -> même siège
n.room.leave('A2'); n.room.hello('A2', { name: 'Alice', role: 'player' });
assert.strictEqual(n.state('A2').you, 'w');
n.room.destroy(); r.room.destroy();

setTimeout(function () {
  assert(real.last.status.over && real.last.status.reason === 'timeout' && real.last.status.winner === 'w', JSON.stringify(real.last.status));
  real.destroy();
  console.log('room OK');
}, 500);
