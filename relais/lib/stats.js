/* Statistiques anonymes : validation du corps reçu de l'appli et calcul des compteurs à incrémenter. Module pur
 * (aucun réseau ici), testé par test/relaisstats.test.js. Seuls des compteurs agrégés par jour UTC sont gardés :
 * jamais de nom, de message de chat, de coup, de contenu de partie, d'identifiant d'appareil ni d'IP.
 * Toute valeur ou événement hors liste est ignoré sans erreur. */
'use strict';

var BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'samsung', 'other'];
var SYSTEMS = ['windows', 'mac', 'linux', 'android', 'ios', 'other'];
var MODES = ['local', 'ai', 'online', 'spectator', 'multi_local', 'multi_online'];
var GAMES = ['duo', 'multi'];

// Événements autorisés et, pour chacun, les seules propriétés lues (avec leurs valeurs permises).
var EVENTS = {
  app_open: {},
  game_start: { m: MODES, 'var': ['classic', '960', 'yalta', 'cross4'] },
  game_end: { m: MODES, r: ['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty', 'resign', 'timeout', 'agreement', 'multi'] },
  puzzle_open: {},
  puzzle_solved: {},
  online_ok: { role: ['host', 'guest'], g: GAMES },
  online_error: { k: ['server', 'peer_unavailable', 'webrtc', 'timeout', 'host_lost', 'rejected', 'other'], ph: ['connect', 'game'], g: GAMES },
  chat_msg: { g: GAMES }
};
// Événements pour lesquels on compte aussi navigateur et système.
var WITH_ENV = { app_open: 1, online_ok: 1, online_error: 1 };
var MAX_EVENTS = 50;

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function allowed(list, v) { return typeof v === 'string' && list.indexOf(v) >= 0; }

// data : objet déjà décodé. Retourne { error } ou { fields: { champ: n }, req: 1 }.
function parse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Corps illisible.' };
  if (data.v !== 1) return { error: 'Version inconnue.' };
  if (!Array.isArray(data.events) || data.events.length < 1 || data.events.length > MAX_EVENTS) return { error: 'Liste d’événements invalide.' };
  var b = allowed(BROWSERS, data.b) ? data.b : null;
  var o = allowed(SYSTEMS, data.o) ? data.o : null;
  var ver = typeof data.ver === 'number' && data.ver % 1 === 0 && data.ver >= 1 && data.ver <= 99999 ? data.ver : null;
  var pwa = typeof data.pwa === 'boolean' ? data.pwa : null;
  var fields = {};
  function add(name) { fields[name] = (fields[name] || 0) + 1; }
  data.events.forEach(function (ev) {
    if (!ev || typeof ev !== 'object' || typeof ev.e !== 'string' || !has(EVENTS, ev.e)) return;
    var spec = EVENTS[ev.e], base = 'e=' + ev.e;
    add(base);
    Object.keys(spec).forEach(function (p) {
      if (allowed(spec[p], ev[p])) add(base + '|' + p + '=' + ev[p]);
    });
    if (has(WITH_ENV, ev.e)) {
      if (b) add(base + '|b=' + b);
      if (o) add(base + '|o=' + o);
    }
    if (ev.e === 'app_open') {
      if (pwa !== null) add(base + '|pwa=' + (pwa ? 1 : 0));
      if (ver !== null) add(base + '|ver=' + ver);
    }
  });
  return { fields: fields, req: 1 };
}

// « YYYY-MM-DD » (UTC) d'un horodatage en millisecondes.
function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

// Commandes Redis (pipeline) pour enregistrer le résultat de parse() à la date donnée. Aucune expiration.
function commands(day, parsed) {
  var key = 'stats:d:' + day;
  var cmds = Object.keys(parsed.fields).map(function (f) { return ['HINCRBY', key, f, parsed.fields[f]]; });
  cmds.push(['HINCRBY', key, 'req', 1]);
  cmds.push(['SADD', 'stats:days', day]);
  return cmds;
}

// Résultat d'un HGETALL de l'API REST ([champ, valeur, ...]) -> { champ: nombre }.
function hashToObject(arr) {
  var out = {}, i;
  if (!arr) return out;
  if (!Array.isArray(arr)) {   // tolère aussi un objet { champ: valeur }
    Object.keys(arr).forEach(function (k) { out[k] = Number(arr[k]) || 0; });
    return out;
  }
  for (i = 0; i + 1 < arr.length; i += 2) out[String(arr[i])] = Number(arr[i + 1]) || 0;
  return out;
}

module.exports = {
  parse: parse, commands: commands, dayOf: dayOf, hashToObject: hashToObject, MAX_EVENTS: MAX_EVENTS,
  EVENTS: EVENTS, BROWSERS: BROWSERS, SYSTEMS: SYSTEMS
};
