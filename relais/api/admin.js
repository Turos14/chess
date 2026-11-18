/* API de l'admin du relais : /api/admin?a=<action> (une seule fonction Vercel), appelée par la page /admin/.
 * Actions : login, logout, me, queue, approve, refuse, stats, log, live (voir relais/README.md). Même origine que la
 * page : pas d'en-têtes CORS. Session = cookie signé HttpOnly (lib/admin.js) ; tout POST exige l'en-tête
 * `X-Admin: 1` et une Origin identique à l'hôte (protection CSRF en plus de SameSite=Strict). L'admin ne fait que
 * poser des étiquettes (approbation) ou refuser (commentaire + fermeture) : la publication reste faite par les
 * Actions GitHub existantes. Le journal (`admin:log`) ne contient jamais d'adresse IP. */
'use strict';
var admin = require('../lib/admin.js');
var limit = require('../lib/limit.js');
var redis = require('../lib/redis.js');
var stats = require('../lib/stats.js');
var live = require('../lib/live.js');

var ACTIONS = { login: 'POST', logout: 'POST', me: 'GET', queue: 'GET', approve: 'POST', refuse: 'POST', stats: 'GET', log: 'GET', live: 'GET' };
var DAY_MS = 24 * 60 * 60 * 1000, MAX_RANGE_DAYS = 400, LOG_MAX = 500, LOG_READ = 100, LIVE_MAX = 200;

function create(deps) {
  deps = deps || {};
  var env = deps.env || process.env;
  var memory = deps.memory || limit.createMemory();
  var memLog = [], memLiveView = 0;   // journal de repli si Redis n'est pas configuré
  function now() { return deps.now ? deps.now() : Date.now(); }
  function fetchFn() { return (deps.fetch || fetch).apply(null, arguments); }
  function store() { return deps.store !== undefined ? deps.store : redis.createStore(env, { fetch: deps.fetch }); }
  function repo() { return env.GITHUB_REPO || 'Turos14/chess'; }
  function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue'; }
  function header(req, n) { return (req.headers && req.headers[n]) || ''; }

  function send(res, status, obj) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  }
  function ghHeaders() {
    return {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'echecs-relais', 'Content-Type': 'application/json'
    };
  }
  function gh(path, method, body) {
    return fetchFn('https://api.github.com/repos/' + repo() + path, {
      method: method || 'GET', headers: ghHeaders(), body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  function readBody(req) {
    var d = req.body;
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    return d && typeof d === 'object' ? d : {};
  }

  // Journal : jamais d'IP, et un échec d'écriture ne bloque jamais l'action.
  async function journal(entry) {
    entry.at = now();
    var st = store();
    if (!st) { memLog.unshift(entry); memLog.length = Math.min(memLog.length, LOG_MAX); return; }
    try { await st.pipeline([['LPUSH', 'admin:log', JSON.stringify(entry)], ['LTRIM', 'admin:log', 0, LOG_MAX - 1]]); }
    catch (e) { console.error('Journal admin non écrit :', e.message); }
  }
  async function readLog() {
    var st = store();
    if (!st) return memLog.slice(0, LOG_READ);
    var res = await st.pipeline([['LRANGE', 'admin:log', 0, LOG_READ - 1]]);
    return (res[0] || []).map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
  }

  // Tickets ouverts en attente (les PR sont exclues). Trois requêtes par étiquette pour ne rien rater au-delà de 100.
  async function queue() {
    var seen = {}, items = [];
    var rs = await Promise.all(admin.KINDS.map(function (k) { return gh('/issues?state=open&per_page=100&labels=' + encodeURIComponent(k.pending)); }));
    var lists = [];
    for (var i = 0; i < rs.length; i++) {
      if (!rs[i].ok) throw new Error('GitHub HTTP ' + rs[i].status);
      lists.push(await rs[i].json());
    }
    lists.forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (is) {
        if (!is || is.pull_request || is.state === 'closed' || seen[is.number]) return;
        var kind = admin.kindOf(is.labels);
        if (!kind) return;
        seen[is.number] = true;
        items.push({
          number: is.number, title: String(is.title || '').replace(/​/g, ''), url: is.html_url, kind: kind,
          createdAt: is.created_at, labels: admin.labelNames(is.labels), fields: admin.splitFields(is.body)
        });
      });
    });
    items.sort(function (a, b) { return String(a.createdAt) < String(b.createdAt) ? -1 : 1; });
    return items;
  }

  // Relit le ticket : { error: [status, message] } ou { issue, kind }.
  async function loadPending(number) {
    if (typeof number !== 'number' || number % 1 !== 0 || number < 1) return { error: [400, 'Numéro de ticket invalide.'] };
    var r = await gh('/issues/' + number);
    if (r.status === 404) return { error: [404, 'Ticket introuvable.'] };
    if (!r.ok) return { error: [502, 'GitHub a répondu HTTP ' + r.status + '.'] };
    var issue = await r.json();
    if (issue.pull_request) return { error: [400, 'Ce n’est pas un ticket de problème.'] };
    if (issue.state !== 'open') return { error: [409, 'Ce ticket est déjà fermé.'] };
    var kind = admin.kindOf(issue.labels);
    if (!kind) return { error: [409, 'Ce ticket n’attend pas de validation.'] };
    return { issue: issue, kind: kind };
  }

  async function statsRange(q) {
    var today = stats.dayOf(now());
    var to = q.get('to') || today;
    var from = q.get('from') || stats.dayOf(Date.parse(to + 'T00:00:00Z') - 29 * DAY_MS);
    function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && stats.dayOf(Date.parse(d + 'T00:00:00Z')) === d; }
    if (!valid(from) || !valid(to)) return { error: [400, 'Dates invalides (AAAA-MM-JJ attendu).'] };
    var a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
    if (a > b) return { error: [400, 'La date de début est après la date de fin.'] };
    if ((b - a) / DAY_MS + 1 > MAX_RANGE_DAYS) return { error: [400, 'Plage trop longue (' + MAX_RANGE_DAYS + ' jours maximum).'] };
    var days = [], t;
    for (t = a; t <= b; t += DAY_MS) days.push(stats.dayOf(t));
    var out = {}, st = store();
    if (st) {
      var res = await st.pipeline(days.map(function (d) { return ['HGETALL', 'stats:d:' + d]; }));
      days.forEach(function (d, i) {
        var h = stats.hashToObject(res[i]);
        if (Object.keys(h).length) out[d] = h;
      });
    }
    return { from: from, to: to, days: out };
  }

  // Parties en direct : les LIVE_MAX plus récentes encore valides (en cours < 15 min, terminées < 1 h).
  async function liveGames() {
    var st = store(), t = now();
    if (!st) return [];
    var res = await st.pipeline([
      ['ZREMRANGEBYSCORE', 'live:idx', '-inf', t - live.ENDED_MS],
      ['ZREVRANGEBYSCORE', 'live:idx', '+inf', '-inf', 'LIMIT', 0, LIVE_MAX]
    ]);
    var gids = res[1] || [];
    if (!gids.length) return [];
    var vals = await st.pipeline([['MGET'].concat(gids.map(function (g) { return 'live:' + g; })), ['MGET'].concat(gids.map(function (g) { return 'live:st:' + g; }))]);
    var games = [];
    gids.forEach(function (gid, i) {
      var g;
      try { g = JSON.parse(vals[0][i]); } catch (e) { g = null; }
      if (!g || typeof g !== 'object' || typeof g.at !== 'number') return;
      if (t - g.at > (g.end ? live.ENDED_MS : live.PLAYING_MS)) return;
      var o = { gid: gid, m: g.m, 'var': g['var'] };
      if (g.sf !== undefined) o.sf = g.sf;
      if (g.teams !== undefined) o.teams = g.teams;
      o.mv = Array.isArray(g.mv) ? g.mv : [];
      if (g.tc !== undefined) o.tc = g.tc;
      if (g.end !== undefined) o.end = g.end;
      var started = Number(vals[1][i]);
      o.startedAt = started > 0 && started <= g.at ? started : g.at;
      o.updatedAt = g.at;
      games.push(o);
    });
    games.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return games.slice(0, LIVE_MAX);
  }
  // Journalise « live_view » au plus une fois par minute.
  async function logLiveView() {
    var st = store(), t = now();
    if (!st) { if (t - memLiveView >= 60000) { memLiveView = t; await journal({ action: 'live_view' }); } return; }
    try {
      var r = await st.pipeline([['SET', 'admin:liveview', '1', 'NX', 'EX', 60]]);
      if (r[0] === 'OK') await journal({ action: 'live_view' });
    } catch (e) { console.error('Journal admin non écrit :', e.message); }
  }

  return async function handler(req, res) {
    var u = new URL(req.url || '/', 'http://localhost');
    var action = u.searchParams.get('a') || '';
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return send(res, 404, { error: 'Action inconnue.' });
    if (req.method !== ACTIONS[action]) return send(res, 405, { error: 'Méthode non autorisée.' });

    if (req.method === 'POST') {
      if (header(req, 'x-admin') !== '1') return send(res, 403, { error: 'En-tête X-Admin manquant.' });
      var origin = header(req, 'origin');
      if (origin && origin !== 'https://' + header(req, 'host')) return send(res, 403, { error: 'Origine non autorisée.' });
    }
    if (!env.ADMIN_PASSWORD) return send(res, 503, { error: 'Admin non configuré (ADMIN_PASSWORD manquant).' });

    try {
      if (action === 'login') {
        var lim = await limit.create({ env: env, fetch: deps.fetch, now: deps.now, memory: memory }).check('login', clientIp(req));
        if (!lim.ok) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
        if (!admin.checkPassword(readBody(req).password, env.ADMIN_PASSWORD)) {
          await journal({ action: 'login_fail' });
          return send(res, 401, { error: 'Mot de passe incorrect.' });
        }
        await journal({ action: 'login' });
        res.setHeader('Set-Cookie', admin.sessionCookie(admin.signSession(env, now())));
        return send(res, 200, { ok: true });
      }

      if (!admin.verifySession(env, admin.cookieValue(header(req, 'cookie'), admin.COOKIE), now())) {
        return send(res, 401, { error: 'Session absente ou expirée : reconnecte-toi.' });
      }

      if (action === 'logout') { res.setHeader('Set-Cookie', admin.clearCookie()); return send(res, 200, { ok: true }); }
      if (action === 'me') return send(res, 200, { ok: true });
      if (action === 'log') return send(res, 200, { ok: true, entries: await readLog() });
      if (action === 'live') {
        var games = await liveGames();
        await logLiveView();
        return send(res, 200, { ok: true, now: now(), games: games });
      }
      if (action === 'stats') {
        var r = await statsRange(u.searchParams);
        if (r.error) return send(res, r.error[0], { error: r.error[1] });
        return send(res, 200, { ok: true, from: r.from, to: r.to, days: r.days });
      }

      // Les actions qui parlent à GitHub exigent le jeton du relais.
      if (!env.GITHUB_TOKEN) return send(res, 500, { error: 'Relais mal configuré (GITHUB_TOKEN manquant).' });
      if (action === 'queue') return send(res, 200, { ok: true, items: await queue() });

      var body = readBody(req);
      var p = await loadPending(body.number);
      if (p.error) return send(res, p.error[0], { error: p.error[1] });
      var n = body.number;
      if (action === 'approve') {
        var lr = await gh('/issues/' + n + '/labels', 'POST', { labels: [admin.approvedLabel(p.kind)] });
        if (!lr.ok) return send(res, 502, { error: 'GitHub a refusé d’ajouter l’étiquette (HTTP ' + lr.status + ').' });
        await journal({ action: 'approve', number: n, kind: p.kind });
        return send(res, 200, { ok: true });
      }
      // refuse : commentaire puis fermeture « non planifié ».
      var reason = admin.cleanReason(body.reason);
      var cr = await gh('/issues/' + n + '/comments', 'POST', { body: 'Refusé par la modération' + (reason ? ' : ' + reason : '.') });
      if (!cr.ok) return send(res, 502, { error: 'GitHub a refusé le commentaire (HTTP ' + cr.status + ').' });
      var xr = await gh('/issues/' + n, 'PATCH', { state: 'closed', state_reason: 'not_planned' });
      if (!xr.ok) return send(res, 502, { error: 'Commentaire posté, mais GitHub a refusé la fermeture (HTTP ' + xr.status + ').' });
      await journal({ action: 'refuse', number: n, kind: p.kind });
      return send(res, 200, { ok: true });
    } catch (e) {
      console.error('Admin :', action, e.message);
      return send(res, 502, { error: 'Service injoignable, réessaie plus tard.' });
    }
  };
}

var handler = create();
module.exports = function (req, res) { return handler(req, res); };
module.exports.create = create;
