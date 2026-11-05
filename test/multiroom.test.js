var assert = require('assert');
var MC = require('../public/js/multichess.js');
var MultiRoom = require('../public/js/multiroom.js');

var v = MC.VARIANTS.yalta, L = {};
v.cells.forEach(function (c) { L[v.label(c)] = c; });
var inbox = {};
function send(cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); }
function last(cid, t) { var l = (inbox[cid] || []).filter(function (m) { return m.t === t; }); return l[l.length - 1]; }

var room = new MultiRoom({ code: 'ABCDE', variant: 'yalta', send: send });
assert(room.hello('A', { name: 'Alice', role: 'player' }));
assert.strictEqual(last('A', 'state').state.you, 0);
room.handle('A', { t: 'move', from: L.e2, to: L.e4 });
assert.strictEqual(last('A', 'error').message, 'En attente des autres joueurs');
assert(room.hello('B', { name: 'Bob', role: 'player' }));
assert(room.hello('C', { name: 'Chloé', role: 'player', color: 2 }));
assert.strictEqual(last('C', 'state').state.you, 2);
assert(room.hello('S', { name: 'Sam', role: 'spectator' }));
assert(!room.hello('D', { name: 'Dan', role: 'player' }), 'partie complète');
assert.strictEqual(last('D', 'reject').message.indexOf('complète') > 0, true);
var st = last('S', 'state').state;
assert.strictEqual(st.you, null);
assert.deepStrictEqual(st.players, ['Alice', 'Bob', 'Chloé']);
assert.strictEqual(st.spectators, 1);

// Tours
room.handle('B', { t: 'move', from: L.e7, to: L.e5 });
assert.strictEqual(last('B', 'error').message, 'Ce n’est pas ton tour');
room.handle('A', { t: 'move', from: L.e2, to: L.e4 });
room.handle('B', { t: 'move', from: L.e7, to: L.e5 });
room.handle('S', { t: 'move', from: L.e11, to: L.e9 });
assert.strictEqual(last('S', 'error').message, 'Tu ne joues pas cette partie');
room.handle('C', { t: 'move', from: L.e2, to: L.e3 });
assert.strictEqual(last('C', 'error').message, 'Coup illégal');
room.handle('C', { t: 'move', from: L.e11, to: L.e9 });
st = last('A', 'state').state;
assert.strictEqual(st.actions.length, 3);

// Bascule d'hôte : Bob reprend avec le dernier état ; Alice et Chloé retrouvent leur siège par leur nom
inbox = {};
var room2 = new MultiRoom({ code: 'ABCDE', send: send, restore: { state: st } });
assert.strictEqual(room2.game.history.length, 3);
assert(room2.hello('B', { name: 'Bob', role: 'player', color: 1 }));
assert(room2.hello('A2', { name: 'Alice', role: 'player', color: 0 }));   // nouvel appareil, même nom
assert.strictEqual(last('A2', 'state').state.you, 0);
assert(last('B', 'state').state.epoch > st.epoch);
// Chloé ne revient pas : au trait d'Alice, puis Bob, puis Chloé déconnectée -> les autres la retirent
room2.handle('A2', { t: 'move', from: L.d2, to: L.d4 });
room2.handle('B', { t: 'move', from: L.d7, to: L.d5 });
room2.handle('A2', { t: 'kick', seat: 2 });
st = last('B', 'state').state;
assert.strictEqual(room2.game.alive[2], false);
assert.strictEqual(st.actions[st.actions.length - 1].resign, 2);
room2.handle('A2', { t: 'kick', seat: 1 });
assert.strictEqual(last('A2', 'error').message, 'Ce joueur est connecté');
// Bob abandonne : Alice gagne
room2.handle('A2', { t: 'move', from: L.c2, to: L.c3 });
room2.handle('B', { t: 'resign' });
st = last('A2', 'state').state;
assert(st.status.over);
assert.deepStrictEqual(st.status.winners, [0]);
var re = MC.replay('yalta', null, st.actions);
assert(re && re.over && re.winners[0] === 0);

// 4 joueurs en équipes
inbox = {};
var r4 = new MultiRoom({ code: 'QWERT', variant: 'cross4', teams: true, send: send });
['a', 'b', 'c', 'd'].forEach(function (cid) { assert(r4.hello(cid, { name: cid, role: 'player' })); });
var s4 = last('a', 'state').state;
assert.strictEqual(s4.variant, 'cross4');
assert.strictEqual(s4.teams, true);
assert.strictEqual(s4.players.length, 4);
r4.handle('b', { t: 'resign' });
assert.deepStrictEqual(last('a', 'state').state.status.winners.sort(), [0, 2]);

console.log('multiroom OK');
