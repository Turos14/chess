/* Salle de jeu côté hôte pour les échecs à plusieurs (3 ou 4 joueurs) : sièges, coups, abandons. ES5, sans réseau ni
 * DOM ; utilisée par l'hôte via net.js (opts.makeRoom) et testée sous Node. Même principe que room.js : participants
 * identifiés par un identifiant client persistant (cid), état complet diffusé à chaque changement, reprise par un autre
 * appareil (bascule d'hôte) à partir du dernier état reçu.
 * La partie commence quand tous les sièges sont pris. Pas de pendule (v1). Un joueur déconnecté peut être retiré par
 * les autres (« kick » = abandon forcé), sinon la partie resterait bloquée à son tour. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./multichess.js'));
  else root.MultiRoom = factory(root.MultiChess);
})(this, function (MultiChess) {
  'use strict';

  function clean(n, def) {
    n = String(n == null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').replace(/^\s+|\s+$/g, '').slice(0, 20);
    return n || def;
  }
  function fail(message) { var e = new Error(message); e.userMessage = message; return e; }

  // opts : { code, variant, teams, send(cid, msg), restore: {state} }
  function MultiRoom(opts) {
    var r = opts.restore && opts.restore.state;
    this.code = opts.code;
    this.send = opts.send;
    this.variant = r ? r.variant : opts.variant;
    this.teams = r ? !!r.teams : !!opts.teams;
    if (!MultiChess.VARIANTS[this.variant]) this.variant = 'yalta';
    this.game = new MultiChess.Game(this.variant, { teams: this.teams });
    this.n = this.game.n;
    this.seats = [];                      // {name, cid|null}
    for (var i = 0; i < this.n; i++) this.seats.push(null);
    this.spectators = {};
    this.conns = {};
    this.v = 1;
    this.epoch = 0;
    if (r) this._restore(r);
  }

  MultiRoom.prototype._restore = function (s) {
    var g = MultiChess.replay(this.variant, { teams: this.teams }, s.actions || []);
    if (g) this.game = g;
    for (var i = 0; i < this.n; i++) this.seats[i] = s.players && s.players[i] ? { name: s.players[i], cid: null } : null;
    this.epoch = (s.epoch || 0) + 1;
    this.v = (s.v || 1) + 1;
  };

  MultiRoom.prototype.seatOf = function (cid) {
    for (var i = 0; i < this.n; i++) if (this.seats[i] && this.seats[i].cid === cid) return i;
    return null;
  };

  MultiRoom.prototype.full = function () {
    for (var i = 0; i < this.n; i++) if (!this.seats[i]) return false;
    return true;
  };

  MultiRoom.prototype.stateFor = function (cid) {
    var self = this, k, spectators = 0, players = [], connected = [], i;
    for (k in this.spectators) if (this.conns[k]) spectators++;
    for (i = 0; i < this.n; i++) {
      players.push(this.seats[i] ? this.seats[i].name : null);
      connected.push(!!this.seats[i] && !!this.seats[i].cid && !!self.conns[this.seats[i].cid]);
    }
    return {
      code: this.code, v: this.v, epoch: this.epoch, variant: this.variant, teams: this.teams,
      you: this.seatOf(cid), players: players, connected: connected, spectators: spectators,
      actions: this.game.history.map(function (a) { return a.resign != null ? { resign: a.resign } : { from: a.from, to: a.to, promo: a.promo }; }),
      status: { over: this.game.over, winners: this.game.winners }
    };
  };

  MultiRoom.prototype._bump = function () {
    this.v++;
    for (var cid in this.conns) this.send(cid, { t: 'state', state: this.stateFor(cid) });
  };

  MultiRoom.prototype._fail = function (cid, message) {
    this.send(cid, { t: 'error', message: message });
    this.send(cid, { t: 'state', state: this.stateFor(cid) });
  };

  // msg : {name, role:'player'|'spectator', color: siège voulu (n° de camp) ou undefined}
  MultiRoom.prototype.hello = function (cid, msg) {
    var role = msg.role === 'spectator' ? 'spectator' : 'player';
    var name = clean(msg.name, role === 'player' ? 'Joueur' : 'Spectateur');
    var seat = this.seatOf(cid), want = typeof msg.color === 'number' ? msg.color : null, i;
    if (role === 'player') {
      // Siège restauré après une bascule d'hôte : même nom, siège libéré (cid inconnu)
      if (seat === null && want !== null && this.seats[want] && this.seats[want].cid === null && this.seats[want].name === name) seat = want;
      if (seat === null) for (i = 0; i < this.n; i++) if (this.seats[i] && this.seats[i].cid === null && this.seats[i].name === name) { seat = i; break; }
      if (seat === null && want !== null && want >= 0 && want < this.n && !this.seats[want]) seat = want;
      if (seat === null) for (i = 0; i < this.n; i++) if (!this.seats[i]) { seat = i; break; }
      if (seat === null) {
        this.send(cid, { t: 'reject', message: 'Cette partie est déjà complète. Tu peux la regarder en spectateur.' });
        return false;
      }
      this.seats[seat] = { name: name, cid: cid };
      delete this.spectators[cid];
    } else {
      this.spectators[cid] = { name: name };
    }
    this.conns[cid] = true;
    this._bump();
    return true;
  };

  MultiRoom.prototype.leave = function (cid) {
    if (!this.conns[cid]) return;
    delete this.conns[cid];
    delete this.spectators[cid];
    this._bump();
  };

  MultiRoom.prototype.handle = function (cid, msg) {
    if (!this.conns[cid]) return;
    var seat = this.seatOf(cid);
    try {
      if (seat === null) throw fail('Tu ne joues pas cette partie');
      if (this.game.over) throw fail('La partie est terminée');
      if (!this.full()) throw fail('En attente des autres joueurs');
      if (msg.t === 'move') {
        if (this.game.turn !== seat) throw fail('Ce n’est pas ton tour');
        if (!this.game.move(Number(msg.from), Number(msg.to), msg.promo ? String(msg.promo) : null)) throw fail('Coup illégal');
      } else if (msg.t === 'resign') {
        if (!this.game.resign(seat)) throw fail('Tu as déjà quitté la partie');
      } else if (msg.t === 'kick') {
        var k = Number(msg.seat), s = this.seats[k];
        if (!s || !this.game.alive[k]) throw fail('Ce joueur n’est plus en jeu');
        if (s.cid && this.conns[s.cid]) throw fail('Ce joueur est connecté');
        this.game.resign(k);
      } else return;
      this._bump();
    } catch (e) {
      if (e && e.userMessage) this._fail(cid, e.userMessage); else throw e;
    }
  };

  MultiRoom.prototype.destroy = function () { this.conns = {}; };

  return MultiRoom;
});
