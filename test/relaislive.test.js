// Parties en direct du relais : validation (relais/lib/live.js), POST /api/live et lecture admin (?a=live).
var assert = require('assert');
var live = require('../relais/lib/live.js');
var liveApi = require('../relais/api/live.js');
var adminApi = require('../relais/api/admin.js');
var adminLib = require('../relais/lib/admin.js');
var limit = require('../relais/lib/limit.js');

var GID = 'k3j9x0a7q2mz';
function two(extra) { var o = { v: 1, gid: GID, m: 'local', 'var': 'classic', mv: ['e2e4', 'e7e5', 'g1f3'], tc: [600000, 0] }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }
function multi(extra) { var o = { v: 1, gid: GID, m: 'multi_local', 'var': 'yalta', mv: ['12-34', '90-100q', 'r2'] }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }

// --- Validation ---
var p = live.parse(two());
assert(!p.error); assert.strictEqual(p.gid, GID);
assert.deepStrictEqual(p.game, { m: 'local', 'var': 'classic', mv: ['e2e4', 'e7e5', 'g1f3'], tc: [600000, 0] });
// Champs inconnus ignorés (jamais conservés), y compris noms et joueurs.
p = live.parse(two({ name: 'Zoé', players: ['A', 'B'], room: 'ABCD', chat: 'salut', ip: '1.2.3.4' }));
assert.deepStrictEqual(Object.keys(p.game).sort(), ['m', 'mv', 'tc', 'var']);
assert(!/Zoé|ABCD|salut/.test(JSON.stringify(p)));
// Corps invalides.
[null, 'x', [], {}, two({ v: 2 }), two({ gid: 'court' }), two({ gid: 'ABCDEFGHIJKLM' }), two({ gid: 'a'.repeat(21) }), two({ gid: 5 }),
  two({ m: 'spectator' }), two({ m: undefined }), two({ 'var': 'yalta' }), two({ 'var': 'nimporte' }), two({ mv: 'e2e4' }), two({ mv: undefined }),
  multi({ 'var': 'classic' }), multi({ 'var': '960' }), multi({ m: 'multi_online', 'var': 'classic' })
].forEach(function (b) { assert(live.parse(b).error, JSON.stringify(b)); });
// Coups à deux : UCI minuscule, promotion q r b n.
assert(!live.parse(two({ mv: ['e7e8q', 'a2a1n'] })).error);
['E2E4', 'e2e', 'e2e9', 'i2e4', 'e2e4k', 'e2e4qq', 'e2-e4', 'r2', '12-34', 5, null, ''].forEach(function (m) { assert(live.parse(two({ mv: [m] })).error, String(m)); });
// Coups à plusieurs : « de-vers », promotion facultative, abandon « r<camp> ».
p = live.parse(multi());
assert(!p.error); assert.deepStrictEqual(p.game.mv, ['12-34', '90-100q', 'r2']);
assert(!live.parse(multi({ mv: ['0-999', '5-6r', 'r0', 'r3'] })).error);
['1234', '12-', '-34', '12-1000', '1000-5', '012-34', '12-34k', '12-34Q', 'r4', 'r', 'r12', 'e2e4', '12--34', '1.5-3', 'r-1'].forEach(function (m) { assert(live.parse(multi({ mv: [m] })).error, m); });
// Tailles.
var many = []; for (var i = 0; i < 700; i++) many.push('e2e4');
assert(!live.parse(two({ mv: many })).error);
many.push('e2e4'); assert(live.parse(two({ mv: many })).error);
assert(!live.parse(two({ mv: [] })).error);
// Pendule.
assert(!live.parse(two({ tc: [36000000, 300000] })).error);
[[1], [1, 2, 3], [-1, 0], [36000001, 0], [0, 300001], [1.5, 0], ['1', 0], 'x', {}].forEach(function (tc) { assert(live.parse(two({ tc: tc })).error, JSON.stringify(tc)); });
assert(!('tc' in live.parse(two({ tc: undefined })).game));
assert(!('tc' in live.parse(multi({ tc: [600000, 0] })).game));   // pas de pendule en parties à plusieurs : ignorée
// 960 + position de départ.
var fen = 'bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1';
p = live.parse(two({ 'var': '960', sf: fen })); assert(!p.error); assert.strictEqual(p.game.sf, fen);
assert(!('sf' in live.parse(two({ sf: fen })).game));   // hors 960 : ignorée
assert(!('sf' in live.parse(two({ 'var': '960' })).game));
['court', 'x'.repeat(101), 'bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w <script>', 42].forEach(function (sf) { assert(live.parse(two({ 'var': '960', sf: sf })).error, String(sf)); });
// teams (cross4 seulement, booléen).
assert.strictEqual(live.parse(multi({ 'var': 'cross4', teams: true })).game.teams, true);
assert.strictEqual(live.parse(multi({ 'var': 'cross4', teams: false })).game.teams, false);
assert(live.parse(multi({ 'var': 'cross4', teams: 'oui' })).error);
assert(!('teams' in live.parse(multi({ teams: true })).game));
// Fin à deux.
['w', 'b', 'd'].forEach(function (w) { assert.deepStrictEqual(live.parse(two({ end: { r: 'checkmate', w: w, nom: 'X' } })).game.end, { r: 'checkmate', w: w }); });
live.REASONS.forEach(function (r) { assert(!live.parse(two({ end: { r: r, w: 'd' } })).error, r); });
assert.deepStrictEqual(live.parse(two({ end: { r: 'quit' } })).game.end, { r: 'quit' });
['x', ['w'], 1, null, undefined].forEach(function (w) { assert(live.parse(two({ end: { r: 'resign', w: w } })).error, String(w)); });
[{ r: 'abandon', w: 'w' }, { w: 'w' }, 'fin', [], null].forEach(function (e) { assert(live.parse(two({ end: e })).error, JSON.stringify(e)); });
// Fin à plusieurs.
assert.deepStrictEqual(live.parse(multi({ end: { r: 'multi', w: [1] } })).game.end, { r: 'multi', w: [1] });
assert.deepStrictEqual(live.parse(multi({ end: { r: 'multi', w: [] } })).game.end, { r: 'multi', w: [] });
assert.deepStrictEqual(live.parse(multi({ end: { r: 'multi', w: [0, 2, 3, 1] } })).game.end, { r: 'multi', w: [0, 2, 3, 1] });
assert.deepStrictEqual(live.parse(multi({ end: { r: 'quit' } })).game.end, { r: 'quit' });
[[4], [-1], [1.5], [0, 1, 2, 3, 0], [1, 1], ['1'], 'w', 1].forEach(function (w) { assert(live.parse(multi({ end: { r: 'multi', w: w } })).error, JSON.stringify(w)); });
// stop : seuls v, gid, stop requis ; le reste est ignoré (même invalide).
assert.deepStrictEqual(live.parse({ v: 1, gid: GID, stop: true }), { gid: GID, stop: true });
assert.deepStrictEqual(live.parse({ v: 1, gid: GID, stop: true, m: 'nimporte', mv: 5 }), { gid: GID, stop: true });
assert(live.parse({ v: 1, stop: true }).error);
assert(live.parse({ v: 1, gid: GID, stop: 'oui' }).error);   // stop non booléen : corps normal, donc invalide

// Commandes Redis.
var cmds = live.commands(live.parse(two()), 1000);
assert.strictEqual(cmds[0][0], 'SET'); assert.strictEqual(cmds[0][1], 'live:' + GID);
assert.deepStrictEqual(cmds[0].slice(3), ['EX', 900]);
assert.deepStrictEqual(JSON.parse(cmds[0][2]), { m: 'local', 'var': 'classic', mv: ['e2e4', 'e7e5', 'g1f3'], tc: [600000, 0], at: 1000 });
assert.deepStrictEqual(cmds[1], ['SET', 'live:st:' + GID, '1000', 'NX', 'EX', 86400]);
assert.deepStrictEqual(cmds[2], ['ZADD', 'live:idx', 1000, GID]);
assert.deepStrictEqual(live.commands(live.parse(two({ end: { r: 'resign', w: 'b' } })), 1)[0].slice(3), ['EX', 3600]);
assert.deepStrictEqual(live.commands({ gid: GID, stop: true }, 5), [['DEL', 'live:' + GID, 'live:st:' + GID], ['ZREM', 'live:idx', GID]]);

// --- Faux Redis : SET (EX, NX), DEL, ZADD, ZREM, ZREMRANGEBYSCORE, ZREVRANGEBYSCORE, MGET ; horloge pilotée ---
var clock = Date.UTC(2026, 10, 18, 10);
function fakeStore() {
  var kv = {}, idx = {}, calls = [];
  function alive(k) { var e = kv[k]; if (e && e.exp !== null && e.exp <= clock) { delete kv[k]; e = null; } return e; }
  return {
    kv: kv, idx: idx, calls: calls,
    pipeline: function (cmds) {
      calls.push(cmds);
      return Promise.resolve(cmds.map(function (c) {
        var i;
        switch (c[0]) {
          case 'SET': {
            var nx = c.indexOf('NX') >= 0, ex = c.indexOf('EX') >= 0 ? c[c.indexOf('EX') + 1] : null;
            if (nx && alive(c[1])) return null;
            kv[c[1]] = { v: c[2], exp: ex === null ? null : clock + ex * 1000 };
            return 'OK';
          }
          case 'DEL': var n = 0; for (i = 1; i < c.length; i++) if (kv[c[i]]) { delete kv[c[i]]; n++; } return n;
          case 'ZADD': idx[c[3]] = c[2]; return 1;
          case 'ZREM': delete idx[c[2]]; return 1;
          case 'ZREMRANGEBYSCORE': Object.keys(idx).forEach(function (g) { if (idx[g] <= c[3]) delete idx[g]; }); return 0;
          case 'ZREVRANGEBYSCORE': return Object.keys(idx).sort(function (a, b) { return idx[b] - idx[a]; }).slice(c[5], c[5] + c[6]);
          case 'MGET': return c.slice(1).map(function (k) { var e = alive(k); return e ? e.v : null; });
          case 'LPUSH': (kv[c[1]] = kv[c[1]] || { v: [], exp: null }).v.unshift(c[2]); return 1;
          case 'LTRIM': kv[c[1]].v = kv[c[1]].v.slice(c[2], c[3] + 1); return 'OK';
          default: throw new Error('commande inconnue ' + c[0]);
        }
      }));
    }
  };
}
function run(h, req) {
  return new Promise(function (resolve) {
    var headers = {};
    var res = { statusCode: 200, setHeader: function (k, v) { headers[k] = v; }, end: function (s) { resolve({ status: this.statusCode, json: s ? JSON.parse(s) : null, headers: headers }); } };
    h(req, res);
  });
}
var ORIGIN = 'https://turos14.github.io';
function post(h, body, extra) {
  var headers = { origin: ORIGIN, 'x-forwarded-for': '9.9.9.9, 10.0.0.1' };
  Object.keys(extra || {}).forEach(function (k) { headers[k] = extra[k]; });
  return run(h, { method: 'POST', url: '/api/live', headers: headers, body: body });
}
function gidN(n) { return 'partie' + ('0000' + n).slice(-4) + 'abcd'; }

// --- Admin ---
var ENV = { ADMIN_PASSWORD: 'mot-de-passe-tres-long' };
function adminGet(h, cookie) { return run(h, { method: 'GET', url: '/api/admin?a=live', headers: { host: 'chess-relais.vercel.app', cookie: cookie || '' } }); }

(async function () {
  var st = fakeStore(), r;
  var h = liveApi.create({ env: {}, store: st, now: function () { return clock; } });
  // Chaîne text/plain et objet.
  r = await post(h, JSON.stringify(two({ name: 'Zoé', players: ['Ana'] })));
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers['Access-Control-Allow-Origin'], ORIGIN);
  assert.strictEqual(st.calls.length, 1);
  assert.strictEqual(st.kv['live:' + GID].exp, clock + 900 * 1000);   // EX 900 en cours
  assert(st.kv['live:st:' + GID]);
  assert.strictEqual(st.idx[GID], clock);
  // Rien d'autre que les champs du contrat n'atteint Redis ; pas d'IP.
  var sent = JSON.stringify(st.calls);
  assert(!/Zoé|Ana|name|players|9\.9\.9\.9/.test(sent), sent);
  // Mise à jour : début conservé (NX), fin -> EX 3600.
  var t0 = clock; clock += 60000;
  r = await post(h, two({ mv: ['e2e4'], end: { r: 'checkmate', w: 'w' } }));
  assert.strictEqual(r.status, 204);
  assert.strictEqual(st.kv['live:st:' + GID].v, String(t0));
  assert.strictEqual(st.kv['live:' + GID].exp, clock + 3600 * 1000);
  assert.strictEqual(JSON.parse(st.kv['live:' + GID].v).end.r, 'checkmate');
  assert.strictEqual(st.idx[GID], clock);
  // stop supprime tout.
  r = await post(h, JSON.stringify({ v: 1, gid: GID, stop: true }));
  assert.strictEqual(r.status, 204);
  assert(!st.kv['live:' + GID] && !st.kv['live:st:' + GID] && !(GID in st.idx));
  // Origine absente / étrangère -> 403, méthode, pré-vol, corps invalides.
  var n = st.calls.length;
  r = await run(h, { method: 'POST', url: '/api/live', headers: {}, body: two() }); assert.strictEqual(r.status, 403);
  r = await post(h, two(), { origin: 'https://evil.example' }); assert.strictEqual(r.status, 403);
  assert.strictEqual(st.calls.length, n);
  r = await run(h, { method: 'OPTIONS', url: '/api/live', headers: { origin: ORIGIN } }); assert.strictEqual(r.status, 204);
  r = await run(h, { method: 'GET', url: '/api/live', headers: { origin: ORIGIN } }); assert.strictEqual(r.status, 405);
  assert.strictEqual((await post(h, 'pas du json')).status, 400);
  assert.strictEqual((await post(h, two({ mv: ['zz'] }))).status, 400);
  assert.strictEqual((await post(h, 'x'.repeat(16001))).status, 400);
  assert.strictEqual(st.calls.length, n);
  // Redis en panne : 204 quand même.
  var bad = liveApi.create({ env: {}, store: { pipeline: function () { return Promise.reject(new Error('boum')); } }, now: function () { return clock; } });
  var errLog = console.error; console.error = function () {};
  assert.strictEqual((await post(bad, two())).status, 204);
  console.error = errLog;
  // Sans Redis : 204, rien stocké.
  var logLog = console.log; console.log = function () {};
  var h0 = liveApi.create({ env: {}, store: null, now: function () { return clock; } });
  assert.strictEqual((await post(h0, two())).status, 204);
  console.log = logLog;

  // Limite : 120 / 10 min par IP, puis 429 (type live).
  var hl = liveApi.create({ env: {}, store: fakeStore(), now: function () { return clock; }, memory: limit.createMemory() });
  for (i = 0; i < 120; i++) assert.strictEqual((await post(hl, two())).status, 204, 'requête ' + i);
  assert.strictEqual((await post(hl, two())).status, 429);
  assert.strictEqual((await post(hl, two(), { 'x-forwarded-for': '8.8.8.8' })).status, 204);   // une autre IP passe
  // Plafond global par jour.
  var hd = liveApi.create({ env: { LIVE_MAX_PER_DAY: '3' }, store: fakeStore(), now: function () { return clock; }, memory: limit.createMemory() });
  for (i = 0; i < 3; i++) assert.strictEqual((await post(hd, two(), { 'x-forwarded-for': '7.7.7.' + i })).status, 204);
  assert.strictEqual((await post(hd, two(), { 'x-forwarded-for': '7.7.7.9' })).status, 429);

  // --- Lecture admin ---
  var st2 = fakeStore();
  var hp = liveApi.create({ env: {}, store: st2, now: function () { return clock; } });
  var ha = adminApi.create({ env: ENV, store: st2, now: function () { return clock; } });
  var cookie = 'admin_session=' + adminLib.signSession(ENV, clock);
  assert.strictEqual((await adminGet(ha)).status, 401);   // session obligatoire
  assert.strictEqual((await adminGet(ha, 'admin_session=faux')).status, 401);
  assert.strictEqual(st2.calls.length, 0);
  assert.strictEqual((await run(ha, { method: 'POST', url: '/api/admin?a=live', headers: { host: 'x', 'x-admin': '1' } })).status, 405);

  var base = clock;
  await post(hp, two({ gid: 'ancienne0001', mv: ['e2e4'] }));            // t0
  clock = base + 10 * 60000;
  await post(hp, multi({ gid: 'multi0000001', 'var': 'cross4', teams: true, end: { r: 'multi', w: [0, 2] } }));
  clock = base + 12 * 60000;
  await post(hp, two({ gid: 'recente00001' }));
  clock = base + 14 * 60000;
  await post(hp, two({ gid: 'ancienne0001', mv: ['e2e4', 'e7e5'] }));    // mise à jour : début conservé
  r = await adminGet(ha, cookie);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true); assert.strictEqual(r.json.now, clock);
  assert.deepStrictEqual(r.json.games.map(function (g) { return g.gid; }), ['ancienne0001', 'recente00001', 'multi0000001']);   // updatedAt décroissant
  var g0 = r.json.games[0];
  assert.deepStrictEqual(g0, { gid: 'ancienne0001', m: 'local', 'var': 'classic', mv: ['e2e4', 'e7e5'], tc: [600000, 0], startedAt: base, updatedAt: clock });
  var g2 = r.json.games[2];
  assert.deepStrictEqual(g2, { gid: 'multi0000001', m: 'multi_local', 'var': 'cross4', teams: true, mv: ['12-34', '90-100q', 'r2'], end: { r: 'multi', w: [0, 2] }, startedAt: base + 10 * 60000, updatedAt: base + 10 * 60000 });
  assert(!/at"|name|players/.test(JSON.stringify(r.json.games[0])));
  // Journal : live_view une fois, pas deux dans la minute, de nouveau ensuite.
  function views() { return (st2.kv['admin:log'] ? st2.kv['admin:log'].v : []).filter(function (s) { return JSON.parse(s).action === 'live_view'; }).length; }
  assert.strictEqual(views(), 1);
  assert(!/9\.9\.9\.9|ip/i.test(st2.kv['admin:log'].v.join('')));
  await adminGet(ha, cookie); assert.strictEqual(views(), 1);
  clock += 30000; await adminGet(ha, cookie); assert.strictEqual(views(), 1);
  clock += 31000; await adminGet(ha, cookie); assert.strictEqual(views(), 2);

  // Péremption : en cours > 15 min omise (même si la clé existait encore), terminée > 1 h omise.
  var st3 = fakeStore(), ha3 = adminApi.create({ env: ENV, store: st3, now: function () { return clock; } });
  var hp3 = liveApi.create({ env: {}, store: st3, now: function () { return clock; } });
  await post(hp3, two({ gid: 'enjeu0000001' }));
  await post(hp3, two({ gid: 'finie0000001', end: { r: 'timeout', w: 'b' } }));
  var cookie3 = 'admin_session=' + adminLib.signSession(ENV, clock);
  clock += 15 * 60000 + 1;
  st3.kv['live:enjeu0000001'].exp = null;   // simule une clé qui n'aurait pas expiré : filtrage fait aussi à la lecture
  r = await adminGet(ha3, cookie3);
  assert.deepStrictEqual(r.json.games.map(function (g) { return g.gid; }), ['finie0000001']);
  clock += 60 * 60000;
  st3.kv['live:finie0000001'] && (st3.kv['live:finie0000001'].exp = null);
  r = await adminGet(ha3, cookie3);
  assert.deepStrictEqual(r.json.games, []);
  assert(!('live' in {}) && !(('enjeu0000001') in st3.idx));   // l'index est purgé à la lecture (> 1 h)

  // Plafond de 200 parties, les plus récentes.
  var st4 = fakeStore(), ha4 = adminApi.create({ env: ENV, store: st4, now: function () { return clock; } });
  var hp4 = liveApi.create({ env: {}, store: st4, now: function () { return clock; }, memory: { hit: function () { return true; } } });
  var t4 = clock;
  for (i = 0; i < 230; i++) { clock = t4 + i * 1000; await post(hp4, two({ gid: gidN(i), mv: [] })); }
  clock = t4 + 230 * 1000;
  r = await adminGet(ha4, 'admin_session=' + adminLib.signSession(ENV, clock));
  assert.strictEqual(r.json.games.length, 200);
  assert.strictEqual(r.json.games[0].gid, gidN(229)); assert.strictEqual(r.json.games[199].gid, gidN(30));
  // Sans Redis : liste vide, journal en mémoire.
  var ha5 = adminApi.create({ env: ENV, store: null, now: function () { return clock; } });
  r = await adminGet(ha5, 'admin_session=' + adminLib.signSession(ENV, clock));
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.games, []);

  console.log('relais live OK');
})().catch(function (e) { console.error(e); process.exit(1); });
