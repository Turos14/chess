/* Chat écrit des parties en ligne, côté hôte : nettoyage des messages, limite d'envoi, historique borné. ES5, sans
 * réseau ni DOM ; utilisé par room.js et multiroom.js (testé sous Node).
 * Les messages font partie de l'état diffusé : ils survivent donc à une bascule d'hôte. L'identifiant client (cid) de
 * l'auteur reste chez l'hôte (il donne droit au siège) ; chaque destinataire reçoit seulement « me » (c'est moi). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chat = factory();
})(this, function () {
  'use strict';

  var MAX_LEN = 200, KEEP = 50, BURST = 5, WINDOW = 10000;

  // Texte affichable : sans caractères de contrôle, espaces repliés, borné. '' si rien à envoyer.
  function clean(text) {
    return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, MAX_LEN);
  }

  // restore : liste reçue dans un état précédent (bascule d'hôte) ; now() : horloge (injectable pour les tests) ;
  // selfCid : cid du nouvel hôte, auteur des messages marqués « me » dans cette liste
  function Log(restore, now, selfCid) {
    var self = this;
    this.now = now || function () { return new Date().getTime(); };
    this.list = [];
    this.seq = 0;
    this.recent = {};                       // cid -> [horodatages des derniers envois]
    (restore || []).slice(-KEEP).forEach(function (m) {
      var x = clean(m && m.x), id = Math.floor(Number(m && m.id));
      if (!x || !isFinite(id)) return;
      self.list.push({ id: id, cid: m.me && selfCid ? selfCid : null, n: clean(m.n).slice(0, 20), c: m.c != null ? m.c : null, x: x, at: Number(m.at) || 0 });
      if (id > self.seq) self.seq = id;
    });
  }

  // Ajoute un message. author : {name, side (couleur / n° de camp, null pour un spectateur)}.
  // Retourne null si accepté, sinon le message d'erreur à montrer à l'auteur.
  Log.prototype.post = function (cid, author, text) {
    var x = clean(text), t = this.now();
    if (!x) return 'Message vide';
    var times = (this.recent[cid] || []).filter(function (s) { return t - s < WINDOW; });
    if (times.length >= BURST) { this.recent[cid] = times; return 'Trop de messages : attends quelques secondes'; }
    times.push(t);
    this.recent[cid] = times;
    this.seq++;
    this.list.push({ id: this.seq, cid: cid, n: author.name, c: author.side != null ? author.side : null, x: x, at: t });
    if (this.list.length > KEEP) this.list.splice(0, this.list.length - KEEP);
    return null;
  };

  // Liste telle que la voit le participant cid
  Log.prototype.viewFor = function (cid) {
    return this.list.map(function (m) { return { id: m.id, n: m.n, c: m.c, x: m.x, at: m.at, me: !!cid && m.cid === cid }; });
  };

  return { Log: Log, clean: clean, MAX_LEN: MAX_LEN, KEEP: KEEP };
});
