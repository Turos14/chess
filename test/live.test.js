var assert = require('assert');
var Chess = require('../public/js/chess.js');
var MultiChess = require('../public/js/multichess.js');
var Room = require('../public/js/room.js');
var MultiRoom = require('../public/js/multiroom.js');
var L = require('../public/js/livedata.js');

// Validateur identique aux règles du §1 du contrat (serveur : relais/lib/live.js)
var UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/, MULTI = /^(?:0|[1-9]\d{0,2})-(?:0|[1-9]\d{0,2})[qrbn]?$/, RES = /^r[0-3]$/;
function validTwo(b) {
  assert.strictEqual(b.v, 1);
  assert(L.GID_RE.test(b.gid), b.gid);
  assert(['local', 'ai', 'online'].indexOf(b.m) >= 0);
  assert(['classic', '960'].indexOf(b['var']) >= 0);
  b.mv.forEach(function (s) { assert(UCI.test(s), s); });
  if (b.sf !== undefined) assert(/^[A-Za-z0-9\/ \-]{10,100}$/.test(b.sf));
  if (b.tc) { assert.strictEqual(b.tc.length, 2); assert(b.tc[0] >= 0 && b.tc[1] >= 0); }
  if (b.end) { assert(L.REASONS.indexOf(b.end.r) >= 0); if (b.end.r !== 'quit') assert(['w', 'b', 'd'].indexOf(b.end.w) >= 0); }
}
function validMulti(b) {
  assert.strictEqual(b.v, 1);
  assert(L.GID_RE.test(b.gid));
  assert(['multi_local', 'multi_online'].indexOf(b.m) >= 0);
  assert(['yalta', 'cross4'].indexOf(b['var']) >= 0);
  b.mv.forEach(function (s) { assert(MULTI.test(s) || RES.test(s), s); });
  if (b.end && b.end.r !== 'quit') assert(Array.isArray(b.end.w));
}

// --- gid
(function () {
  var a = L.newGid(), b = L.newGid();
  assert(L.GID_RE.test(a) && L.GID_RE.test(b));
  assert.notStrictEqual(a, b);
})();

// --- Parties à deux : coups UCI, promotion, fin, quit, pendule, 960
(function () {
  var g = new Chess.Game();
  g.move('e2', 'e4'); g.move('e7', 'e5'); g.move('g1', 'f3');
  var b = L.buildTwo({ gid: 'k3j9x0a7q2mz', mode: 'local', variant: 'classic', history: g.history, tc: { base: 600000, inc: 0 } });
  validTwo(b);
  assert.deepStrictEqual(b.mv, ['e2e4', 'e7e5', 'g1f3']);
  assert.deepStrictEqual(b.tc, [600000, 0]);
  assert.strictEqual(b.end, undefined);
  assert.strictEqual(b.sf, undefined);
  assert.deepStrictEqual(Object.keys(b).sort(), ['gid', 'm', 'mv', 'tc', 'v', 'var']);

  // Mat du berger
  var m = new Chess.Game();
  ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].forEach(function (s) { assert(m.move(s.slice(0, 2), s.slice(2, 4))); });
  var st = m.status();
  assert(st.over);
  var e = L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'ai', variant: 'classic', history: m.history, result: st });
  validTwo(e);
  assert.deepStrictEqual(e.end, { r: 'checkmate', w: 'w' });
  assert.strictEqual(e.m, 'ai');

  // Nulle
  assert.deepStrictEqual(L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', history: [], result: { reason: 'agreement', winner: null } }).end, { r: 'agreement', w: 'd' });
  // Abandon
  assert.deepStrictEqual(L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'online', history: [], result: { reason: 'resign', winner: 'b' } }).end, { r: 'resign', w: 'b' });
  // Quitté
  var q = L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', history: g.history, quit: true });
  validTwo(q);
  assert.deepStrictEqual(q.end, { r: 'quit' });
  // Raison inconnue : pas de fin
  assert.strictEqual(L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', history: [], result: { reason: 'xx', winner: 'w' } }).end, undefined);

  // Promotion
  var p = new Chess.Game('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert(p.move('a7', 'a8', 'n'));
  var pb = L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', history: p.history });
  validTwo(pb);
  assert.deepStrictEqual(pb.mv, ['a7a8n']);

  // Fischer 960 : position de départ
  var s960 = Chess.start960();
  var g9 = new Chess.Game(s960);
  var b9 = L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', variant: '960', startFen: g9.startFen, history: g9.history });
  validTwo(b9);
  assert.strictEqual(b9['var'], '960');
  assert.strictEqual(b9.sf, g9.startFen);
  // Mode invalide / gid invalide / trop de coups
  assert.strictEqual(L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'spectator', history: [] }), null);
  assert.strictEqual(L.buildTwo({ gid: 'AB', mode: 'local', history: [] }), null);
  var many = []; for (var i = 0; i < 701; i++) many.push({ from: 'e2', to: 'e4' });
  assert.strictEqual(L.buildTwo({ gid: 'aaaaaaaaaa', mode: 'local', history: many }), null);
  // Arrêt
  assert.deepStrictEqual(L.buildStop('aaaaaaaaaa'), { v: 1, gid: 'aaaaaaaaaa', stop: true });
  assert.strictEqual(L.buildStop('x'), null);
})();

// --- Parties à plusieurs
(function () {
  var g = new MultiChess.Game('yalta');
  var moves = g.legalMoves(g.turn), mv = moves[0];
  assert(g.move(mv.from, mv.to, null));
  var mv2 = g.legalMoves(g.turn)[0];
  assert(g.move(mv2.from, mv2.to, null));
  assert(g.resign(g.turn));
  var b = L.buildMulti({ gid: 'bbbbbbbbbbbb', mode: 'local', variant: 'yalta', history: g.history, over: g.over, winners: g.winners });
  validMulti(b);
  assert.strictEqual(b.m, 'multi_local');
  assert.strictEqual(b.mv.length, 3);
  assert.strictEqual(b.mv[0], mv.from + '-' + mv.to);
  assert(/^r[0-2]$/.test(b.mv[2]));
  assert.strictEqual(b.end, undefined);
  assert.strictEqual(b.teams, undefined);

  var f = L.buildMulti({ gid: 'bbbbbbbbbbbb', mode: 'online', variant: 'cross4', teams: true, history: [{ from: 12, to: 34, promo: 'Q' }, { resign: 2 }], over: true, winners: [0, 2] });
  validMulti(f);
  assert.deepStrictEqual(f.mv, ['12-34q', 'r2']);
  assert.strictEqual(f.teams, true);
  assert.deepStrictEqual(f.end, { r: 'multi', w: [0, 2] });
  assert.deepStrictEqual(L.buildMulti({ gid: 'bbbbbbbbbbbb', mode: 'local', variant: 'yalta', history: [], over: true, winners: [] }).end, { r: 'multi', w: [] });
  assert.deepStrictEqual(L.buildMulti({ gid: 'bbbbbbbbbbbb', mode: 'local', variant: 'yalta', history: [], quit: true }).end, { r: 'quit' });
  assert.strictEqual(L.buildMulti({ gid: 'bbbbbbbbbbbb', mode: 'local', variant: 'classic', history: [] }), null);
})();

// --- Aucun nom dans le corps
(function () {
  var names = ['Zébulon-Dupont', 'Xanthippe42', 'MrOrchidee', 'Roxane_Lefevre'];
  var g = new Chess.Game();
  g.move('e2', 'e4'); g.move('e7', 'e5');
  var room = new Room({ code: 'QZXWV', send: function () {}, now: function () { return 1; } });
  room.hello('c1', { name: names[0], role: 'player', color: 'w', share: true });
  room.hello('c2', { name: names[1], role: 'player', share: true });
  var body = JSON.stringify(L.buildTwo({ gid: room.gid, mode: 'online', variant: 'classic', history: g.history, tc: { base: 1000, inc: 0 }, result: { reason: 'resign', winner: 'w' } }));
  var mr = new MultiRoom({ code: 'MZXWV', variant: 'yalta', send: function () {}, now: function () { return 1; } });
  for (var i = 0; i < 3; i++) mr.hello('m' + i, { name: i < 2 ? names[i + 2] : 'Zed', role: 'player', share: true });
  var mb = JSON.stringify(L.buildMulti({ gid: mr.gid, mode: 'online', variant: 'yalta', history: mr.game.history, over: false }));
  var all = body + mb + JSON.stringify(L.buildStop(room.gid));
  names.concat(['QZXWV', 'MZXWV', 'c1', 'c2', 'Zed']).forEach(function (n) {
    assert(all.toLowerCase().indexOf(n.toLowerCase()) < 0, 'fuite : ' + n);
  });
  // seuls les champs du contrat
  var allowed = ['v', 'gid', 'm', 'var', 'sf', 'teams', 'mv', 'tc', 'end', 'stop'];
  Object.keys(JSON.parse(body)).concat(Object.keys(JSON.parse(mb))).forEach(function (k) { assert(allowed.indexOf(k) >= 0, k); });
})();

// --- Salle à deux : gid, live, share
function mkRoom(opts) {
  var inbox = {};
  var room = new Room({ code: 'ABCDE', restore: opts && opts.restore, now: function () { return 1000; },
    send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); } });
  function st(cid) { var l = inbox[cid]; for (var i = l.length - 1; i >= 0; i--) if (l[i].t === 'state') return l[i].state; return null; }
  return { room: room, st: st };
}
(function () {
  var x = mkRoom();
  assert(L.GID_RE.test(x.room.gid));
  x.room.hello('A', { name: 'Alice', role: 'player', color: 'w', share: true });
  assert.strictEqual(x.st('A').live, false);                                   // un seul siège occupé
  x.room.hello('B', { name: 'Bob', role: 'player', share: false });
  assert.strictEqual(x.st('A').live, false);                                   // Bob refuse
  x.room.hello('B', { name: 'Bob', role: 'player', share: true });
  var s = x.st('A');
  assert.strictEqual(s.live, true);
  assert.strictEqual(s.gid, x.room.gid);
  assert.strictEqual(x.st('B').gid, s.gid);
  // reconnexion sans `share` : conservé
  x.room.hello('B', { name: 'Bob', role: 'player' });
  assert.strictEqual(x.st('A').live, true);
  // un vieux client (jamais de share)
  var y = mkRoom();
  y.room.hello('A', { name: 'Alice', role: 'player', color: 'w', share: true });
  y.room.hello('B', { name: 'Bob', role: 'player' });
  assert.strictEqual(y.st('A').live, false);
  // spectateur : pas besoin d'accepter, ne change pas live
  x.room.hello('S', { name: 'Spec', role: 'spectator' });
  assert.strictEqual(x.st('A').live, true);
  // l'état ne contient pas d'autre chose que des booléens pour les consentements
  assert.deepStrictEqual(x.st('A').shares, { w: true, b: true });

  // bascule d'hôte : gid stable, consentements repris
  x.room.handle('A', { t: 'move', from: 'e2', to: 'e4' });
  var saved = x.st('B');
  var z = mkRoom({ restore: { state: JSON.parse(JSON.stringify(saved)) } });
  assert.strictEqual(z.room.gid, saved.gid);
  z.room.hello('A', { name: 'Alice', role: 'player', color: 'w' });             // le nouvel hôte ne renvoie pas share
  z.room.hello('B', { name: 'Bob', role: 'player', color: 'b' });
  assert.strictEqual(z.st('A').gid, saved.gid);
  assert.strictEqual(z.st('A').live, true);
  // l'un se reconnecte en refusant
  z.room.hello('B', { name: 'Bob', role: 'player', color: 'b', share: false });
  assert.strictEqual(z.st('A').live, false);
  // restauration d'un état ancien (sans gid / shares) : nouveau gid, pas de direct
  var old = JSON.parse(JSON.stringify(saved)); delete old.gid; delete old.shares; delete old.live;
  var o = mkRoom({ restore: { state: old } });
  assert(L.GID_RE.test(o.room.gid));
  o.room.hello('A', { name: 'Alice', role: 'player', color: 'w' });
  o.room.hello('B', { name: 'Bob', role: 'player', color: 'b' });
  assert.strictEqual(o.st('A').live, false);
})();

// --- Salle à plusieurs
function mkMulti(opts) {
  var inbox = {};
  var room = new MultiRoom({ code: 'ABCDE', variant: 'yalta', restore: opts && opts.restore, now: function () { return 1000; },
    send: function (cid, msg) { (inbox[cid] = inbox[cid] || []).push(msg); } });
  function st(cid) { var l = inbox[cid]; for (var i = l.length - 1; i >= 0; i--) if (l[i].t === 'state') return l[i].state; return null; }
  return { room: room, st: st };
}
(function () {
  var x = mkMulti();
  assert(L.GID_RE.test(x.room.gid));
  x.room.hello('A', { name: 'A', role: 'player', share: true });
  x.room.hello('B', { name: 'B', role: 'player', share: true });
  assert.strictEqual(x.st('A').live, false);                                   // siège vide
  x.room.hello('C', { name: 'C', role: 'player', share: false });
  assert.strictEqual(x.st('A').live, false);
  x.room.hello('C', { name: 'C', role: 'player', share: true });
  var s = x.st('A');
  assert.strictEqual(s.live, true);
  assert.strictEqual(s.gid, x.room.gid);
  assert.strictEqual(x.st('C').gid, s.gid);
  // reconnexion sans share : conservé (siège 0 compris)
  x.room.hello('A', { name: 'A', role: 'player' });
  assert.strictEqual(x.st('A').live, true);
  x.room.hello('Z', { name: 'Spec', role: 'spectator' });
  assert.strictEqual(x.st('A').live, true);
  assert.deepStrictEqual(x.st('A').shares, [true, true, true]);
  // bascule d'hôte
  var saved = JSON.parse(JSON.stringify(x.st('B')));
  var z = mkMulti({ restore: { state: saved } });
  assert.strictEqual(z.room.gid, saved.gid);
  z.room.hello('A', { name: 'A', role: 'player', color: 0 });
  z.room.hello('B', { name: 'B', role: 'player', color: 1 });
  z.room.hello('C', { name: 'C', role: 'player', color: 2 });
  assert.strictEqual(z.st('A').gid, saved.gid);
  assert.strictEqual(z.st('A').live, true);
  z.room.hello('C', { name: 'C', role: 'player', color: 2, share: false });
  assert.strictEqual(z.st('A').live, false);
  // vieil état
  var old = JSON.parse(JSON.stringify(saved)); delete old.gid; delete old.shares; delete old.live;
  var o = mkMulti({ restore: { state: old } });
  assert(L.GID_RE.test(o.room.gid));
  ['A', 'B', 'C'].forEach(function (c, i) { o.room.hello(c, { name: c, role: 'player', color: i }); });
  assert.strictEqual(o.st('A').live, false);
})();

console.log('live.test.js : OK');
