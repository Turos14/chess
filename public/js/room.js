/* Salle de jeu côté hôte : règles, pendule, sièges, nulle, abandon. ES5, sans réseau ni DOM.
 * Utilisée par l'hôte dans le navigateur (net.js) et testée sous Node.
 * Les participants sont identifiés par un identifiant client (cid) persistant, pas par l'ID de connexion :
 * ainsi un joueur garde son siège quand l'hôte change (bascule) ou quand il recharge la page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chess.js'));
  else root.Room = factory(root.Chess);
})(this, function (Chess) {
  'use strict';

  function other(c) { return c === 'w' ? 'b' : 'w'; }
  function clean(n, def) {
    n = String(n == null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 20);
    return n || def;
  }
  function normalizeTc(tc) {
    if (!tc) return null;
    var base = Math.round(Number(tc.base)), inc = Math.round(Number(tc.inc) || 0);
    if (!isFinite(base) || base < 0 || base > 36000000 || inc < 0 || inc > 300000 || base + inc <= 0) return null;
    return { base: base, inc: inc };
  }

  // opts : { code, tc, send(cid, msg), now(), restore: {state, frozen:{w,b}} }
  function Room(opts) {
    this.code = opts.code;
    this.send = opts.send;
    this.now = opts.now || function () { return new Date().getTime(); };
    this.tc = normalizeTc(opts.tc);
    this.seats = { w: null, b: null };      // {name, cid|null}
    this.spectators = {};                   // cid -> {name}
    this.conns = {};                        // cid -> true (connecté)
    this.game = new Chess.Game();
    this.clock = { w: this.tc ? this.tc.base : 0, b: this.tc ? this.tc.base : 0, turn: 'w', since: 0, running: false };
    this.result = null;
    this.drawOffer = null;
    this.declined = 0;
    this.v = 1;
    this.epoch = 0;
    this.timer = null;
    if (opts.restore) this._restore(opts.restore.state, opts.restore.frozen);
  }

  // Reprise après changement d'hôte : on repart du dernier état reçu par ce client.
  Room.prototype._restore = function (s, frozen) {
    var g = Chess.replay(Chess.START, s.moves || []);
    if (g) this.game = g;
    this.tc = normalizeTc(s.tc);
    this.seats.w = s.players.w ? { name: s.players.w, cid: null, eloStart: s.eloStart && s.eloStart.w } : null;
    this.seats.b = s.players.b ? { name: s.players.b, cid: null, eloStart: s.eloStart && s.eloStart.b } : null;
    this.result = s.status && s.status.over ? s.status : null;
    this.declined = s.declined || 0;
    this.epoch = (s.epoch || 0) + 1;
    this.v = (s.v || 1) + 1;
    if (this.tc && s.clock) {
      var src = frozen || s.clock;
      this.clock = { w: src.w, b: src.b, turn: s.clock.turn, since: this.now(), running: !!s.clock.running && !this.result };
      this._scheduleFlag();
    }
  };

  Room.prototype.seatOf = function (cid) {
    if (this.seats.w && this.seats.w.cid === cid) return 'w';
    if (this.seats.b && this.seats.b.cid === cid) return 'b';
    return null;
  };

  Room.prototype._remaining = function () {
    var c = this.clock, w = c.w, b = c.b;
    if (c.running) {
      var e = this.now() - c.since;
      if (c.turn === 'w') w -= e; else b -= e;
    }
    return { w: Math.max(0, Math.round(w)), b: Math.max(0, Math.round(b)) };
  };

  Room.prototype.stateFor = function (cid) {
    var self = this, k, spectators = 0, rem = this._remaining();
    for (k in this.spectators) if (this.conns[k]) spectators++;
    function pl(c) { return self.seats[c] ? self.seats[c].name : null; }
    function on(c) { return !!self.seats[c] && !!self.seats[c].cid && !!self.conns[self.seats[c].cid]; }
    return {
      code: this.code, v: this.v, epoch: this.epoch,
      you: this.seatOf(cid),
      players: { w: pl('w'), b: pl('b') },
      connected: { w: on('w'), b: on('b') },
      spectators: spectators,
      tc: this.tc,
      clock: this.tc ? { w: rem.w, b: rem.b, turn: this.clock.turn, running: this.clock.running, serverTime: this.now() } : null,
      moves: this.game.history.map(function (m) { return { from: m.from, to: m.to, promo: m.promo, san: m.san }; }),
      turn: this.game.turn(),
      // Elo de départ auto-déclaré par chaque joueur (utilisé seulement si son nom n'a jamais été suivi) : transite
      // par l'état synchronisé, sinon hôte et invité calculeraient chacun un résultat différent pour la même partie.
      eloStart: { w: this.seats.w ? this.seats.w.eloStart : null, b: this.seats.b ? this.seats.b.eloStart : null },
      status: this.result || { over: false },
      drawOffer: this.drawOffer,
      declined: this.declined
    };
  };

  Room.prototype._bump = function () {
    this.v++;
    for (var cid in this.conns) this.send(cid, { t: 'state', state: this.stateFor(cid) });
  };

  Room.prototype._fail = function (cid, message) {
    this.send(cid, { t: 'error', message: message });
    this.send(cid, { t: 'state', state: this.stateFor(cid) });   // resynchronise le client (annule son coup optimiste)
  };

  // Un client se présente (à la connexion, après une bascule ou un rechargement)
  // msg : {name, role:'player'|'spectator', color:'w'|'b'|'r'|undefined}
  Room.prototype.hello = function (cid, msg) {
    var role = msg.role === 'spectator' ? 'spectator' : 'player';
    var name = clean(msg.name, role === 'player' ? 'Joueur' : 'Spectateur');
    var want = msg.color, color = this.seatOf(cid), c;
    if (want === 'r') want = (this.now() & 1) ? 'w' : 'b';
    if (role === 'player') {
      if (!color && (want === 'w' || want === 'b') && this.seats[want] && this.seats[want].cid === null && this.seats[want].name === name) color = want;   // siège restauré
      if (!color) {
        var order = want === 'b' ? ['b', 'w'] : ['w', 'b'];
        for (var i = 0; i < 2; i++) { c = order[i]; if (!this.seats[c]) { color = c; break; } }
      }
      if (!color) {
        this.send(cid, { t: 'reject', message: 'Cette partie est déjà complète. Tu peux la regarder en spectateur.' });
        return false;
      }
      // Un reconnexion/reprise peut ne pas renvoyer l'Elo de départ (ex. un vieux client) : on garde alors
      // celui déjà établi pour ce siège plutôt que de l'effacer.
      var prevStart = this.seats[color] && typeof this.seats[color].eloStart === 'number' ? this.seats[color].eloStart : null;
      this.seats[color] = { name: name, cid: cid, eloStart: typeof msg.eloStart === 'number' ? msg.eloStart : prevStart };
      delete this.spectators[cid];
    } else {
      this.spectators[cid] = { name: name };
    }
    this.conns[cid] = true;
    this._bump();
    return true;
  };

  Room.prototype.leave = function (cid) {
    if (!this.conns[cid]) return;
    delete this.conns[cid];
    delete this.spectators[cid];
    this._bump();
  };

  Room.prototype.handle = function (cid, msg) {
    if (!this.conns[cid]) return;
    var color = this.seatOf(cid);
    try {
      switch (msg.t) {
        case 'move': this._move(cid, color, msg); break;
        case 'resign': this._resign(color); break;
        case 'draw': this._draw(color, msg.action); break;
        default: break;
      }
    } catch (e) {
      if (e && e.userMessage) this._fail(cid, e.userMessage); else throw e;
    }
  };

  function fail(message) { var e = new Error(message); e.userMessage = message; return e; }

  Room.prototype._needPlayer = function (color) {
    if (!color) throw fail('Tu ne joues pas cette partie');
    if (this.result) throw fail('La partie est terminée');
    if (!this.seats.w || !this.seats.b) throw fail('En attente de l’adversaire');
  };

  Room.prototype._move = function (cid, color, m) {
    this._needPlayer(color);
    if (this.game.turn() !== color) throw fail('Ce n’est pas ton tour');
    var c = this.clock;
    if (this.tc && c.running && this._remaining()[color] <= 0) {
      this._end(color === 'w' ? '0-1' : '1-0', 'timeout', other(color));
      return;
    }
    var rec = this.game.move(String(m.from), String(m.to), m.promo ? String(m.promo) : null);
    if (!rec) throw fail('Coup illégal');
    this.drawOffer = null;
    if (this.tc) {
      var now = this.now();
      if (!c.running) { c.running = true; c.turn = other(color); c.since = now; }     // la pendule démarre après le 1er coup des Blancs
      else {
        var rem = this._remaining();
        c.w = rem.w; c.b = rem.b;
        c[color] += this.tc.inc;
        c.turn = other(color); c.since = now;
      }
    }
    var st = this.game.status();
    if (st.over) this._end(st.result, st.reason, st.winner);
    else { this._scheduleFlag(); this._bump(); }
  };

  Room.prototype._resign = function (color) {
    this._needPlayer(color);
    this._end(color === 'w' ? '0-1' : '1-0', 'resign', other(color));
  };

  Room.prototype._draw = function (color, action) {
    this._needPlayer(color);
    if (action === 'offer') {
      if (this.drawOffer === other(color)) this._end('1/2-1/2', 'agreement', null);
      else if (!this.drawOffer) { this.drawOffer = color; this._bump(); }
    } else if (action === 'accept') {
      if (this.drawOffer !== other(color)) throw fail('Aucune proposition de nulle');
      this._end('1/2-1/2', 'agreement', null);
    } else if (action === 'decline') {
      if (this.drawOffer === other(color)) { this.drawOffer = null; this.declined++; this._bump(); }
    }
  };

  Room.prototype._end = function (result, reason, winner) {
    if (this.result) return;
    var c = this.clock;
    if (c.running) { var rem = this._remaining(); c.w = rem.w; c.b = rem.b; c.running = false; }
    clearTimeout(this.timer);
    this.drawOffer = null;
    this.result = { over: true, result: result, reason: reason, winner: winner };
    this._bump();
  };

  Room.prototype._scheduleFlag = function () {
    var self = this;
    clearTimeout(this.timer);
    if (!this.tc || !this.clock.running || this.result) return;
    var t = this.clock.turn, ms = this._remaining()[t];
    this.timer = setTimeout(function () {
      if (self.result || !self.clock.running) return;
      var turn = self.clock.turn;
      if (self._remaining()[turn] <= 0) self._end(turn === 'w' ? '0-1' : '1-0', 'timeout', other(turn));
      else self._scheduleFlag();
    }, ms + 30);
  };

  Room.prototype.destroy = function () { clearTimeout(this.timer); this.conns = {}; };

  return Room;
});
