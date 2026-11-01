/* Aide-mémoire : enchaînements de coups notés par le joueur (ouvertures, pièges…) — module pur (aucun DOM), testable
 * sous Node. Une fiche : {id, title, notes, startFen, moves:[{from, to, promo, san}], created, updated} ; startFen est
 * la position de départ classique (Chess.START) ou une position placée à la main dans l'éditeur. Stockage et écrans : memoview.js (localStorage de l'appareil, jamais partagé). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chess.js'));
  else root.Memo = factory(root.Chess);
})(this, function (Chess) {
  'use strict';

  var TITLE_MAX = 60, NOTES_MAX = 2000;

  // Coups numérotés façon PGN : « 1.e4 e5 2.Nf3 » (les Noirs au trait au départ : « 1...e5 »).
  function moveText(moves, startFen) {
    var fp = String(startFen || Chess.START).split(' ');
    var startTurn = fp[1] || 'w', startFull = parseInt(fp[5], 10) || 1, out = [], i;
    for (i = 0; i < moves.length; i++) {
      var white = (startTurn === 'w') === (i % 2 === 0);
      var num = startFull + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
      out.push(white ? num + '.' + moves[i].san : (i === 0 ? num + '...' + moves[i].san : moves[i].san));
    }
    return out.join(' ');
  }

  // Remet une fiche lue du stockage en forme ; null si elle est inexploitable (coups illégaux, champs absents).
  // Les SAN sont recalculés par le moteur de règles : ils font foi plutôt que ce qui a été stocké.
  function sanitize(m) {
    if (!m || typeof m !== 'object' || !m.id) return null;
    var moves = Array.isArray(m.moves) ? m.moves : [], startFen = Chess.START, g;
    if (m.startFen) {
      try { startFen = new Chess.Game(m.startFen).startFen; } catch (e) { return null; }
    }
    g = Chess.replay(startFen, moves);
    if (!g) return null;
    return {
      id: String(m.id),
      title: String(m.title || '').slice(0, TITLE_MAX),
      notes: String(m.notes || '').slice(0, NOTES_MAX),
      startFen: startFen,
      moves: g.history.map(function (h) { return { from: h.from, to: h.to, promo: h.promo || null, san: h.san }; }),
      created: Number(m.created) || 0,
      updated: Number(m.updated) || Number(m.created) || 0
    };
  }

  function sanitizeList(list) {
    var out = [], i;
    if (!Array.isArray(list)) return out;
    for (i = 0; i < list.length; i++) {
      var m = sanitize(list[i]);
      if (m) out.push(m);
    }
    return out;
  }

  // Fiche vide (ni titre, ni notes, ni coups) : pas la peine de la garder.
  function isEmpty(m) { return !m.moves.length && !/\S/.test(m.title) && !/\S/.test(m.notes); }

  // Recherche insensible à la casse et aux accents, sur le titre, les notes et les coups ; tous les mots doivent figurer.
  function fold(s) {
    s = String(s).toLowerCase();
    var from = 'àâäáãéèêëíìîïóòôöõúùûüçñ', to = 'aaaaaeeeeiiiiooooouuuucn', out = '', i, k;
    for (i = 0; i < s.length; i++) { k = from.indexOf(s.charAt(i)); out += k >= 0 ? to.charAt(k) : s.charAt(i); }
    return out;
  }
  function filter(list, query) {
    var words = fold(query || '').split(/\s+/).filter(function (w) { return w; });
    if (!words.length) return list.slice();
    return list.filter(function (m) {
      var hay = fold(m.title + ' ' + m.notes + ' ' + moveText(m.moves, m.startFen));
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
  }

  // Même coup (cases et promotion) : sert à l'entraînement pour comparer le coup joué à celui de la fiche.
  function sameMove(a, b) {
    return !!a && !!b && a.from === b.from && a.to === b.to && (a.promo || null) === (b.promo || null);
  }

  // Camp au trait au départ d'une fiche ('w' ou 'b').
  function startTurn(m) { return String(m.startFen || Chess.START).split(' ')[1] === 'b' ? 'b' : 'w'; }

  // Entraînement : le joueur doit-il jouer le coup n° ply (0 = premier) ? side : 'w', 'b' ou 'both' ;
  // first : camp au trait au départ ('w' par défaut).
  function isTrainerMove(ply, side, first) {
    var f = first === 'b' ? 'b' : 'w';
    return side === 'both' || (ply % 2 === 0 ? f : Chess.other(f)) === side;
  }

  // Plus récemment modifiées d'abord.
  function sortList(list) {
    return list.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }

  return {
    moveText: moveText, sanitize: sanitize, sanitizeList: sanitizeList, isEmpty: isEmpty, filter: filter,
    sortList: sortList, sameMove: sameMove, isTrainerMove: isTrainerMove, startTurn: startTurn, TITLE_MAX: TITLE_MAX, NOTES_MAX: NOTES_MAX
  };
});
