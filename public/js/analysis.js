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
  // {moves:[{ply (1 = 1er coup), color, san, cls, loss, bestSan, before, after (chances de gain des Blancs), + contexte}],
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
      var info = {
        ply: i + 1, color: color, san: g.history[i].san, cls: null, loss: 0, bestSan: '', before: curve[i], after: curve[i + 1],
        // Contexte pour les explications de comment() : positions, coup (et le précédent), évaluations du moteur
        fenBefore: fens[i], fenAfter: fens[i + 1], move: g.history[i], prev: i > 0 ? g.history[i - 1] : null,
        evBefore: evals[i] || null, evAfter: evals[i + 1] || null,
        cpBefore: b ? b.white : null, cpAfter: a ? a.white : null
      };
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

  /* Explications : on rejoue les variantes du moteur (pv) pour dire concrètement ce qui se passe — ce que fait le coup,
   * ce que l'adversaire peut répondre et ce que ça coûte (matériel, mat), et ce qu'il fallait jouer à la place. */
  var PIECE = { P: ['pion', 'm'], N: ['cavalier', 'm'], B: ['fou', 'm'], R: ['tour', 'f'], Q: ['dame', 'f'], K: ['roi', 'm'] };
  var VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  var PLY_LINE = 6;      // longueur max des variantes citées / rejouées

  function pieceName(code) { return PIECE[code.charAt(1)][0]; }
  function theP(code) { return (PIECE[code.charAt(1)][1] === 'f' ? 'la ' : 'le ') + pieceName(code); }
  function aP(code) { return (PIECE[code.charAt(1)][1] === 'f' ? 'une ' : 'un ') + pieceName(code); }
  function fem(code) { return PIECE[code.charAt(1)][1] === 'f' ? 'e' : ''; }
  function cap1(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  // Liste de pièces prises -> « un cavalier et deux pions »
  function pieceList(codes) {
    var count = {}, order = ['Q', 'R', 'B', 'N', 'P'], parts = [];
    codes.forEach(function (c) { var t = c.charAt(1); count[t] = (count[t] || 0) + 1; });
    var NUM = ['', '', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'];
    order.forEach(function (t) {
      var n = count[t];
      if (!n) return;
      var code = 'x' + t;
      parts.push(n === 1 ? aP(code) : (NUM[n] || n) + ' ' + pieceName(code) + 's');
    });
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
  }

  // Évaluation lisible, du point de vue des Blancs (« +1,2 », « mat »).
  function fmtEval(cp) {
    if (cp == null) return '?';
    if (cp >= MATE_CP / 2) return 'mat pour les Blancs';
    if (cp <= -MATE_CP / 2) return 'mat pour les Noirs';
    var v = Math.round(cp / 10) / 10;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(v)).replace('.', ',');
  }

  // Rejoue une variante UCI depuis fen (max coups) : {sans, game, taken {w:[pièces blanches prises], b:[…]}, mate}
  function playLine(fen, pv, max) {
    var g, out = { sans: [], game: null, taken: { w: [], b: [] }, mate: false, fen: fen };
    try { g = new Chess.Game(fen); } catch (e) { return out; }
    out.game = g;
    for (var k = 0; k < (pv || []).length && k < max; k++) {
      var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(pv[k]);
      var rec = m && g.move(m[1], m[2], m[3] || null);
      if (!rec) break;
      out.sans.push(rec.san);
      if (rec.cap) out.taken[rec.cap.charAt(0)].push(rec.cap);
      if (g.status().reason === 'checkmate') { out.mate = true; break; }
    }
    return out;
  }

  // « 12.Bxf7+ Kxf7 13.Ng5+ » à partir de la position de départ de la variante
  function lineText(fen, sans) {
    var p = fen.split(' '), first = p[1], full = parseInt(p[5], 10) || 1, words = [], k;
    for (k = 0; k < sans.length; k++) {
      var white = (first === 'w') === (k % 2 === 0), num = full + Math.floor((k + (first === 'b' ? 1 : 0)) / 2);
      words.push(white ? num + '.' + sans[k] : (k === 0 ? num + '…' + sans[k] : sans[k]));
    }
    return words.join(' ');
  }

  // Bilan matériel d'une variante pour color : {lost (ses pièces prises), won (pièces adverses prises), net (en pions)}.
  // extra : prises déjà faites juste avant (échange en cours), comptées aussi. Les pièces de même type prises des deux
  // côtés s'annulent (« gagne un cavalier » plutôt que « une dame et un cavalier contre une dame »).
  function balance(line, color, extra) {
    var opp = Chess.other(color), lost = line.taken[color].slice(), won = line.taken[opp].slice(), net = 0, k, j;
    (extra || []).forEach(function (c) { (c.charAt(0) === color ? lost : won).push(c); });
    for (k = won.length - 1; k >= 0; k--) {
      for (j = 0; j < lost.length; j++) {
        if (lost[j].charAt(1) === won[k].charAt(1)) { lost.splice(j, 1); won.splice(k, 1); break; }
      }
    }
    lost.forEach(function (c) { net -= VALUE[c.charAt(1)]; });
    won.forEach(function (c) { net += VALUE[c.charAt(1)]; });
    return { lost: lost, won: won, net: net };
  }

  // Prises déjà faites à compter avec une variante. own : variante jouée après le coup -> on compte la prise du coup.
  // Sinon (variante depuis la position d'avant) : si son 1er coup reprend sur la case où l'adversaire vient de prendre,
  // on compte cette prise adverse — sinon une simple reprise passerait pour un gain.
  function pending(m, own, line) {
    if (own) return m.move.cap ? [m.move.cap] : [];
    var first = line.game && line.game.history[0];
    return m.prev && m.prev.cap && first && first.cap && first.to === m.prev.to ? [m.prev.cap] : [];
  }

  // Ce que fait le coup, en une phrase.
  function whatItDoes(m, who) {
    var r = m.move, code = r.piece, t = code.charAt(1), check = /\+$/.test(r.san);
    var txt;
    if (r.castle) txt = cap1(who) + ' roque : le roi se met à l’abri et la tour entre dans le jeu';
    else if (r.promo) txt = 'Le pion arrive en ' + r.to + ' et devient ' + aP('x' + r.promo.toUpperCase());
    else if (r.cap) {
      var re = m.prev && m.prev.cap && m.prev.to === r.to;
      txt = cap1(theP(code)) + (re ? ' reprend ' : ' prend ') + theP(r.cap) + ' en ' + r.to;
    } else if ((t === 'N' || t === 'B') && m.ply <= 20 && /[18]$/.test(r.from)) txt = cap1(theP(code)) + ' se développe en ' + r.to;
    else if (t === 'P' && m.ply <= 12 && /^[de][45]$/.test(r.to)) txt = 'Le pion ' + r.to + ' occupe le centre';
    else txt = cap1(theP(code)) + ' va en ' + r.to;
    return txt + (check ? ', avec échec.' : '.');
  }

  // Ce que l'adversaire peut faire après le coup (variante du moteur depuis la position obtenue).
  function punishment(m, who, opp) {
    var ev = m.evAfter;
    if (!ev || !ev.pv || !ev.pv.length) return '';
    if (ev.mate != null && ev.mate > 0) {
      var ml = playLine(m.fenAfter, ev.pv, Math.min(2 * ev.mate - 1, 9));
      return cap1(opp) + ' peut ' + (ev.mate === 1 ? 'mater tout de suite : ' : 'forcer le mat en ' + ev.mate + ' coups : ') + lineText(m.fenAfter, ml.sans) + '.';
    }
    var line = playLine(m.fenAfter, ev.pv, PLY_LINE), bal = balance(line, m.color, pending(m, true, line));
    if (!line.sans.length) return '';
    var first = line.game && line.game.history[0], hang = '';
    if (first && first.cap && first.to === m.move.to && !m.move.castle) {
      var e = fem(m.move.piece);
      hang = cap1(theP(m.move.piece)) + ' joué' + e + ' en ' + m.move.to + ' n’est pas assez protégé' + e + '. ';
    }
    if (bal.net <= -1 && bal.lost.length) {
      return hang + cap1(opp) + ' répond ' + line.sans[0] + ' et, après ' + lineText(m.fenAfter, line.sans) + ', ' + who + ' perd ' +
        pieceList(bal.lost) + (bal.won.length ? ' contre ' + pieceList(bal.won) : '') + '.';
    }
    return cap1(opp) + ' en profite avec ' + lineText(m.fenAfter, line.sans.slice(0, 4)) + '.';
  }

  // Ce qu'apportait le meilleur coup (variante du moteur depuis la position d'avant).
  function betterMove(m, who) {
    var ev = m.evBefore;
    if (!ev || !m.bestSan) return '';
    var line = playLine(m.fenBefore, ev.pv && ev.pv.length ? ev.pv : [ev.best], PLY_LINE);
    var txt = 'Il fallait jouer ' + m.bestSan;
    if (ev.mate != null && ev.mate > 0) {
      var ml = playLine(m.fenBefore, ev.pv, Math.min(2 * ev.mate - 1, 9));
      return txt + ', qui ' + (ev.mate === 1 ? 'matait tout de suite.' : 'forçait le mat : ' + lineText(m.fenBefore, ml.sans) + '.');
    }
    var bal = balance(line, m.color, pending(m, false, line)), b0 = line.game && line.game.history[0];
    if (bal.net >= 1 && bal.won.length) {
      return txt + ' : après ' + lineText(m.fenBefore, line.sans) + ', ' + who + ' gagne ' + pieceList(bal.won) +
        (bal.lost.length ? ' contre ' + pieceList(bal.lost) : '') + '.';
    }
    if (b0 && b0.cap) return txt + ', qui prend ' + theP(b0.cap) + ' en ' + b0.to + ' (suite : ' + lineText(m.fenBefore, line.sans.slice(0, 4)) + ').';
    if (b0 && /\+$/.test(b0.san)) return txt + ', avec échec (suite : ' + lineText(m.fenBefore, line.sans.slice(0, 4)) + ').';
    return txt + ' (suite possible : ' + lineText(m.fenBefore, line.sans.slice(0, 4)) + ').';
  }

  // Commentaire d'un coup analysé (info d'analyse().moves). names : {w, b}.
  function comment(m, names) {
    if (!m || !m.cls) return 'Je n’ai pas pu analyser ce coup.';
    var who = nameOf(m.color, names), opp = nameOf(Chess.other(m.color), names), seed = m.ply * 7 + m.san.length;
    var does = m.move ? whatItDoes(m, who) : '';
    var evalTxt = m.cpBefore != null && m.cpAfter != null
      ? ' Évaluation (côté Blancs) : ' + fmtEval(m.cpBefore) + ' → ' + fmtEval(m.cpAfter) + ' (' + describe(m.after) + ').' : '';
    if (/#$/.test(m.san)) return pick(['Échec et mat ! ', 'Et c’est mat ! '], seed) + does.replace(/, avec échec\.$/, '.') + ' Bien joué ' + who + ', hou hou !';
    if (!m.move) return 'Analyse ancienne : relance l’analyse pour avoir mes explications.';
    switch (m.cls) {
      case 'blunder':
        return pick(['Hou hou, gaffe ! ', 'Aïe, mes plumes se hérissent ! ', 'Oh non, gaffe ! '], seed) + does + ' ' +
          (punishment(m, who, opp) || '') + ' ' + betterMove(m, who) + evalTxt;
      case 'miss':
        return 'Il y avait un mat à trouver ! ' + does + ' ' + betterMove(m, who) + evalTxt;
      case 'mistake':
        return pick(['Erreur. ', 'Attention, c’est une erreur. '], seed) + does + ' ' + (punishment(m, who, opp) || '') + ' ' +
          betterMove(m, who) + evalTxt;
      case 'inaccuracy':
        return pick(['Un peu imprécis. ', 'Pas tout à fait le bon coup. '], seed) + does + ' ' + betterMove(m, who) + evalTxt;
      case 'best':
        return pick(['Bravo, c’est le meilleur coup ! ', 'Exactement ce que j’aurais joué ! ', 'Le coup du moteur, chapeau ! '], seed) +
          does + bestIdea(m, who);
      default:
        return pick(['Bon coup. ', 'Ça se joue. ', 'Correct. '], seed) + does +
          (m.bestSan && m.loss >= 4 ? ' ' + m.bestSan + ' était un peu plus précis.' : '');
    }
  }

  // Pour un meilleur coup : l'idée derrière (gain de matériel ou mat dans la variante, sinon la suite prévue).
  function bestIdea(m, who) {
    var ev = m.evBefore;
    if (!ev || !ev.pv || ev.pv.length < 2) return '';
    if (ev.mate != null && ev.mate > 0) {
      var ml = playLine(m.fenBefore, ev.pv, Math.min(2 * ev.mate - 1, 9));
      return ' Il mène au mat : ' + lineText(m.fenBefore, ml.sans) + '.';
    }
    var line = playLine(m.fenBefore, ev.pv, PLY_LINE), bal = balance(line, m.color, pending(m, false, line));
    if (bal.net >= 1 && bal.won.length) {
      return ' L’idée : ' + lineText(m.fenBefore, line.sans) + ', et ' + who + ' gagne ' + pieceList(bal.won) +
        (bal.lost.length ? ' contre ' + pieceList(bal.lost) : '') + '.';
    }
    if (m.ply <= 8) return '';
    return ' Suite logique : ' + lineText(m.fenBefore, line.sans.slice(0, 4)) + '.';
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
    uciToSan: uciToSan, analyse: analyse, describe: describe, comment: comment, summary: summary,
    fmtEval: fmtEval, pieceList: pieceList, lineText: lineText
  };
});
