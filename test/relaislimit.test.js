// Limites du relais (relais/lib/limit.js) avec un faux Redis Upstash, et le handler branché dessus.
var assert = require('assert');
var limit = require('../relais/lib/limit.js');

// Faux Redis REST : /pipeline reçoit [[CMD, ...], ...] et répond [{result}, ...]. Gère INCR, TTL, EXPIRE.
function fakeRedis() {
  var store = {}, ttl = {}, calls = [], down = false;
  function fetchFn(url, opts) {
    calls.push({ url: url, opts: opts });
    if (down) return Promise.reject(new Error('réseau coupé'));
    if (opts.headers.Authorization !== 'Bearer tok') return Promise.resolve({ ok: false, status: 401, json: function () { return Promise.resolve({ error: 'unauthorized' }); } });
    var out = JSON.parse(opts.body).map(function (c) {
      var k = c[1];
      if (c[0] === 'INCR') { store[k] = (store[k] || 0) + 1; return { result: store[k] }; }
      if (c[0] === 'TTL') return { result: k in ttl ? ttl[k] : -1 };
      if (c[0] === 'EXPIRE') { ttl[k] = c[2]; return { result: 1 }; }
      return { error: 'ERR unknown command' };
    });
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(out); } });
  }
  return { fetch: fetchFn, store: store, ttl: ttl, calls: calls, setDown: function (v) { down = v; } };
}
var ENV = { KV_REST_API_URL: 'https://fake.upstash.io/', KV_REST_API_TOKEN: 'tok' };

assert.strictEqual(limit.redisConfig({}), null);
assert.deepStrictEqual(limit.redisConfig({ UPSTASH_REDIS_REST_URL: 'https://u.io//', UPSTASH_REDIS_REST_TOKEN: 't' }), { url: 'https://u.io', token: 't' });

(async function () {
  var r, i;
  // Redis : 5 par IP, la 6e refusée ; un autre IP passe ; TTL posé une fois ; URL sans double barre.
  var fr = fakeRedis();
  var L = limit.create({ env: ENV, fetch: fr.fetch });
  for (i = 0; i < 5; i++) { r = await L.check('submit', '1.1.1.1'); assert(r.ok && r.backend === 'redis'); }
  r = await L.check('submit', '1.1.1.1'); assert(!r.ok && r.scope === 'ip');
  assert((await L.check('submit', '2.2.2.2')).ok);
  assert.strictEqual(fr.ttl['relais:submit:1.1.1.1'], 600);
  assert.strictEqual(fr.ttl['relais:day'], 86400);
  assert.strictEqual(fr.calls[0].url, 'https://fake.upstash.io/pipeline');

  // Plafond global (MAX_PER_DAY) : partagé entre IP et entre instances (nouveau limiteur, même Redis).
  fr = fakeRedis();
  var env3 = { KV_REST_API_URL: ENV.KV_REST_API_URL, KV_REST_API_TOKEN: 'tok', MAX_PER_DAY: '3' };
  for (i = 0; i < 3; i++) assert((await limit.create({ env: env3, fetch: fr.fetch }).check('submit', 'ip' + i)).ok);
  r = await limit.create({ env: env3, fetch: fr.fetch }).check('submit', 'autre');
  assert(!r.ok && r.scope === 'day');

  // 'check' : 3 par IP, sans toucher au plafond global.
  fr = fakeRedis(); L = limit.create({ env: ENV, fetch: fr.fetch });
  for (i = 0; i < 3; i++) assert((await L.check('check', '3.3.3.3')).ok);
  assert(!(await L.check('check', '3.3.3.3')).ok);
  assert(!('relais:day' in fr.store));

  // Redis en panne ou jeton refusé : repli sur la mémoire, le relais continue (5 / IP, puis plafond global).
  var logged = console.error; console.error = function () {};
  fr = fakeRedis(); fr.setDown(true);
  L = limit.create({ env: { KV_REST_API_URL: 'https://x.io', KV_REST_API_TOKEN: 'tok', MAX_PER_DAY: '6' }, fetch: fr.fetch });
  for (i = 0; i < 5; i++) { r = await L.check('submit', '4.4.4.4'); assert(r.ok && r.backend === 'memory'); }
  assert(!(await L.check('submit', '4.4.4.4')).ok);
  assert((await L.check('submit', '5.5.5.5')).ok);
  r = await L.check('submit', '6.6.6.6'); assert(!r.ok && r.scope === 'day');
  fr = fakeRedis();
  L = limit.create({ env: { KV_REST_API_URL: 'https://x.io', KV_REST_API_TOKEN: 'mauvais' }, fetch: fr.fetch });
  r = await L.check('submit', '7.7.7.7'); assert(r.ok && r.backend === 'memory');
  console.error = logged;

  // Sans variables : mémoire, fenêtre glissante (horloge injectée), jamais d'appel réseau.
  var t = 1000000, never = function () { throw new Error('fetch interdit'); };
  L = limit.create({ env: {}, fetch: never, now: function () { return t; } });
  for (i = 0; i < 5; i++) assert((await L.check('submit', '8.8.8.8')).ok);
  assert(!(await L.check('submit', '8.8.8.8')).ok);
  t += 10 * 60 * 1000 + 1;
  assert((await L.check('submit', '8.8.8.8')).ok);

  // Handler complet avec Redis configuré : le 429 vient de Redis, partagé par un second « démarrage à froid ».
  fr = fakeRedis();
  process.env.GITHUB_TOKEN = 'test';
  process.env.KV_REST_API_URL = 'https://fake.upstash.io'; process.env.KV_REST_API_TOKEN = 'tok'; process.env.MAX_PER_DAY = '4';
  var gh = 0;
  global.fetch = function (url, opts) {
    if (url.indexOf('fake.upstash.io') >= 0) return fr.fetch(url, opts);
    gh++;
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({ number: 1, html_url: 'u', labels: [{ name: 'puzzle-pending' }] }); } });
  };
  function post(ip, body) {
    return new Promise(function (resolve) {
      var handler = require('../relais/api/submit.js');
      var res = { statusCode: 200, setHeader: function () {}, end: function (s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } };
      handler({ method: 'POST', url: '/api/submit', headers: { origin: 'https://turos14.github.io', 'x-forwarded-for': ip + ', 10.0.0.1' }, body: body }, res);
    });
  }
  var ok = { kind: 'propose', fen: '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', solution: 'f1f8' };
  for (i = 0; i < 4; i++) assert.strictEqual((await post('10.1.1.' + i, ok)).status, 200);
  r = await post('10.1.1.99', ok);
  assert.strictEqual(r.status, 429); assert(/aujourd/.test(r.json.error));
  assert.strictEqual(gh, 4);
  assert.strictEqual((await post('10.1.1.100', { kind: 'propose', fen: 'x', solution: 'f1f8' })).status, 400);   // invalide : pas de 429
  assert.strictEqual(fr.store['relais:submit:10.1.1.0'], 1);   // clé par première adresse de x-forwarded-for
  console.log('relais limites OK');
})().catch(function (e) { console.error(e); process.exit(1); });
