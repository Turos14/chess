/* Parties en direct : envoie les coups des parties en cours à l'administrateur (relais, POST /api/live), SANS aucun
 * nom ni pseudo, et seulement si le joueur a accepté (fenêtre à la première utilisation, modifiable dans « Règles »).
 * Refus ou pas encore de réponse = rien n'est envoyé. Corps construit par livedata.js (module pur). Regroupe les envois
 * (au plus un toutes les 2 s par partie), n'envoie que ce qui a changé, ne lève jamais d'exception, aucune relance. ES5. */
(function () {
  'use strict';
  var DEFAULT_URL = 'https://chess-relais.vercel.app/api/live';
  var DELAY = 2000, KEEP = 30;
  var games = {};       // gid -> {key, at (dernier envoi), body (en attente), timer, ended}
  var order = [];       // gid connus (les plus récents en dernier), pour « stop » à la désactivation
  var asking = false;

  function url() {
    if (typeof window.LIVE_URL === 'string') return window.LIVE_URL;
    var h = window.location && window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return '';
    return DEFAULT_URL;
  }

  function enabled() { return !!U.store.get('live-share', false); }
  function asked() { return !!U.store.get('live-asked', false); }

  function post(body, beacon) {
    try {
      var u = url();
      if (!u || !body) return;
      var s = JSON.stringify(body);
      if (beacon) {
        try { if (navigator.sendBeacon && navigator.sendBeacon(u, s)) return; } catch (e) { /* ignore */ }
      }
      var x = new XMLHttpRequest();
      x.open('POST', u, true);
      x.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
      x.onerror = function () { /* perdu */ };
      x.send(s);
    } catch (e2) { /* ignore */ }
  }

  function known(gid) {
    var g = games[gid];
    if (g) return g;
    g = games[gid] = { key: null, at: 0, body: null, timer: null, ended: false };
    order.push(gid);
    while (order.length > KEEP) { var old = order.shift(); if (games[old]) clearTimeout(games[old].timer); delete games[old]; }
    return g;
  }

  function flushOne(gid, beacon) {
    var g = games[gid];
    if (!g || !g.body) return;
    clearTimeout(g.timer);
    g.timer = null;
    var b = g.body;
    g.body = null;
    g.at = new Date().getTime();
    post(b, beacon);
  }

  function flushAll(beacon) {
    try {
      var i;
      for (i = 0; i < order.length; i++) flushOne(order[i], beacon);
    } catch (e) { /* ignore */ }
  }

  function queue(gid, key, body, now) {
    var g = known(gid);
    g.key = key;
    g.body = body;
    if (now || new Date().getTime() - g.at >= DELAY) { flushOne(gid, false); return; }
    if (!g.timer) g.timer = setTimeout(function () { try { flushOne(gid, false); } catch (e) { /* ignore */ } }, Math.max(50, DELAY - (new Date().getTime() - g.at)));
  }

  function sendStop(gid) {
    var g = games[gid];
    if (!g) return;
    clearTimeout(g.timer);
    delete games[gid];
    var i = order.indexOf(gid);
    if (i >= 0) order.splice(i, 1);
    post(LiveData.buildStop(gid), false);
  }

  function setEnabled(on) {
    U.store.set('live-share', !!on);
    U.store.set('live-asked', true);
    if (!on) {
      try {
        var list = order.slice(), i;
        for (i = 0; i < list.length; i++) sendStop(list[i]);
      } catch (e) { /* ignore */ }
    }
  }

  // Description de la partie d'un contrôleur : {gid, mode, multi, game} ou null si elle n'est pas partageable
  function describe(ctrl) {
    var g = ctrl && ctrl.game;
    if (!g) return null;
    var multi = !!g.variant && g.n != null;
    var m = ctrl.mode;
    if (multi ? (m !== 'local' && m !== 'online') : (m !== 'local' && m !== 'ai' && m !== 'online')) return null;
    if (m === 'online') {
      if (!ctrl.liveGid) return null;
    } else if (!ctrl.liveGid) ctrl.liveGid = LiveData.newGid();
    return { gid: ctrl.liveGid, mode: m, multi: multi, game: g };
  }

  function build(ctrl, d, quit) {
    var g = d.game, res;
    if (d.multi) {
      return LiveData.buildMulti({ gid: d.gid, mode: d.mode, variant: g.variant, teams: !!g.teams, history: g.history,
        over: !!g.over, winners: g.winners, quit: quit });
    }
    res = ctrl.getResult ? ctrl.getResult() : null;
    var tc = ctrl.clock && ctrl.clock.cfg && ctrl.clock.cfg.w ? ctrl.clock.cfg.w : null;
    return LiveData.buildTwo({ gid: d.gid, mode: d.mode, variant: g.startFen && g.startFen !== Chess.START ? '960' : 'classic',
      startFen: g.startFen, history: g.history, tc: tc, result: res, quit: quit });
  }

  function keyOf(body) {
    return body.mv.length + ':' + (body.end ? body.end.r + ':' + (body.end.w == null ? '' : body.end.w) : '');
  }

  // Appelée à chaque rafraîchissement de l'écran de partie
  function sync(ctrl) {
    try {
      if (!ctrl || !enabled() || !url()) return;
      var d = describe(ctrl);
      if (!d) {
        // En ligne : le partage a pris fin (un joueur a refusé, siège libéré) -> retire la partie du direct
        if (ctrl.liveShared) { var old = ctrl.liveShared; ctrl.liveShared = null; sendStop(old); }
        return;
      }
      var body = build(ctrl, d, false);
      if (!body) return;
      var key = keyOf(body), g = games[d.gid];
      if (g && g.key === key) return;
      ctrl.liveShared = d.gid;
      queue(d.gid, key, body, !!body.end);
    } catch (e) { /* ignore */ }
  }

  // Appelée à la sortie de l'écran de partie : une partie quittée avant la fin est marquée « quittée »
  function closed(ctrl) {
    try {
      if (!ctrl || !enabled() || !url()) return;
      var d = describe(ctrl);
      if (!d || !games[d.gid]) return;
      var over = d.multi ? !!d.game.over : !!(ctrl.getResult && ctrl.getResult());
      if (over) { flushOne(d.gid, false); return; }
      var body = build(ctrl, d, true);
      if (body) queue(d.gid, keyOf(body), body, true);
    } catch (e) { /* ignore */ }
  }

  // Fenêtre de consentement à la première utilisation
  function ask(done) {
    try {
      if (asked() || asking || U.dialogOpen()) { if (done) done(); return; }
      asking = true;
      var node = U.el('div', 'live-ask');
      node.appendChild(U.el('p', null, 'L’administrateur de l’appli peut voir en direct les coups de tes parties en cours (locales, contre l’IA et en ligne), sans aucun nom ni pseudo. Cela sert à repérer les bugs et à modérer.'));
      node.appendChild(U.el('p', null, 'Rien n’est gardé au-delà de 15 minutes après la fin de la partie. Tu pourras changer d’avis à tout moment dans l’écran « Règles ». En ligne, la partie n’est partagée que si les deux joueurs ont accepté.'));
      function answer(on) { asking = false; setEnabled(on); if (done) done(on); }
      U.dialog({ title: 'Partager tes parties en direct ?', node: node, buttons: [
        { label: 'Non merci', fn: function () { answer(false); } },
        { label: 'Accepter', primary: true, fn: function () { answer(true); } }
      ] });
    } catch (e) { asking = false; if (done) done(); }
  }

  try {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAll(true); }, false);
    window.addEventListener('pagehide', function () { flushAll(true); }, false);
  } catch (e) { /* ignore */ }

  window.Live = { enabled: enabled, setEnabled: setEnabled, asked: asked, ask: ask, sync: sync, closed: closed };
})();
