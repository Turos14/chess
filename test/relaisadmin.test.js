// API admin du relais : session, protections, file de modération, approbation / refus, lecture des statistiques.
var assert = require('assert');
var adminLib = require('../relais/lib/admin.js');
var adminApi = require('../relais/api/admin.js');

var Z = '​';
var NOW = Date.UTC(2026, 10, 18, 10);
var ENV = { ADMIN_PASSWORD: 'mot-de-passe-tres-long', GITHUB_TOKEN: 'tok', GITHUB_REPO: 'Turos14/chess' };
var HOST = 'chess-relais.vercel.app';

// Faux Redis (store injecté) : HGETALL, LPUSH, LTRIM, LRANGE.
function fakeStore() {
  var hashes = {}, lists = {};
  return {
    hashes: hashes, lists: lists,
    pipeline: function (cmds) {
      return Promise.resolve(cmds.map(function (c) {
        if (c[0] === 'HGETALL') { var a = []; Object.keys(hashes[c[1]] || {}).forEach(function (f) { a.push(f, String(hashes[c[1]][f])); }); return a; }
        if (c[0] === 'LPUSH') { (lists[c[1]] = lists[c[1]] || []).unshift(c[2]); return 1; }
        if (c[0] === 'LTRIM') { lists[c[1]] = (lists[c[1]] || []).slice(c[2], c[3] + 1); return 'OK'; }
        if (c[0] === 'LRANGE') return (lists[c[1]] || []).slice(c[2], c[3] + 1);
        throw new Error('commande inconnue ' + c[0]);
      }));
    }
  };
}

// Faux GitHub.
function fakeGithub(issues) {
  var calls = [];
  function resp(status, data) { return Promise.resolve({ ok: status < 300, status: status, json: function () { return Promise.resolve(data); } }); }
  function f(url, opts) {
    opts = opts || {};
    var path = url.replace('https://api.github.com/repos/Turos14/chess', '');
    var body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method: opts.method || 'GET', path: path, body: body, auth: opts.headers && opts.headers.Authorization });
    var m;
    if ((opts.method || 'GET') === 'GET' && /^\/issues\?/.test(path)) {
      var lab = decodeURIComponent((/labels=([^&]+)/.exec(path) || [])[1] || '');
      return resp(200, issues.filter(function (i) { return i.state === 'open' && (!lab || i.labels.some(function (l) { return l.name === lab; })); }));
    }
    m = /^\/issues\/(\d+)(\/labels|\/comments)?$/.exec(path);
    var issue = m && issues.filter(function (i) { return i.number === +m[1]; })[0];
    if (!m || !issue) return resp(404, { message: 'Not Found' });
    if (!m[2] && (opts.method || 'GET') === 'GET') return resp(200, issue);
    if (m[2] === '/labels') { body.labels.forEach(function (l) { issue.labels.push({ name: l }); }); return resp(200, issue.labels); }
    if (m[2] === '/comments') return resp(201, {});
    if (opts.method === 'PATCH') { issue.state = body.state; return resp(200, issue); }
    return resp(500, {});
  }
  return { fetch: f, calls: calls };
}
function issue(n, labels, body, extra) {
  var o = { number: n, title: 'T' + n, html_url: 'https://github.com/Turos14/chess/issues/' + n, state: 'open', created_at: '2026-11-0' + n + 'T00:00:00Z',
    labels: labels.map(function (l) { return { name: l }; }), body: body || '' };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

function run(h, req) {
  return new Promise(function (resolve) {
    var headers = {};
    var res = { statusCode: 200, setHeader: function (k, v) { headers[k] = v; }, end: function (s) { resolve({ status: this.statusCode, json: JSON.parse(s), headers: headers }); } };
    h(req, res);
  });
}
function req(a, method, opts) {
  opts = opts || {};
  var headers = { host: HOST, 'x-forwarded-for': opts.ip || '5.5.5.5' };
  if (method === 'POST' && !opts.noAdminHeader) headers['x-admin'] = '1';
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  return { method: method, url: '/api/admin?a=' + a + (opts.q || ''), headers: headers, body: opts.body };
}

// --- lib/admin.js ---
assert(adminLib.checkPassword('abc', 'abc')); assert(!adminLib.checkPassword('abd', 'abc')); assert(!adminLib.checkPassword(undefined, 'abc')); assert(!adminLib.checkPassword('', ''));
var tok = adminLib.signSession(ENV, NOW);
assert(adminLib.verifySession(ENV, tok, NOW + 3600 * 1000));
assert(!adminLib.verifySession(ENV, tok, NOW + 2 * 3600 * 1000 + 1));   // expiré
var parts = tok.split('.');
var forged = Buffer.from(JSON.stringify({ exp: NOW + 99999999999 })).toString('base64url') + '.' + parts[1];
assert(!adminLib.verifySession(ENV, forged, NOW));                      // charge modifiée, signature inchangée
assert(!adminLib.verifySession(ENV, parts[0] + '.' + parts[1].slice(0, -2) + 'AA', NOW));
assert(!adminLib.verifySession(ENV, 'n.importe', NOW)); assert(!adminLib.verifySession(ENV, '', NOW)); assert(!adminLib.verifySession(ENV, undefined, NOW));
assert(!adminLib.verifySession({ ADMIN_PASSWORD: 'autre' }, tok, NOW));  // changer le mot de passe invalide les sessions
assert(adminLib.verifySession({ ADMIN_PASSWORD: 'x', ADMIN_SESSION_SECRET: 's' }, adminLib.signSession({ ADMIN_PASSWORD: 'x', ADMIN_SESSION_SECRET: 's' }, NOW), NOW));
assert(!adminLib.verifySession({ ADMIN_PASSWORD: 'y', ADMIN_SESSION_SECRET: 's2' }, adminLib.signSession({ ADMIN_PASSWORD: 'y', ADMIN_SESSION_SECRET: 's' }, NOW), NOW));
assert.strictEqual(adminLib.cookieValue('a=1; admin_session=xyz; b=2', 'admin_session'), 'xyz');
assert.strictEqual(adminLib.cookieValue('', 'admin_session'), null);
assert.deepStrictEqual(adminLib.splitFields('### A\n\nvaleur ' + Z + 'x\r\nsuite\n\n### B (optionnel)\n\n_No response_\n\n### C\n\n\n'), { A: 'valeur x\nsuite', 'B (optionnel)': '', C: '' });
assert.strictEqual(adminLib.kindOf([{ name: 'puzzle-pending' }]), 'propose');
assert.strictEqual(adminLib.kindOf(['puzzle-pending', 'puzzle-approved']), null);
assert.strictEqual(adminLib.kindOf([{ name: 'edit-puzzle' }]), 'edit');
assert.strictEqual(adminLib.kindOf([{ name: 'delete-puzzle' }, { name: 'delete-approved' }]), null);
assert.strictEqual(adminLib.kindOf([{ name: 'bug' }]), null);
// Ancien ticket GitHub (étiquette « puzzle » seule) : dans la file comme proposition.
assert.strictEqual(adminLib.kindOf([{ name: 'puzzle' }]), 'propose');
assert.strictEqual(adminLib.kindOf(['puzzle', 'puzzle-approved']), null);
assert.deepStrictEqual(adminLib.queueLabels(), ['puzzle-pending', 'puzzle', 'edit-puzzle', 'delete-puzzle']);
assert.deepStrictEqual(adminLib.approveSteps('propose', ['puzzle']), [['puzzle-pending'], ['puzzle-approved']]);
assert.deepStrictEqual(adminLib.approveSteps('propose', ['puzzle', 'puzzle-pending']), [['puzzle-approved']]);
assert.deepStrictEqual(adminLib.approveSteps('edit', ['edit-puzzle']), [['edit-approved']]);
var cr = adminLib.cleanReason('  ligne 1\n\n### titre @Turos14 #12\t' + new Array(400).join('x'));
assert(cr.length <= 300 && !/\n/.test(cr) && cr.indexOf('@' + Z) >= 0 && cr.indexOf('###') < 0);

(async function () {
  var r, h, gh, st;
  function make(issues, env, store) {
    gh = fakeGithub(issues); st = store === undefined ? fakeStore() : store;
    h = adminApi.create({ env: env || ENV, fetch: gh.fetch, now: function () { return NOW; }, store: st });
  }
  async function login(ip) {
    var rr = await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, ip: ip }));
    assert.strictEqual(rr.status, 200, JSON.stringify(rr.json));
    return rr.headers['Set-Cookie'].split(';')[0];
  }
  var body1 = '### FEN de départ\n\n7k/6pp/8/8/8/8/8/5R1K w - - 0 1\n\n### Solution\n\nf1f8\n\n### Titre (optionnel)\n\nMat @' + Z + 'x\n\n### Description (optionnel)\n\n_No response_\n';
  make([
    issue(1, ['puzzle-pending'], body1),
    issue(2, ['edit-puzzle'], '### Identifiant du problème\n\ngh-30\n'),
    issue(3, ['delete-puzzle', 'delete-approved'], 'déjà approuvé'),
    issue(4, ['puzzle-pending'], 'x', { pull_request: {} }),
    issue(5, ['bug'], 'autre'),
    issue(6, ['delete-puzzle'], '### Identifiant(s) du/des problème(s)\n\ngh-1\n'),
    issue(7, ['puzzle-pending'], 'fermé', { state: 'closed' })
  ]);

  // Sans ADMIN_PASSWORD : 503, même avec le bon en-tête.
  var h0 = adminApi.create({ env: {}, fetch: gh.fetch, store: st });
  assert.strictEqual((await run(h0, req('login', 'POST', { body: { password: 'x' } }))).status, 503);
  assert.strictEqual((await run(h0, req('me', 'GET'))).status, 503);

  // Action inconnue / mauvaise méthode.
  assert.strictEqual((await run(h, req('nimporte', 'GET'))).status, 404);
  assert.strictEqual((await run(h, req('login', 'GET'))).status, 405);
  assert.strictEqual((await run(h, req('queue', 'POST'))).status, 405);

  // Sans session : 401 partout (hors login).
  ['me', 'queue', 'stats', 'log'].forEach(function () {});
  assert.strictEqual((await run(h, req('me', 'GET'))).status, 401);
  assert.strictEqual((await run(h, req('queue', 'GET'))).status, 401);
  assert.strictEqual((await run(h, req('stats', 'GET'))).status, 401);
  assert.strictEqual((await run(h, req('log', 'GET'))).status, 401);
  assert.strictEqual((await run(h, req('approve', 'POST', { body: { number: 1 } }))).status, 401);
  assert.strictEqual(gh.calls.length, 0);

  // Login : mauvais mot de passe -> 401 sans cookie ; bon -> cookie de session aux attributs voulus.
  r = await run(h, req('login', 'POST', { body: { password: 'faux' } }));
  assert.strictEqual(r.status, 401); assert(!r.headers['Set-Cookie']);
  r = await run(h, req('login', 'POST', { body: JSON.stringify({ password: ENV.ADMIN_PASSWORD }) }));   // corps en chaîne
  assert.strictEqual(r.status, 200);
  var setCookie = r.headers['Set-Cookie'];
  ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=7200'].forEach(function (a) { assert(setCookie.indexOf(a) >= 0, a); });
  assert.strictEqual(r.headers['Cache-Control'], 'no-store');
  var cookie = setCookie.split(';')[0];
  assert.strictEqual((await run(h, req('login', 'POST', {}))).status, 401);   // corps absent
  assert.strictEqual((await run(h, req('me', 'GET', { cookie: cookie }))).status, 200);

  // Cookie falsifié, expiré, d'un autre mot de passe -> 401.
  assert.strictEqual((await run(h, req('me', 'GET', { cookie: 'admin_session=' + forged }))).status, 401);
  var later = adminApi.create({ env: ENV, fetch: gh.fetch, now: function () { return NOW + 3 * 3600 * 1000; }, store: st });
  assert.strictEqual((await run(later, req('me', 'GET', { cookie: cookie }))).status, 401);

  // CSRF : POST sans X-Admin -> 403 ; Origin étrangère -> 403 ; Origin identique acceptée.
  assert.strictEqual((await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, noAdminHeader: true }))).status, 403);
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 1 }, noAdminHeader: true }))).status, 403);
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 1 }, origin: 'https://evil.example' }))).status, 403);
  assert.strictEqual((await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, origin: 'https://' + HOST }))).status, 200);
  assert.strictEqual(gh.calls.length, 0);

  // File : bons kinds seulement, PR et fermés exclus, ZWSP retirés, « _No response_ » -> "".
  r = await run(h, req('queue', 'GET', { cookie: cookie }));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.items.map(function (i) { return i.number + ':' + i.kind; }), ['1:propose', '2:edit', '6:delete']);
  var it = r.json.items[0];
  assert.strictEqual(it.title, 'T1'); assert.strictEqual(it.url, 'https://github.com/Turos14/chess/issues/1'); assert.strictEqual(it.createdAt, '2026-11-01T00:00:00Z');
  assert.deepStrictEqual(it.labels, ['puzzle-pending']);
  assert.deepStrictEqual(it.fields, { 'FEN de départ': '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', Solution: 'f1f8', 'Titre (optionnel)': 'Mat @x', 'Description (optionnel)': '' });
  assert(JSON.stringify(r.json).indexOf(Z) < 0);
  assert(gh.calls.every(function (c) { return c.auth === 'Bearer tok' && c.method === 'GET'; }));

  // Approve : étiquette adaptée au type ; refus si fermé, déjà approuvé, mauvais type, PR, inconnu, numéro invalide.
  gh.calls.length = 0;
  r = await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 1 } }));
  assert.strictEqual(r.status, 200);
  var lab = gh.calls.filter(function (c) { return c.method === 'POST'; });
  assert.strictEqual(lab.length, 1); assert.strictEqual(lab[0].path, '/issues/1/labels'); assert.deepStrictEqual(lab[0].body, { labels: ['puzzle-approved'] });
  r = await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 2 } }));
  assert.deepStrictEqual(gh.calls[gh.calls.length - 1].body, { labels: ['edit-approved'] });
  r = await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 6 } }));
  assert.deepStrictEqual(gh.calls[gh.calls.length - 1].body, { labels: ['delete-approved'] });
  var n = gh.calls.length;
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 1 } }))).status, 409);   // déjà approuvé
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 7 } }))).status, 409);   // fermé
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 5 } }))).status, 409);   // mauvais type
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 4 } }))).status, 400);   // PR
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 99 } }))).status, 404);
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: { number: '1; DROP' } }))).status, 400);
  assert.strictEqual((await run(h, req('approve', 'POST', { cookie: cookie, body: {} }))).status, 400);
  assert.strictEqual(gh.calls.slice(n).filter(function (c) { return c.method !== 'GET'; }).length, 0);

  // Refuse : commentaire (raison nettoyée) puis fermeture non planifiée ; ticket fermé refusé.
  make([issue(8, ['puzzle-pending'], 'x'), issue(9, ['puzzle-pending'], 'y', { state: 'closed' })]);
  cookie = await login();
  r = await run(h, req('refuse', 'POST', { cookie: cookie, body: { number: 8, reason: 'Doublon\n### de @Turos14 #5 ' + new Array(400).join('x') } }));
  assert.strictEqual(r.status, 200);
  var writes = gh.calls.filter(function (c) { return c.method !== 'GET'; });
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(writes[0].path, '/issues/8/comments');
  assert(/^Refusé par la modération : Doublon/.test(writes[0].body.body));
  assert(writes[0].body.body.indexOf('\n') < 0 && writes[0].body.body.indexOf('@' + Z) >= 0 && writes[0].body.body.indexOf('#' + Z + '5') >= 0 && writes[0].body.body.length < 340);
  assert.strictEqual(writes[1].method, 'PATCH'); assert.strictEqual(writes[1].path, '/issues/8');
  assert.deepStrictEqual(writes[1].body, { state: 'closed', state_reason: 'not_planned' });
  assert.strictEqual((await run(h, req('refuse', 'POST', { cookie: cookie, body: { number: 9, reason: 'x' } }))).status, 409);
  assert.strictEqual(gh.calls.filter(function (c) { return c.method !== 'GET'; }).length, 2);
  // Sans raison.
  make([issue(10, ['edit-puzzle'], 'z')]); cookie = await login();
  await run(h, req('refuse', 'POST', { cookie: cookie, body: { number: 10 } }));
  assert.strictEqual(gh.calls.filter(function (c) { return c.method === 'POST'; })[0].body.body, 'Refusé par la modération.');

  // Journal : login, login_fail, approve, refuse — sans IP — 100 dernières entrées, plus récentes d'abord.
  make([issue(11, ['puzzle-pending'], 'x')]);
  await run(h, req('login', 'POST', { body: { password: 'faux' }, ip: '6.6.6.6' }));
  cookie = await login('6.6.6.6');
  await run(h, req('approve', 'POST', { cookie: cookie, body: { number: 11 } }));
  r = await run(h, req('log', 'GET', { cookie: cookie }));
  assert.deepStrictEqual(r.json.entries.map(function (e) { return e.action; }), ['approve', 'login', 'login_fail']);
  assert.deepStrictEqual(r.json.entries[0], { action: 'approve', number: 11, kind: 'propose', at: NOW });
  assert(!/6\.6\.6\.6/.test(JSON.stringify(st.lists)));
  for (var i = 0; i < 520; i++) st.lists['admin:log'].unshift(JSON.stringify({ at: i, action: 'login' }));
  await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, ip: '6.6.6.7' }));
  assert(st.lists['admin:log'].length <= 500);
  r = await run(h, req('log', 'GET', { cookie: cookie }));
  assert.strictEqual(r.json.entries.length, 100);

  // Limite de connexion : 5 essais / 15 min par IP, puis 429 (même avec le bon mot de passe) ; autre IP libre.
  make([]);
  for (i = 0; i < 5; i++) assert.strictEqual((await run(h, req('login', 'POST', { body: { password: 'faux' }, ip: '4.4.4.4' }))).status, 401);
  assert.strictEqual((await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, ip: '4.4.4.4' }))).status, 429);
  assert.strictEqual((await run(h, req('login', 'POST', { body: { password: ENV.ADMIN_PASSWORD }, ip: '4.4.4.5' }))).status, 200);

  // Logout : efface le cookie.
  cookie = await login('3.3.3.3');
  r = await run(h, req('logout', 'POST', { cookie: cookie }));
  assert.strictEqual(r.status, 200); assert(/Max-Age=0/.test(r.headers['Set-Cookie']));

  // Statistiques : lit les hashes sur la plage (défaut = 30 derniers jours), jours vides absents.
  make([]);
  st.hashes['stats:d:2026-11-18'] = { req: 4, 'e=app_open': 3, 'e=app_open|b=chrome': 3 };
  st.hashes['stats:d:2026-11-10'] = { req: 1, 'e=puzzle_open': 1 };
  st.hashes['stats:d:2026-09-01'] = { req: 9 };
  cookie = await login();
  r = await run(h, req('stats', 'GET', { cookie: cookie }));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.to, '2026-11-18'); assert.strictEqual(r.json.from, '2026-10-20');
  assert.deepStrictEqual(r.json.days, { '2026-11-18': { req: 4, 'e=app_open': 3, 'e=app_open|b=chrome': 3 }, '2026-11-10': { req: 1, 'e=puzzle_open': 1 } });
  r = await run(h, req('stats', 'GET', { cookie: cookie, q: '&from=2026-09-01&to=2026-09-02' }));
  assert.deepStrictEqual(r.json.days, { '2026-09-01': { req: 9 } });
  assert.strictEqual((await run(h, req('stats', 'GET', { cookie: cookie, q: '&from=2026-11-18&to=2026-11-01' }))).status, 400);
  assert.strictEqual((await run(h, req('stats', 'GET', { cookie: cookie, q: '&from=2025-01-01&to=2026-11-18' }))).status, 400);   // > 400 jours
  assert.strictEqual((await run(h, req('stats', 'GET', { cookie: cookie, q: '&from=2026-13-45&to=2026-11-18' }))).status, 400);
  assert.strictEqual((await run(h, req('stats', 'GET', { cookie: cookie, q: '&from=abc' }))).status, 400);

  // Sans Redis : journal et statistiques ne plantent pas.
  make([issue(12, ['puzzle-pending'], 'x')], ENV, null);
  cookie = await login();
  assert.deepStrictEqual((await run(h, req('stats', 'GET', { cookie: cookie }))).json.days, {});
  assert.strictEqual((await run(h, req('log', 'GET', { cookie: cookie }))).json.entries[0].action, 'login');

  // GitHub injoignable : 502 propre.
  var err = console.error; console.error = function () {};
  h = adminApi.create({ env: ENV, fetch: function () { return Promise.reject(new Error('réseau')); }, now: function () { return NOW; }, store: null });
  cookie = await login();
  assert.strictEqual((await run(h, req('queue', 'GET', { cookie: cookie }))).status, 502);
  console.error = err;

  console.log('relais admin OK');
})().catch(function (e) { console.error(e); process.exit(1); });
