var assert = require('assert');
var Chat = require('../public/js/chat.js');
var Room = require('../public/js/room.js');
var MultiRoom = require('../public/js/multiroom.js');

// --- Nettoyage
assert.strictEqual(Chat.clean('  salut\n\ttoi  '), 'salut toi');
assert.strictEqual(Chat.clean('a b​c‮d'), 'a b c d');
assert.strictEqual(Chat.clean(null), '');
assert.strictEqual(Chat.clean(new Array(500).join('x')).length, Chat.MAX_LEN);

// --- Journal : limite d'envoi, historique borné, vue par destinataire
(function () {
  var t = { now: 0 }, log = new Chat.Log(null, function () { return t.now; });
  assert.strictEqual(log.post('A', { name: 'Alice', side: 'w' }, '   '), 'Message vide');
  for (var i = 0; i < 5; i++) assert.strictEqual(log.post('A', { name: 'Alice', side: 'w' }, 'm' + i), null);
  assert.ok(log.post('A', { name: 'Alice', side: 'w' }, 'trop'));          // 6e en moins de 10 s
  assert.strictEqual(log.post('B', { name: 'Bob', side: 'b' }, 'moi'), null); // limite propre à chacun
  t.now = 10001;
  assert.strictEqual(log.post('A', { name: 'Alice', side: 'w' }, 'ok'), null);
  var v = log.viewFor('B');
  assert.strictEqual(v.length, 7);
  assert.strictEqual(v[5].me, true);
  assert.strictEqual(v[0].me, false);
  assert.strictEqual(v[0].cid, undefined);                                   // jamais diffusé
  for (i = 0; i < 80; i++) { t.now += 3000; log.post('C', { name: 'C', side: null }, 'n' + i); }
  assert.strictEqual(log.list.length, Chat.KEEP);
  assert.strictEqual(log.list[Chat.KEEP - 1].x, 'n79');
})();

// --- Salle à deux : joueurs et spectateurs écrivent, l'état transporte le chat, survit à la bascule d'hôte
(function () {
  var inbox = {}, t = { now: 1000 };
  function last(cid, type) {
    var l = inbox[cid] || [];
    for (var i = l.length - 1; i >= 0; i--) if (l[i].t === (type || 'state')) return l[i];
    return null;
  }
  var room = new Room({ code: 'ABCDE', now: function () { return t.now; }, send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); } });
  room.hello('A', { name: 'Alice', role: 'player', color: 'w' });
  room.handle('A', { t: 'chat', text: 'Bonjour !' });                      // avant l'arrivée de l'adversaire
  room.hello('B', { name: 'Bob', role: 'player' });
  room.hello('S', { name: 'Sam', role: 'spectator' });
  room.handle('S', { t: 'chat', text: 'Bonne partie' });
  room.handle('B', { t: 'chat', text: '<b>salut</b>' });
  var s = last('B').state;
  assert.deepStrictEqual(s.chat.map(function (m) { return [m.n, m.c, m.x, m.me]; }), [
    ['Alice', 'w', 'Bonjour !', false], ['Sam', null, 'Bonne partie', false], ['Bob', 'b', '<b>salut</b>', true]
  ]);
  room.handle('B', { t: 'chat', text: '' });
  assert.strictEqual(last('B', 'error').message, 'Message vide');
  room.handle('A', { t: 'resign' });
  room.handle('A', { t: 'chat', text: 'gg' });                             // partie terminée : on peut encore écrire
  assert.strictEqual(last('S').state.chat.length, 4);
  // Bascule : Bob devient l'hôte à partir de son dernier état
  var r2 = new Room({ code: 'ABCDE', cid: 'B', restore: { state: last('B').state }, send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); } });
  r2.hello('B', { name: 'Bob', role: 'player', color: 'b' });
  r2.handle('B', { t: 'chat', text: 'encore là' });
  var c = last('B').state.chat;
  assert.strictEqual(c.length, 5);
  assert.strictEqual(c[2].me, true);                                        // ses anciens messages restent les siens
  assert.strictEqual(c[4].id, 5);                                           // numérotation continue
})();

// --- Salle à plusieurs
(function () {
  var inbox = {};
  function st(cid) { var l = inbox[cid]; for (var i = l.length - 1; i >= 0; i--) if (l[i].t === 'state') return l[i].state; return null; }
  var room = new MultiRoom({ code: 'XYZ', variant: 'yalta', send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); } });
  room.hello('A', { name: 'Alice', role: 'player' });
  room.hello('S', { name: 'Sam', role: 'spectator' });
  room.handle('A', { t: 'chat', text: 'On attend Carl' });
  room.handle('S', { t: 'chat', text: 'Je regarde' });
  var c = st('A').chat;
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].c, 0);
  assert.strictEqual(c[0].me, true);
  assert.strictEqual(c[1].c, null);
})();

console.log('chat.test.js : OK');
