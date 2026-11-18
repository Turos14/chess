// Statistiques anonymes du relais : validation (relais/lib/stats.js) et point d'entrée POST /api/stats.
var assert = require('assert');
var stats = require('../relais/lib/stats.js');
var statsApi = require('../relais/api/stats.js');

// --- Validation et champs ---
var ok = stats.parse({ v: 1, ver: 36, b: 'chrome', o: 'windows', pwa: false, events: [
  { e: 'game_start', m: 'local', 'var': 'classic' }, { e: 'app_open' }, { e: 'app_open' }
] });
assert(!ok.error);
assert.deepStrictEqual(ok.fields, {
  'e=game_start': 1, 'e=game_start|m=local': 1, 'e=game_start|var=classic': 1,
  'e=app_open': 2, 'e=app_open|b=chrome': 2, 'e=app_open|o=windows': 2, 'e=app_open|pwa=0': 2, 'e=app_open|ver=36': 2
});
// game_start ne compte pas navigateur/système ; online_ok / online_error oui, mais ni pwa ni ver.
var on = stats.parse({ v: 1, ver: 5, b: 'safari', o: 'ios', pwa: true, events: [{ e: 'online_ok', role: 'host', g: 'duo' }, { e: 'online_error', k: 'webrtc', ph: 'game', g: 'multi' }] });
assert.strictEqual(on.fields['e=online_ok|b=safari'], 1);
assert.strictEqual(on.fields['e=online_error|o=ios'], 1);
assert.strictEqual(on.fields['e=online_ok|role=host'], 1);
assert.strictEqual(on.fields['e=online_error|ph=game'], 1);
assert(!('e=online_ok|pwa=1' in on.fields) && !('e=online_ok|ver=5' in on.fields));
// Valeurs et événements inconnus ignorés, les autres comptés ; propriétés non listées jamais lues.
var junk = stats.parse({ v: 1, ver: 0, b: 'netscape', o: 'amiga', pwa: 'oui', events: [
  { e: 'hack' }, { e: 'constructor' }, { e: 'game_end', m: 'martien', r: 'resign', nom: 'Zoé', chat: 'salut' }, 42, null, { e: 'app_open' }
] });
assert.deepStrictEqual(junk.fields, { 'e=game_end': 1, 'e=game_end|r=resign': 1, 'e=app_open': 1 });
assert.deepStrictEqual(stats.parse({ v: 1, events: [{ e: 'chat_msg', g: 'duo' }, { e: 'puzzle_open' }, { e: 'puzzle_solved' }] }).fields,
  { 'e=chat_msg': 1, 'e=chat_msg|g=duo': 1, 'e=puzzle_open': 1, 'e=puzzle_solved': 1 });
// Corps invalides.
[null, 'x', [], {}, { v: 2, events: [{ e: 'app_open' }] }, { v: 1 }, { v: 1, events: [] }, { v: 1, events: 'x' }].forEach(function (b) { assert(stats.parse(b).error, JSON.stringify(b)); });
var many = []; for (var i = 0; i < 51; i++) many.push({ e: 'app_open' });
assert(stats.parse({ v: 1, events: many }).error);
assert(!stats.parse({ v: 1, events: many.slice(1) }).error);

assert.strictEqual(stats.dayOf(Date.UTC(2026, 10, 18, 23, 59)), '2026-11-18');
var cmds = stats.commands('2026-11-18', { fields: { 'e=app_open': 2 }, req: 1 });
assert.deepStrictEqual(cmds, [['HINCRBY', 'stats:d:2026-11-18', 'e=app_open', 2], ['HINCRBY', 'stats:d:2026-11-18', 'req', 1], ['SADD', 'stats:days', '2026-11-18']]);
assert(!cmds.some(function (c) { return /EXPIRE/i.test(c[0]); }));
assert.deepStrictEqual(stats.hashToObject(['a', '2', 'b', '3']), { a: 2, b: 3 });
assert.deepStrictEqual(stats.hashToObject([]), {});

// --- Point d'entrée ---
function run(h, req) {
  return new Promise(function (resolve) {
    var headers = {};
    var res = { statusCode: 200, setHeader: function (k, v) { headers[k] = v; }, end: function (s) { resolve({ status: this.statusCode, json: s ? JSON.parse(s) : null, headers: headers }); } };
    h(req, res);
  });
}
function mkStore() { var calls = []; return { calls: calls, pipeline: function (c) { calls.push(c); return Promise.resolve(c.map(function () { return 1; })); } }; }
var ORIGIN = 'https://turos14.github.io';
var NOW = Date.UTC(2026, 10, 18, 10);
function post(h, body, extra) {
  var headers = { origin: ORIGIN, 'x-forwarded-for': '9.9.9.9, 10.0.0.1' };
  Object.keys(extra || {}).forEach(function (k) { headers[k] = extra[k]; });
  return run(h, { method: 'POST', url: '/api/stats', headers: headers, body: body });
}
var good = { v: 1, ver: 36, b: 'edge', o: 'linux', pwa: true, events: [{ e: 'app_open' }] };

(async function () {
  var st = mkStore(), r;
  var h = statsApi.create({ env: {}, store: st, now: function () { return NOW; } });
  r = await post(h, JSON.stringify(good));   // text/plain : chaîne
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers['Access-Control-Allow-Origin'], ORIGIN);
  assert.strictEqual(st.calls.length, 1);
  assert(st.calls[0].some(function (c) { return c[1] === 'stats:d:2026-11-18' && c[2] === 'e=app_open|pwa=1'; }));
  r = await post(h, good);   // objet
  assert.strictEqual(r.status, 204); assert.strictEqual(st.calls.length, 2);
  // Aucune IP dans ce qui est stocké.
  assert(!/9\.9\.9\.9/.test(JSON.stringify(st.calls)));

  // Origine absente / étrangère -> 403, rien stocké.
  r = await run(h, { method: 'POST', url: '/api/stats', headers: {}, body: good }); assert.strictEqual(r.status, 403);
  r = await post(h, good, { origin: 'https://evil.example' }); assert.strictEqual(r.status, 403);
  assert.strictEqual(st.calls.length, 2);
  // Pré-vol, méthode, corps invalide.
  r = await run(h, { method: 'OPTIONS', url: '/api/stats', headers: { origin: ORIGIN } }); assert.strictEqual(r.status, 204);
  r = await run(h, { method: 'GET', url: '/api/stats', headers: { origin: ORIGIN } }); assert.strictEqual(r.status, 405);
  assert.strictEqual((await post(h, 'pas du json')).status, 400);
  assert.strictEqual((await post(h, undefined)).status, 400);
  assert.strictEqual((await post(h, { v: 1, events: [] })).status, 400);
  assert.strictEqual(st.calls.length, 2);

  // Limite par IP : 30 / 10 min, la 31e -> 429, rien compté ; autre IP passe.
  st = mkStore(); h = statsApi.create({ env: {}, store: st, now: function () { return NOW; } });
  for (var i = 0; i < 30; i++) assert.strictEqual((await post(h, good)).status, 204);
  assert.strictEqual((await post(h, good)).status, 429);
  assert.strictEqual(st.calls.length, 30);
  assert.strictEqual((await post(h, good, { 'x-forwarded-for': '8.8.8.8' })).status, 204);

  // Plafond global STATS_MAX_PER_DAY.
  st = mkStore(); h = statsApi.create({ env: { STATS_MAX_PER_DAY: '3' }, store: st, now: function () { return NOW; } });
  for (i = 0; i < 3; i++) assert.strictEqual((await post(h, good, { 'x-forwarded-for': '7.7.7.' + i })).status, 204);
  assert.strictEqual((await post(h, good, { 'x-forwarded-for': '7.7.7.9' })).status, 429);
  assert.strictEqual(st.calls.length, 3);

  // Sans Redis : 204, rien stocké (pas de fetch).
  var logged = console.log; console.log = function () {};
  h = statsApi.create({ env: {}, fetch: function () { throw new Error('fetch interdit'); }, store: null });
  assert.strictEqual((await post(h, good)).status, 204);
  console.log = logged;
  // Redis en panne : l'appli reçoit quand même 204.
  var err = console.error; console.error = function () {};
  h = statsApi.create({ env: {}, store: { pipeline: function () { return Promise.reject(new Error('panne')); } } });
  assert.strictEqual((await post(h, good)).status, 204);
  console.error = err;

  console.log('relais statistiques OK');
})().catch(function (e) { console.error(e); process.exit(1); });
