/* Limites d'envois du relais, partagées entre instances via l'API REST d'Upstash Redis (compatible Vercel KV),
 * appelée avec fetch — aucune dépendance npm. Variables : KV_REST_API_URL / KV_REST_API_TOKEN (ou
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN), MAX_PER_DAY (plafond global, défaut 20 / 24 h).
 * Sans ces variables, ou si Redis est injoignable, repli sur un compteur en mémoire (propre à l'instance, remis à
 * zéro au démarrage à froid : approximatif mais le relais continue de fonctionner).
 * Deux types de demande : 'submit' (par IP : 5 / 10 min, puis plafond global par jour) et 'check' (par IP :
 * 3 / 10 min, pour que le diagnostic ne puisse pas épuiser le quota de l'API GitHub du jeton).
 * Module sans effet de bord : le fetch, l'horloge et la mémoire sont injectables (test/relaislimit.test.js). */
'use strict';

var WINDOW_S = 10 * 60, DAY_S = 24 * 60 * 60, REDIS_TIMEOUT_MS = 2500;
var LIMITS = { submit: { max: 5, key: 'submit' }, check: { max: 3, key: 'check' } };

// Compteur en mémoire : { clé: [horodatages ms] }. Ne compte que les demandes acceptées.
function createMemory() {
  var hits = {}, size = 0;
  return {
    hit: function (key, max, windowMs, now) {
      if (size > 5000) { hits = {}; size = 0; }   // garde-fou : jamais de croissance sans borne
      var list = (hits[key] || []).filter(function (t) { return now - t < windowMs; });
      if (!hits[key]) size++;
      if (list.length >= max) { hits[key] = list; return false; }
      list.push(now); hits[key] = list;
      return true;
    }
  };
}

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

// INCR + TTL en un aller-retour ; EXPIRE seulement si la clé n'a pas (encore) d'expiration, pour qu'aucun
// compteur ne reste bloqué à vie même si un EXPIRE précédent a échoué. Retourne la valeur du compteur.
function incr(cfg, fetchFn, key, ttlS) {
  return pipeline(cfg, fetchFn, [['INCR', key], ['TTL', key]]).then(function (res) {
    if (res[1] >= 0) return res[0];
    return pipeline(cfg, fetchFn, [['EXPIRE', key, ttlS]]).then(function () { return res[0]; });
  });
}

// opts : { env, fetch, now (ms), memory }. Retourne { check(kind, ip) -> Promise<{ ok, scope, backend }> }.
function create(opts) {
  opts = opts || {};
  var env = opts.env || {};
  var cfg = redisConfig(env);
  var memory = opts.memory || createMemory();
  var maxDay = parseInt(env.MAX_PER_DAY, 10);
  if (!(maxDay > 0)) maxDay = 20;
  function now() { return opts.now ? opts.now() : Date.now(); }
  function fetchFn() { return (opts.fetch || fetch).apply(null, arguments); }

  function viaMemory(kind, ip) {
    var lim = LIMITS[kind];
    if (!memory.hit(lim.key + ':' + ip, lim.max, WINDOW_S * 1000, now())) return { ok: false, scope: 'ip', backend: 'memory' };
    if (kind === 'submit' && !memory.hit('day', maxDay, DAY_S * 1000, now())) return { ok: false, scope: 'day', backend: 'memory' };
    return { ok: true, scope: null, backend: 'memory' };
  }
  function viaRedis(kind, ip) {
    var lim = LIMITS[kind];
    return incr(cfg, fetchFn, 'relais:' + lim.key + ':' + ip, WINDOW_S).then(function (n) {
      if (n > lim.max) return { ok: false, scope: 'ip', backend: 'redis' };
      if (kind !== 'submit') return { ok: true, scope: null, backend: 'redis' };
      return incr(cfg, fetchFn, 'relais:day', DAY_S).then(function (d) {
        return d > maxDay ? { ok: false, scope: 'day', backend: 'redis' } : { ok: true, scope: null, backend: 'redis' };
      });
    });
  }
  return {
    check: function (kind, ip) {
      if (!LIMITS[kind]) return Promise.reject(new Error('Type de limite inconnu : ' + kind));
      ip = ip || 'inconnue';
      if (!cfg) return Promise.resolve(viaMemory(kind, ip));
      return viaRedis(kind, ip).catch(function (e) {
        console.error('Limite : Redis indisponible, repli sur la mémoire —', e.message);
        return viaMemory(kind, ip);
      });
    }
  };
}

module.exports = { create: create, createMemory: createMemory, redisConfig: redisConfig };
