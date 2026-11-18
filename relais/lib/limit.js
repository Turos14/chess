/* Limites d'envois du relais, partagées entre instances via l'API REST d'Upstash Redis (compatible Vercel KV),
 * appelée avec fetch — aucune dépendance npm. Variables : KV_REST_API_URL / KV_REST_API_TOKEN (ou
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN), MAX_PER_DAY (plafond global, défaut 20 / 24 h).
 * Sans ces variables, ou si Redis est injoignable, repli sur un compteur en mémoire (propre à l'instance, remis à
 * zéro au démarrage à froid : approximatif mais le relais continue de fonctionner).
 * Types de demande : 'submit' (par IP : 5 / 10 min, puis plafond global par jour), 'check' (par IP : 3 / 10 min,
 * pour que le diagnostic ne puisse pas épuiser le quota de l'API GitHub du jeton), 'stats' (par IP : 30 / 10 min,
 * puis plafond global STATS_MAX_PER_DAY, défaut 50000 / jour) et 'login' (connexion admin : 5 / 15 min par IP).
 * L'accès Redis lui-même est dans lib/redis.js.
 * Module sans effet de bord : le fetch, l'horloge et la mémoire sont injectables (test/relaislimit.test.js). */
'use strict';

var redis = require('./redis.js');
var redisConfig = redis.redisConfig, pipeline = redis.pipeline;

var WINDOW_S = 10 * 60, DAY_S = 24 * 60 * 60;
// Chaque type a sa fenêtre. `day` : clé du plafond global par jour (mémoire / Redis) et variable d'environnement.
var LIMITS = {
  submit: { max: 5, key: 'submit', windowS: WINDOW_S, day: { mem: 'day', redis: 'relais:day', env: 'MAX_PER_DAY', def: 20 } },
  check: { max: 3, key: 'check', windowS: WINDOW_S },
  stats: { max: 30, key: 'stats', windowS: WINDOW_S, day: { mem: 'statsday', redis: 'relais:statsday', env: 'STATS_MAX_PER_DAY', def: 50000 } },
  login: { max: 5, key: 'login', windowS: 15 * 60 }
};

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
  function maxDay(lim) {
    var n = parseInt(env[lim.day.env], 10);
    return n > 0 ? n : lim.day.def;
  }
  function now() { return opts.now ? opts.now() : Date.now(); }
  function fetchFn() { return (opts.fetch || fetch).apply(null, arguments); }

  function viaMemory(kind, ip) {
    var lim = LIMITS[kind];
    if (!memory.hit(lim.key + ':' + ip, lim.max, lim.windowS * 1000, now())) return { ok: false, scope: 'ip', backend: 'memory' };
    if (lim.day && !memory.hit(lim.day.mem, maxDay(lim), DAY_S * 1000, now())) return { ok: false, scope: 'day', backend: 'memory' };
    return { ok: true, scope: null, backend: 'memory' };
  }
  function viaRedis(kind, ip) {
    var lim = LIMITS[kind];
    return incr(cfg, fetchFn, 'relais:' + lim.key + ':' + ip, lim.windowS).then(function (n) {
      if (n > lim.max) return { ok: false, scope: 'ip', backend: 'redis' };
      if (!lim.day) return { ok: true, scope: null, backend: 'redis' };
      return incr(cfg, fetchFn, lim.day.redis, DAY_S).then(function (d) {
        return d > maxDay(lim) ? { ok: false, scope: 'day', backend: 'redis' } : { ok: true, scope: null, backend: 'redis' };
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
