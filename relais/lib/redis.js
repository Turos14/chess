/* Accès à Redis (API REST d'Upstash, compatible Vercel KV) avec fetch — aucune dépendance npm. Partagé par
 * lib/limit.js (limites d'envoi), api/stats.js (compteurs) et api/admin.js (journal, lecture des compteurs).
 * Variables : KV_REST_API_URL / KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). */
'use strict';

var REDIS_TIMEOUT_MS = 2500;

// Config Redis depuis l'environnement, ou null si absente.
function redisConfig(env) {
  var url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  var token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: String(url).replace(/\/+$/, ''), token: token };
}

// Envoie des commandes en un seul aller-retour (/pipeline). Retourne la liste des résultats ; lève en cas d'échec.
function pipeline(cfg, fetchFn, commands) {
  var timer;
  var timeout = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('Redis : délai dépassé')); }, REDIS_TIMEOUT_MS); });
  var req = fetchFn(cfg.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  }).then(function (r) {
    if (!r.ok) throw new Error('Redis : HTTP ' + r.status);
    return r.json();
  }).then(function (arr) {
    if (!Array.isArray(arr)) throw new Error('Redis : réponse inattendue');
    return arr.map(function (x) {
      if (!x || x.error) throw new Error('Redis : ' + (x && x.error));
      return x.result;
    });
  });
  return Promise.race([req, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

// Magasin { pipeline(commandes) -> Promise<résultats> } d'après l'environnement, ou null si Redis n'est pas
// configuré. opts.fetch : fetch injectable (sinon le fetch global, lu à chaque appel).
function createStore(env, opts) {
  var cfg = redisConfig(env || {});
  if (!cfg) return null;
  opts = opts || {};
  return {
    pipeline: function (commands) {
      return pipeline(cfg, function () { return (opts.fetch || fetch).apply(null, arguments); }, commands);
    }
  };
}

module.exports = { redisConfig: redisConfig, pipeline: pipeline, createStore: createStore };
