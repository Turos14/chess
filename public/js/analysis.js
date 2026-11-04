/* Analyse d'une partie et commentaires de Hulotte (la chouette) — module pur (aucun DOM, aucun Worker), testable sous
 * Node. Le moteur (coach.js) fournit une évaluation par position de la ligne : evals[i] = {cp | mate, best} du point de
 * vue du camp au trait dans fens[i] (best = meilleur coup UCI), ou null si non analysée. Les positions finales (mat,
 * pat…) sont évaluées ici, sans moteur.
 * Classement des coups d'après la perte de « chances de gain » (même échelle que Lichess) : imprécision >= 10 points,
 * erreur >= 20, gaffe >= 30 ; précision par joueur avec la formule de Lichess. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chess.js'));
  else root.Analysis = factory(root.Chess);
})(this, function (Chess) {
  'use strict';

  var COACH = 'Hulotte';
  var MATE_CP = 100000;

  var CLASSES = {
    best: { label: 'Meilleur coup', sym: '★' },
    good: { label: 'Bon coup', sym: '' },
    inaccuracy: { label: 'Imprécision', sym: '?!' },
    mistake: { label: 'Erreur', sym: '?' },
    miss: { label: 'Mat manqué', sym: '?' },
    blunder: { label: 'Gaffe', sym: '??' }
  };

  // Score du point de vue des Blancs, en centipions (un mat vaut ±MATE_CP, moins il est loin plus il pèse).
  function whiteCp(ev, turn) {
    var v;
    if (ev.mate != null) v = ev.mate > 0 ? MATE_CP - ev.mate : (ev.mate < 0 ? -MATE_CP - ev.mate : -MATE_CP);
    else v = ev.cp || 0;
    return turn === 'w' ? v : -v;
  }

  // Chances de gain des Blancs (0-100) d'après le score (formule de Lichess).
  function winPct(cp) {
    if (cp >= MATE_CP / 2) return 100;
    if (cp <= -MATE_CP / 2) return 0;
    var c = Math.max(-1000, Math.min(1000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  function moveAccuracy(loss) {
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669));
  }

  function classify(loss, isBest, missedMate) {
    if (loss >= 30) return 'blunder';
    if (missedMate) return 'miss';
    if (loss >= 20) return 'mistake';
    if (loss >= 10) return 'inaccuracy';
    return isBest ? 'best' : 'good';
  }

  function uciOf(m) { return m.from + m.to + (m.promo || ''); }

  // Meilleur coup UCI -> SAN dans la position fen ('' si illisible).
  function uciToSan(fen, uci) {
    var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci || '');
    if (!m) return '';
    var g;
    try { g = new Chess.Game(fen); } catch (e) { return ''; }
    var rec = g.move(m[1], m[2], m[3] || null);
    return rec ? rec.san : '';
  }

  // Score d'une position : finale évaluée directement, sinon celle du moteur ; null si inconnue.
  function positionScore(fen, ev) {
    var g = new Chess.Game(fen), st = g.status(), turn = g.turn();
    if (st.over) {
      if (st.reason === 'checkmate') return { white: turn === 'w' ? -MATE_CP : MATE_CP, mateFor: Chess.other(turn), over: true };
      return { white: 0, over: true };
    }
    if (!ev) return null;
    return { white: whiteCp(ev, turn), mateFor: ev.mate != null && ev.mate !== 0 ? (ev.mate > 0 ? turn : Chess.other(turn)) : null };
  }

  // startFen, moves [{from,to,promo,san}], evals (voir en tête) ->
  // {moves:[{ply (1 = 1er coup), color, san, cls, loss, bestSan, before, after (chances de gain des Blancs)}],
  //  curve:[chances de gain des Blancs par position], accuracy:{w,b}, counts:{w:{cls:n}, b:{…}}, keyPlies:[ply…], complete}
  function analyse(startFen, moves, evals) {
    var g = new Chess.Game(startFen || Chess.START), fens = [g.fens[0]], i;
    for (i = 0; i < moves.length; i++) {
      if (!g.move(moves[i].from, moves[i].to, moves[i].promo)) break;
      fens.push(g.fens[g.fens.length - 1]);
    }
    var scores = fens.map(function (f, k) { return positionScore(f, evals[k]); });
    var curve = scores.map(function (s, k) { return s ? winPct(s.white) : (k > 0 && scores[k - 1] ? winPct(scores[k - 1].white) : 50); });
    var out = [], acc = { w: [], b: [] }, counts = { w: {}, b: {} }, complete = true;
    for (i = 0; i < fens.length - 1; i++) {
      var color = fens[i].split(' ')[1] === 'b' ? 'b' : 'w', b = scores[i], a = scores[i + 1];
      var info = { ply: i + 1, color: color, san: g.history[i].san, cls: null, loss: 0, bestSan: '', before: curve[i], after: curve[i + 1] };
      if (!b || !a) { complete = false; out.push(info); continue; }
      var sign = color === 'w' ? 1 : -1;
      var best = evals[i] && evals[i].best;
      var isBest = !!best && best === uciOf(g.history[i]);
      // Le coup du moteur ne perd rien par définition : l'écart mesuré n'est que du bruit (analyse courte, profondeurs
      // différentes d'une position à l'autre) et ne doit pas faire baisser la précision.
      var loss = isBest ? 0 : Math.max(0, sign * (winPct(b.white) - winPct(a.white)));
      var missedMate = b.mateFor === color && a.mateFor !== color && !a.over;
      info.loss = Math.round(loss * 10) / 10;
      info.cls = classify(loss, isBest, missedMate);
      if (!isBest && best) info.bestSan = uciToSan(fens[i], best);
      acc[color].push(moveAccuracy(loss));
      counts[color][info.cls] = (counts[color][info.cls] || 0) + 1;
      out.push(info);
    }
    function mean(l) { if (!l.length) return null; var s = 0; l.forEach(function (x) { s += x; }); return Math.round(s / l.length); }
    var keyPlies = out.filter(function (m) { return m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'miss'; })
      .map(function (m) { return m.ply; });
    // Rien de grave : on retient au moins le plus gros basculement, s'il est notable.
    if (!keyPlies.length) {
      var top = null;
      out.forEach(function (m) { if (m.cls && m.loss >= 5 && (!top || m.loss > top.loss)) top = m; });
      if (top) keyPlies.push(top.ply);
    }
    return { moves: out, curve: curve, accuracy: { w: mean(acc.w), b: mean(acc.b) }, counts: counts, keyPlies: keyPlies, complete: complete };
  }

  /* ---------- Commentaires de Hulotte ---------- */
  function pick(list, seed) { return list[Math.abs(seed) % list.length]; }

  // Description d'une position d'après les chances de gain des Blancs.
  function describe(w) {
    if (w >= 97) return 'les Blancs gagnent';
    if (w <= 3) return 'les Noirs gagnent';
    if (w >= 80) return 'les Blancs ont un gros avantage';
    if (w <= 20) return 'les Noirs ont un gros avantage';
    if (w >= 62) return 'les Blancs sont mieux';
    if (w <= 38) return 'les Noirs sont mieux';
    return 'c’est à peu près équilibré';
  }

  function nameOf(color, names) {
    var n = names && names[color];
    return n && n !== 'Blancs' && n !== 'Noirs' ? n : 'les ' + (color === 'w' ? 'Blancs' : 'Noirs');
  }

  // Commentaire d'un coup analysé (info d'analyse().moves). names : {w, b}.
  function comment(m, names) {
    if (!m || !m.cls) return 'Je n’ai pas pu analyser ce coup.';
    var who = nameOf(m.color, names), seed = m.ply * 7 + m.san.length;
    var alt = m.bestSan ? ' Il fallait plutôt jouer ' + m.bestSan + '.' : '';
    var after = ' Maintenant, ' + describe(m.after) + '.';
    if (/#$/.test(m.san)) return pick(['Échec et mat ! Bien joué ' + who + ', hou hou !', m.san + ', et c’est mat. Rideau !'], seed);
    switch (m.cls) {
      case 'blunder':
        return pick(['Hou hou ! ' + m.san + ' est une gaffe.', 'Aïe, mes plumes se hérissent : ' + m.san + ' est une gaffe.',
          'Oh non… ' + m.san + ' laisse filer la partie.'], seed) + alt + after;
      case 'miss':
        return 'Il y avait un mat à trouver ! Avec ' + m.san + ', ' + who + ' le laisse passer.' + alt + after;
      case 'mistake':
        return pick(['Hmm, ' + m.san + ' est une erreur.', m.san + ' ? Je ne suis pas convaincue.', 'Attention : ' + m.san + ' coûte cher.'], seed) + alt + after;
      case 'inaccuracy':
        return pick([m.san + ' est un peu imprécis.', 'Pas tout à fait : ' + m.san + ' laisse filer un peu d’avantage.',
          m.san + ' se joue, mais on pouvait mieux faire.'], seed) + alt;
      case 'best':
        if (m.ply <= 8) return pick(['Un coup d’ouverture classique, parfait.', m.san + ' : solide, c’est la théorie.', 'Rien à redire, ' + m.san + ' développe bien le jeu.'], seed);
        return pick(['Bravo ! ' + m.san + ' est exactement le coup que j’aurais joué.', m.san + ' : le meilleur coup, chapeau !',
          'Excellent, ' + m.san + ' est le coup du moteur.'], seed);
      default:
        if (m.ply <= 8) return pick(['Un coup d’ouverture tout à fait jouable.', m.san + ' se joue, la partie commence tranquillement.'], seed);
        return pick(['Un bon coup.', m.san + ' tient la route.', 'Rien à redire sur ' + m.san + '.'], seed);
    }
  }

  // Bilan de la partie, affiché sur la position de départ une fois l'analyse finie.
  function summary(a, names) {
    var parts = [], c;
    ['w', 'b'].forEach(function (color) {
      if (a.accuracy[color] == null) return;
      c = a.counts[color];
      var bad = [];
      if (c.blunder) bad.push(c.blunder + ' gaffe' + (c.blunder > 1 ? 's' : ''));
      if (c.mistake || c.miss) { var e = (c.mistake || 0) + (c.miss || 0); bad.push(e + ' erreur' + (e > 1 ? 's' : '')); }
      if (c.inaccuracy) bad.push(c.inaccuracy + ' imprécision' + (c.inaccuracy > 1 ? 's' : ''));
      var n = nameOf(color, names);
      parts.push(n.charAt(0).toUpperCase() + n.slice(1) + ' : précision ' + a.accuracy[color] + ' %' + (bad.length ? ' (' + bad.join(', ') + ')' : ', sans faute'));
    });
    var best = a.accuracy.w != null && a.accuracy.b != null && Math.abs(a.accuracy.w - a.accuracy.b) >= 5
      ? ' Mention spéciale pour ' + nameOf(a.accuracy.w > a.accuracy.b ? 'w' : 'b', names) + ' !' : '';
    var keys = a.keyPlies.length ? ' J’ai repéré ' + a.keyPlies.length + ' moment' + (a.keyPlies.length > 1 ? 's' : '') +
      ' clé' + (a.keyPlies.length > 1 ? 's' : '') + ' : utilise « Moment clé › » pour les revoir.' : ' Aucun moment critique : partie bien maîtrisée.';
    return 'Hou hou, voici mon bilan ! ' + parts.join('. ') + '.' + best + keys;
  }

  return {
    COACH: COACH, CLASSES: CLASSES, whiteCp: whiteCp, winPct: winPct, moveAccuracy: moveAccuracy, classify: classify,
    uciToSan: uciToSan, analyse: analyse, describe: describe, comment: comment, summary: summary
  };
});
