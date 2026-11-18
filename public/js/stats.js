/* Statistiques anonymes : file d'événements envoyés par lots au relais (voir statsdata.js pour ce qui est autorisé).
 * Jamais de nom, de message, de coup ni d'identifiant d'appareil. Aucune nouvelle tentative en cas d'échec : les
 * événements sont perdus, c'est voulu. Ne bloque et ne lève jamais d'exception. ES5. */
(function () {
  'use strict';
  var DEFAULT_URL = 'https://chess-relais.vercel.app/api/stats';
  var MAX = 50, DELAY = 4000;
  var queue = [], timer = null, ver = 0, verRead = false;

  function url() {
    if (typeof window.STATS_URL === 'string') return window.STATS_URL;
    var h = window.location && window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return '';
    return DEFAULT_URL;
  }

  function enabled() { return !U.store.get('stats-off', false); }

  function readVer() {
    if (verRead) return ver;
    verRead = true;
    try {
      var s = document.getElementsByTagName('script'), i, m;
      for (i = 0; i < s.length; i++) {
        m = /(?:^|\/)stats\.js\?v=(\d+)/.exec(s[i].getAttribute('src') || '');
        if (m) { ver = parseInt(m[1], 10) || 0; break; }
      }
    } catch (e) { /* ignore */ }
    return ver;
  }

  function isPwa() {
    try {
      if (window.navigator.standalone) return true;
      if (window.matchMedia) return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
    } catch (e) { /* ignore */ }
    return false;
  }

  function post(u, body) {
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(u, body)) return;
    } catch (e) { /* ignore */ }
    try {
      var x = new XMLHttpRequest();
      x.open('POST', u, true);
      x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      x.onerror = function () { /* perdu */ };
      x.send(body);
    } catch (e2) { /* ignore */ }
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    try {
      var u = url();
      if (!queue.length) return;
      if (!u || !enabled()) { queue = []; return; }
      var info = StatsData.detect(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints });
      var v = readVer();
      while (queue.length) {
        var batch = queue.splice(0, MAX);
        var p = { v: 1, b: info.b, o: info.o, pwa: isPwa(), events: batch };
        if (v > 0) p.ver = v;
        post(u, JSON.stringify(p));
      }
    } catch (e) { queue = []; }
  }

  function track(e, props) {
    try {
      if (!url() || !enabled()) return;
      var ev = { e: e }, k;
      if (props) for (k in props) if (props.hasOwnProperty(k)) ev[k] = props[k];
      ev = StatsData.clean(ev);
      if (!ev) return;
      queue.push(ev);
      if (queue.length >= MAX) { flush(); return; }
      clearTimeout(timer);
      timer = setTimeout(flush, DELAY);
    } catch (err) { /* ignore */ }
  }

  function setEnabled(on) {
    U.store.set('stats-off', !on);
    if (!on) { queue = []; clearTimeout(timer); timer = null; }
  }

  try {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); }, false);
    window.addEventListener('pagehide', flush, false);
  } catch (e) { /* ignore */ }

  // Suivi d'une session en ligne (g = 'duo' | 'multi') : un online_ok, et au plus un online_error par type
  function netSession(g) {
    var okDone = false, seen = {}, rejectMsg = null;
    function err(k, opened) {
      if (seen[k]) return;
      seen[k] = true;
      track('online_error', { k: k, ph: opened ? 'game' : 'connect', g: g });
    }
    return {
      ok: function (role) {
        if (okDone) return;
        okDone = true;
        track('online_ok', { role: role, g: g });
      },
      reject: function (msg, opened) { rejectMsg = msg; err('rejected', opened); },
      error: function (reason, opened) {
        if (reason != null && reason === rejectMsg) return;       // déjà compté comme refus
        err(StatsData.errorKind(reason), opened);
      }
    };
  }

  window.Stats = { netSession: netSession, track: track, enabled: enabled, setEnabled: setEnabled, flush: flush };
})();
