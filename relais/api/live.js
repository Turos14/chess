/* Réception des parties en direct de l'appli : POST /api/live (fonction Vercel). Corps JSON envoyé en text/plain
 * (requête « simple »), chaîne ou objet acceptés. Origine obligatoire et autorisée (comme /api/stats). Réponse 204.
 * Chaque partie vit dans Redis sous `live:<gid>` avec expiration (15 min en cours, 1 h terminée) ; jamais de nom,
 * de pseudo ni d'IP (voir lib/live.js). Limites : lib/limit.js, type 'live'. Lue par api/admin.js (action live). */
'use strict';
var limit = require('../lib/limit.js');
var redis = require('../lib/redis.js');
var live = require('../lib/live.js');

var MAX_BODY = 16000;

function create(deps) {
  deps = deps || {};
  var env = deps.env || process.env;
  var memory = deps.memory || limit.createMemory();
  function now() { return deps.now ? deps.now() : Date.now(); }
  function origins() { return (env.ALLOWED_ORIGINS || 'https://turos14.github.io').split(',').map(function (s) { return s.trim(); }); }
  function store() { return deps.store !== undefined ? deps.store : redis.createStore(env, { fetch: deps.fetch }); }
  function clientIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue'; }
  function send(res, status, obj) {
    res.statusCode = status;
    if (obj === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }

  return async function handler(req, res) {
    var list = origins(), origin = (req.headers && req.headers.origin) || '';
    if (list.indexOf(origin) >= 0 || list.indexOf('*') >= 0) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else if (origin) {
      return send(res, 403, { error: 'Origine non autorisée.' });
    }
    if (req.method === 'OPTIONS') return send(res, 204);
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
    if (!origin) return send(res, 403, { error: 'Origine manquante.' });

    var data = req.body;
    if (Buffer.isBuffer(data)) data = data.toString('utf8');
    if (typeof data === 'string') {
      if (data.length > MAX_BODY) return send(res, 400, { error: 'Corps trop volumineux.' });
      try { data = JSON.parse(data); } catch (e) { data = null; }
    }
    var parsed = live.parse(data);
    if (parsed.error) return send(res, 400, { error: parsed.error });

    var lim = await limit.create({ env: env, fetch: deps.fetch, now: deps.now, memory: memory }).check('live', clientIp(req));
    if (!lim.ok) return send(res, 429, { error: 'Trop de requêtes.' });

    var st = store();
    if (!st) { console.log('Partie en direct reçue mais Redis non configuré : rien stocké.'); return send(res, 204); }
    try {
      await st.pipeline(live.commands(parsed, now()));
    } catch (e) {
      console.error('Partie en direct non enregistrée :', e.message);   // pas d'erreur côté appli
    }
    return send(res, 204);
  };
}

var handler = create();
module.exports = function (req, res) { return handler(req, res); };
module.exports.create = create;
