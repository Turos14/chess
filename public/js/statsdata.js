/* Statistiques anonymes : détection du navigateur / système et liste des événements autorisés (identique à celle du
 * serveur, relais/lib/stats.js). ES5, sans DOM ni réseau ; testé sous Node. L'envoi est dans stats.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StatsData = factory();
})(this, function () {
  'use strict';

  var MODES = ['local', 'ai', 'online', 'spectator', 'multi_local', 'multi_online'];
  var VARIANTS = ['classic', '960', 'yalta', 'cross4'];
  var REASONS = ['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty', 'resign', 'timeout', 'agreement', 'multi'];
  var GROUPS = ['duo', 'multi'];
  var EVENTS = {
    app_open: {},
    game_start: { m: MODES, 'var': VARIANTS },
    game_end: { m: MODES, r: REASONS },
    puzzle_open: {},
    puzzle_solved: {},
    online_ok: { role: ['host', 'guest'], g: GROUPS },
    online_error: { k: ['server', 'peer_unavailable', 'webrtc', 'timeout', 'host_lost', 'rejected', 'other'], ph: ['connect', 'game'], g: GROUPS },
    chat_msg: { g: GROUPS }
  };
  var BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'samsung', 'other'];
  var SYSTEMS = ['windows', 'mac', 'linux', 'android', 'ios', 'other'];

  function has(list, v) { return list.indexOf(v) >= 0; }

  // info : { maxTouchPoints } (iPadOS se présente comme un Mac mais a un écran tactile)
  function detect(ua, info) {
    ua = String(ua || '');
    var touch = Number(info && info.maxTouchPoints) || 0, b = 'other', o = 'other';
    if (/iPhone|iPad|iPod/.test(ua)) o = 'ios';
    else if (/Android/.test(ua)) o = 'android';
    else if (/Windows/.test(ua)) o = 'windows';
    else if (/Macintosh|Mac OS X/.test(ua)) o = touch > 1 ? 'ios' : 'mac';
    else if (/CrOS/.test(ua)) o = 'other';
    else if (/Linux|X11/.test(ua)) o = 'linux';
    if (/\bEdg(e|A|iOS)?\//.test(ua)) b = 'edge';
    else if (/\bOPR\/|Opera|OPiOS/.test(ua)) b = 'opera';
    else if (/SamsungBrowser/.test(ua)) b = 'samsung';
    else if (/Firefox\/|FxiOS/.test(ua)) b = 'firefox';
    else if (/Chrome\/|CriOS/.test(ua)) b = 'chrome';
    else if (/Safari\//.test(ua)) b = 'safari';
    return { b: b, o: o };
  }

  // Événement réduit aux propriétés autorisées, ou null s'il ne l'est pas
  function clean(ev) {
    if (!ev || typeof ev !== 'object' || typeof ev.e !== 'string' || !EVENTS.hasOwnProperty(ev.e)) return null;
    var spec = EVENTS[ev.e], out = { e: ev.e }, k;
    for (k in spec) {
      if (!spec.hasOwnProperty(k) || !ev.hasOwnProperty(k)) continue;
      var v = String(ev[k]);
      if (has(spec[k], v)) out[k] = v;
    }
    return out;
  }

  // Type d'erreur réseau déduit du message affiché au joueur (net.js, explain())
  function errorKind(msg) {
    msg = String(msg || '');
    if (/Serveur de mise en relation injoignable/.test(msg)) return 'server';
    if (/Partie introuvable/.test(msg)) return 'peer_unavailable';
    if (/connexion directe a échoué/.test(msg)) return 'webrtc';
    if (/Délai dépassé|ne répond pas/.test(msg)) return 'timeout';
    if (/hôte a quitté|Connexion perdue avec l.hôte/.test(msg)) return 'host_lost';
    return 'other';
  }

  return { detect: detect, clean: clean, errorKind: errorKind, EVENTS: EVENTS, BROWSERS: BROWSERS, SYSTEMS: SYSTEMS };
});
