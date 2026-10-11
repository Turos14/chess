/* Réseau pair-à-pair (WebRTC via PeerJS), comme l'app poker :
 *  - l'hôte enregistre l'identifiant « echecs-v1-<CODE> » auprès du serveur de mise en relation PeerJS ;
 *  - les autres (joueur adverse, spectateurs) se connectent à cet identifiant ;
 *  - si l'hôte disparaît, chacun retente d'enregistrer l'identifiant (délai aléatoire croissant) : le premier qui y
 *    arrive devient le nouvel hôte et repart du dernier état reçu, les autres se reconnectent à lui.
 * L'hôte fait tourner Room (public/js/room.js) : règles, pendule, sièges. */
(function () {
  'use strict';
  var PREFIX = 'echecs-v1-';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var T_PEER = 12000, T_CONNECT = 8000, HEARTBEAT = 2000, PRESENCE = 7000, RETRY_BASE = 500, RETRY_MAX = 8000;

  var Net = {};

  Net.newCode = function () {
    var s = '', i;
    for (i = 0; i < 5; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  };
  Net.newId = function () {
    var s = '', i;
    for (i = 0; i < 16; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  };

  // Options PeerJS : serveur public par défaut ; personnalisable via window.PEER_CONFIG ou ?peer=hote:port (tests)
  function peerOptions() {
    var o = {}, k, cfg = window.PEER_CONFIG || {};
    for (k in cfg) o[k] = cfg[k];
    var m = /[?&]peer=([^&]+)/.exec(window.location.search || '');
    if (m) {
      var hp = decodeURIComponent(m[1]).split(':');
      o.host = hp[0]; o.port = parseInt(hp[1], 10) || 9000; o.path = '/'; o.secure = false;
    }
    o.debug = 0;
    return o;
  }

  Net.supported = function () {
    return !!(window.RTCPeerConnection || window.webkitRTCPeerConnection);
  };

  var libState = 0, libWaiters = [];
  Net.loadLib = function (cb) {
    if (window.Peer) { cb(null); return; }
    libWaiters.push(cb);
    if (libState === 1) return;
    libState = 1;
    var s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js?v=6';
    s.onload = function () {
      var list = libWaiters; libWaiters = []; libState = 0;
      list.forEach(function (f) { f(window.Peer ? null : new Error('PeerJS indisponible')); });
    };
    s.onerror = function () {
      var list = libWaiters; libWaiters = []; libState = 0;
      list.forEach(function (f) { f(new Error('Impossible de charger la bibliothèque réseau (navigateur trop ancien ?)')); });
    };
    document.head.appendChild(s);
  };

  function explain(e) {
    var t = e && e.type;
    if (t === 'browser-incompatible') return 'Ce navigateur ne gère pas WebRTC.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Serveur de mise en relation injoignable.';
    if (t === 'peer-unavailable') return 'Partie introuvable ou hôte hors ligne.';
    if (t === 'webrtc') return 'La connexion directe a échoué.';
    return (e && e.message) || 'Connexion interrompue.';
  }

  // Ouvre un Peer (avec ou sans identifiant imposé) ; cb(err, peer)
  function openPeer(id, cb) {
    var done = false, p;
    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { try { p.destroy(); } catch (e) { /* ignore */ } cb(err); }
      else { p.off('error', onErr); cb(null, p); }
    }
    function onErr(e) { finish(e); }
    try { p = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions()); }
    catch (e) { cb(e); return; }
    var timer = setTimeout(function () { finish(new Error('Délai dépassé lors de la connexion au serveur de mise en relation.')); }, T_PEER);
    p.on('open', function () { finish(null); });
    p.on('error', onErr);
  }

  /* opts : {
   *   code, cid, name, role:'player'|'spectator', color, tc,
   *   mode:'create'|'join'|'resume', lastState,
   *   frozen(): {w,b}|null  (temps figé à l'instant où l'hôte est perdu),
   *   on: { state(s), error(msg), reject(msg), status({kind, role, reason}) } } */
  function Session(opts) {
    this.o = opts;
    this.code = opts.code;
    this.cid = opts.cid;
    this.role = null;              // 'host' | 'guest'
    this.peer = null; this.conn = null; this.room = null;
    this.hostConns = {};           // cid -> {conn, seen}
    this.closed = false; this.lost = false;
    this.retries = 0; this.retryTimer = null; this.beat = null;
    this.hostSeen = 0;
    this.lastState = opts.lastState || null;
    this.frozen = null;
    this.gen = 0;
    var self = this;
    this._onHide = function () { self.leave(true); };
    window.addEventListener('pagehide', this._onHide, false);
  }

  Session.prototype._status = function (kind, reason) {
    if (this.o.on.status) this.o.on.status({ kind: kind, role: this.role, reason: reason || null });
  };

  Session.prototype.open = function (mode) {
    var self = this, gen = ++this.gen;
    if (this.closed) return;
    this._status('connecting');
    function alive() { return !self.closed && gen === self.gen; }
    function asGuest() {
      openPeer(PREFIX + self.code + '-g-' + Net.newId(), function (err, peer) {
        if (err) { openPeer(null, function (e2, p2) { if (e2) fail(e2); else connect(p2); }); return; }
        connect(peer);
      });
    }
    function connect(peer) {
      if (!alive()) { peer.destroy(); return; }
      var conn = peer.connect(PREFIX + self.code, { reliable: true, serialization: 'json' });
      var timer = setTimeout(function () { bad(new Error('L’hôte de la partie ne répond pas.')); }, T_CONNECT);
      function bad(e) {
        clearTimeout(timer);
        peer.destroy();
        if (!alive()) return;
        if (mode === 'join') self._fatal(e && e.type === 'peer-unavailable' ? 'Partie introuvable. Vérifie le code (l’hôte doit être connecté).' : explain(e));
        else fail(e);
      }
      conn.on('open', function () {
        clearTimeout(timer);
        if (!alive()) { peer.destroy(); return; }
        peer.removeAllListeners('error');
        self._asGuest(peer, conn);
      });
      conn.on('error', bad);
      peer.on('error', bad);
    }
    function fail(e) {
      if (!alive()) return;
      if (mode === 'resume') self._scheduleRetry(explain(e));
      else self._fatal(explain(e));
    }
    function asHost(code, tries) {
      openPeer(PREFIX + code, function (err, peer) {
        if (!alive()) { if (peer) peer.destroy(); return; }
        if (err) {
          if (err.type === 'unavailable-id') {
            if (mode === 'create') {
              if (tries < 5) { self.code = Net.newCode(); asHost(self.code, tries + 1); }
              else self._fatal('Impossible de créer la partie (code déjà utilisé).');
            } else asGuest();
            return;
          }
          fail(err);
          return;
        }
        self._asHost(peer, mode);
      });
    }
    if (mode === 'join') asGuest();
    else asHost(this.code, 0);
  };

  Session.prototype._fatal = function (reason) {
    this._teardown();
    this._status('failed', reason);
  };

  /* ---------- Rôle hôte ---------- */
  Session.prototype._asHost = function (peer, mode) {
    var self = this, o = this.o;
    this.role = 'host'; this.peer = peer; this.retries = 0; this.lost = false;
    var restore = null;
    if (mode === 'resume') {
      if (!this.lastState) { this._fatal('Impossible de reprendre cette partie : aucun état sauvegardé.'); return; }
      restore = { state: this.lastState, frozen: this.frozen };
    }
    this.room = new window.Room({
      code: this.code, tc: o.tc, restore: restore,
      send: function (cid, msg) {
        if (cid === self.cid) { self._deliver(msg); return; }
        var h = self.hostConns[cid];
        if (h && h.conn.open) h.conn.send(msg);
      }
    });
    peer.on('connection', function (conn) { self._accept(conn); });
    peer.on('disconnected', function () { if (!self.closed && !peer.destroyed) peer.reconnect(); });
    peer.on('error', function (e) { if (!self.closed && e && e.type !== 'peer-unavailable') self._status('reconnecting', explain(e)); });
    this.beat = setInterval(function () { self._hostTick(); }, HEARTBEAT);
    this._status('online');
    this.room.hello(this.cid, { name: o.name, role: o.role, color: mode === 'resume' ? (o.color || undefined) : o.color, eloStart: o.startElo });
  };

  Session.prototype._accept = function (conn) {
    var self = this;
    conn.on('data', function (d) {
      if (!d) return;
      if (d.__ping) { if (conn._cid && self.hostConns[conn._cid]) self.hostConns[conn._cid].seen = new Date().getTime(); return; }
      if (d.t === 'hello') {
        var cid = String(d.cid || '').slice(0, 40);
        if (!cid || cid === self.cid) return;
        var old = self.hostConns[cid];
        if (old && old.conn !== conn) { old.conn._cid = null; try { old.conn.close(); } catch (e) { /* ignore */ } }
        conn._cid = cid;
        self.hostConns[cid] = { conn: conn, seen: new Date().getTime() };
        if (!self.room.hello(cid, d)) {
          setTimeout(function () { try { conn.close(); } catch (e) { /* ignore */ } delete self.hostConns[cid]; }, 300);
        }
        return;
      }
      if (conn._cid) self.room.handle(conn._cid, d);
    });
    conn.on('close', function () { self._dropGuest(conn); });
    conn.on('error', function () { self._dropGuest(conn); });
  };

  Session.prototype._dropGuest = function (conn) {
    var cid = conn._cid;
    if (!cid || !this.hostConns[cid] || this.hostConns[cid].conn !== conn) return;
    delete this.hostConns[cid];
    if (this.room) this.room.leave(cid);
  };

  Session.prototype._hostTick = function () {
    var now = new Date().getTime(), cid;
    for (cid in this.hostConns) {
      var h = this.hostConns[cid];
      if (h.conn.open) h.conn.send({ __ping: 1 });
      if (now - h.seen > PRESENCE) { try { h.conn.close(); } catch (e) { /* ignore */ } this._dropGuest(h.conn); }
    }
  };

  Session.prototype._deliver = function (msg) {
    var on = this.o.on;
    if (msg.t === 'state') {
      this.lastState = msg.state;
      this.o.color = msg.state.you;                       // siège actuel : sert si on devient l'hôte plus tard
      this.o.role = msg.state.you ? 'player' : 'spectator';
      if (on.state) on.state(msg.state);
    }
    else if (msg.t === 'error') { if (on.error) on.error(msg.message); }
    else if (msg.t === 'reject') { if (on.reject) on.reject(msg.message); }
  };

  /* ---------- Rôle invité ---------- */
  Session.prototype._asGuest = function (peer, conn) {
    var self = this, o = this.o;
    this.role = 'guest'; this.peer = peer; this.conn = conn; this.retries = 0; this.lost = false;
    this.hostSeen = new Date().getTime();
    conn.on('data', function (d) {
      if (!d) return;
      self.hostSeen = new Date().getTime();
      if (d.__ping) return;
      if (d.t === 'bye') { self._hostLost('L’hôte a quitté la partie.'); return; }
      if (d.t === 'reject') { self._deliver(d); self._fatal(d.message); return; }
      self._deliver(d);
    });
    conn.on('close', function () { self._hostLost('L’hôte a quitté la partie.'); });
    conn.on('error', function (e) { self._hostLost(explain(e)); });
    peer.on('error', function (e) { if (e && e.type === 'peer-unavailable') self._hostLost(explain(e)); });
    peer.on('disconnected', function () { if (!self.closed && !peer.destroyed) peer.reconnect(); });
    this.beat = setInterval(function () {
      if (conn.open) conn.send({ __ping: 1 });
      if (new Date().getTime() - self.hostSeen > PRESENCE) self._hostLost('Connexion perdue avec l’hôte.');
    }, HEARTBEAT);
    this._status('online');
    conn.send({ t: 'hello', cid: this.cid, name: o.name, role: o.role, color: o.color || undefined, eloStart: o.startElo });
  };

  Session.prototype._hostLost = function (reason) {
    if (this.closed || this.lost) return;
    this.lost = true;
    this.frozen = this.o.frozen ? this.o.frozen() : null;
    this._scheduleRetry(reason);
  };

  Session.prototype._teardown = function () {
    clearInterval(this.beat); this.beat = null;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    this.gen++;
    var peer = this.peer, conn = this.conn, room = this.room;
    this.peer = null; this.conn = null; this.room = null; this.hostConns = {};
    if (room) room.destroy();
    try { if (conn) conn.close(); } catch (e) { /* ignore */ }
    try { if (peer) peer.destroy(); } catch (e2) { /* ignore */ }
  };

  Session.prototype._scheduleRetry = function (reason) {
    var self = this;
    if (this.closed || this.retryTimer) return;
    this._teardown();
    this.role = null;
    this._status('reconnecting', reason);
    var d = Math.min(RETRY_BASE * Math.pow(2, this.retries), RETRY_MAX) * (0.75 + Math.random() * 0.5);
    if (this.o.role === 'spectator') d += 1500;       // les joueurs passent avant les spectateurs pour reprendre l'hébergement
    this.retries++;
    this.retryTimer = setTimeout(function () { self.retryTimer = null; self.open('resume'); }, d);
  };

  /* ---------- API ---------- */
  // Envoie une action à l'hôte (ou la traite directement si on est l'hôte). false si non connecté.
  Session.prototype.send = function (msg) {
    if (this.role === 'host' && this.room) { this.room.handle(this.cid, msg); return true; }
    if (this.role === 'guest' && this.conn && this.conn.open) { this.conn.send(msg); return true; }
    return false;
  };

  Session.prototype.isHost = function () { return this.role === 'host'; };

  Session.prototype.leave = function (quick) {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this._onHide, false);
    var cid, conns = [];
    for (cid in this.hostConns) if (this.hostConns[cid].conn.open) {
      try { this.hostConns[cid].conn.send({ t: 'bye' }); } catch (e) { /* ignore */ }
      conns.push(this.hostConns[cid].conn);
    }
    var self = this;
    function finish() { conns.forEach(function (c) { try { c.close(); } catch (e) { /* ignore */ } }); self._teardown(); }
    if (conns.length && !quick) setTimeout(finish, 150); else finish();
  };

  Net.Session = Session;
  window.Net = Net;
})();
