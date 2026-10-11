/* Calcul de classement Elo — module pur (aucun DOM, aucun stockage), utilisable sous Node et dans le navigateur.
 * La base `db` est un objet simple { players: { <clé> : { name, rating, games, wins, draws, losses, history[] } } },
 * la clé étant le nom normalisé (espaces retirés, casse ignorée) : le stockage/persistance est géré ailleurs
 * (voir public/js/eloview.js), comme chess.js est le moteur pur et room.js/online.js gèrent l'état côté app. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Elo = factory();
})(this, function () {
  'use strict';

  var DEFAULT_RATING = 1200;
  var MIN_RATING = 100, MAX_RATING = 3000;
  var HISTORY_MAX = 30;
  // Noms de remplacement utilisés ailleurs dans l'app quand un joueur ne saisit rien : jamais classés,
  // sinon "Blancs" ou "Joueur" accumulerait les parties de plusieurs personnes différentes.
  var ANON = { 'Blancs': 1, 'Noirs': 1, 'Joueur': 1, 'Spectateur': 1 };

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function key(name) { return trim(name).toLowerCase(); }

  // K décroît avec l'expérience : les nouveaux classements bougent vite, puis se stabilisent.
  function kFactor(games) { return games < 20 ? 40 : (games < 40 ? 30 : 20); }
  function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }

  function eligible(nameW, nameB) {
    var w = trim(nameW), b = trim(nameB);
    if (!w || !b) return false;
    if (ANON.hasOwnProperty(w) || ANON.hasOwnProperty(b)) return false;
    if (key(w) === key(b)) return false;
    return true;
  }

  function newDb() { return { players: {} }; }

  // Note de départ demandée : ignorée si invalide/hors bornes (repli sur DEFAULT_RATING), et de toute façon
  // ignorée si le joueur existe déjà (on ne réécrit jamais une note déjà établie par des parties précédentes).
  function clampStart(start) {
    var r = Math.round(Number(start));
    return isFinite(r) && r >= MIN_RATING && r <= MAX_RATING ? r : DEFAULT_RATING;
  }

  function getOrCreate(db, name, start) {
    var k = key(name), p = db.players[k];
    if (!p) {
      p = { name: trim(name), rating: clampStart(start), games: 0, wins: 0, draws: 0, losses: 0, history: [] };
      db.players[k] = p;
    } else {
      p.name = trim(name);   // garde la casse la plus récemment saisie
    }
    return p;
  }

  // result : '1-0' | '0-1' | '1/2-1/2'. startW/startB : note de départ si nameW/nameB est un joueur inédit
  // (facultatif, sinon DEFAULT_RATING). Retourne { applied:false } si les noms ne sont pas éligibles.
  function apply(db, nameW, nameB, result, mode, now, startW, startB) {
    if (!eligible(nameW, nameB)) return { applied: false };
    now = now == null ? new Date().getTime() : now;
    var pw = getOrCreate(db, nameW, startW), pb = getOrCreate(db, nameB, startB);
    var sw = result === '1-0' ? 1 : (result === '0-1' ? 0 : 0.5), sb = 1 - sw;
    var ew = expected(pw.rating, pb.rating), eb = 1 - ew;
    var kw = kFactor(pw.games), kb = kFactor(pb.games);
    var deltaW = Math.round(kw * (sw - ew)), deltaB = Math.round(kb * (sb - eb));
    var beforeW = pw.rating, beforeB = pb.rating;
    pw.rating += deltaW; pb.rating += deltaB;
    pw.games++; pb.games++;
    if (sw === 1) { pw.wins++; pb.losses++; } else if (sw === 0) { pw.losses++; pb.wins++; } else { pw.draws++; pb.draws++; }
    pw.history.unshift({ date: now, opponent: pb.name, score: sw, delta: deltaW, rating: pw.rating, mode: mode || null });
    pb.history.unshift({ date: now, opponent: pw.name, score: sb, delta: deltaB, rating: pb.rating, mode: mode || null });
    if (pw.history.length > HISTORY_MAX) pw.history.length = HISTORY_MAX;
    if (pb.history.length > HISTORY_MAX) pb.history.length = HISTORY_MAX;
    return {
      applied: true,
      w: { name: pw.name, before: beforeW, after: pw.rating, delta: deltaW },
      b: { name: pb.name, before: beforeB, after: pb.rating, delta: deltaB }
    };
  }

  function list(db) {
    var out = [], k;
    for (k in db.players) if (db.players.hasOwnProperty(k)) out.push(db.players[k]);
    out.sort(function (a, b) { return b.rating - a.rating || b.games - a.games || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return out;
  }

  function player(db, name) { return db.players[key(name)] || null; }

  return {
    DEFAULT_RATING: DEFAULT_RATING, MIN_RATING: MIN_RATING, MAX_RATING: MAX_RATING,
    kFactor: kFactor, expected: expected, eligible: eligible,
    newDb: newDb, apply: apply, list: list, player: player, key: key
  };
});
