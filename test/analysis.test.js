var assert = require('assert');
var Chess = require('../public/js/chess.js');
var A = require('../public/js/analysis.js');

// Échelles
assert.strictEqual(A.winPct(0), 50);
assert(A.winPct(300) > 70 && A.winPct(-300) < 30);
assert.strictEqual(A.winPct(A.whiteCp({ mate: 3 }, 'w')), 100);
assert.strictEqual(A.winPct(A.whiteCp({ mate: 3 }, 'b')), 0);
assert.strictEqual(A.whiteCp({ cp: 40 }, 'b'), -40);
assert(A.moveAccuracy(0) > 99 && A.moveAccuracy(50) < 15);
assert.strictEqual(A.classify(35, false, false), 'blunder');
assert.strictEqual(A.classify(22, false, false), 'mistake');
assert.strictEqual(A.classify(12, true, false), 'inaccuracy');
assert.strictEqual(A.classify(2, true, false), 'best');
assert.strictEqual(A.classify(2, false, false), 'good');
assert.strictEqual(A.classify(2, false, true), 'miss');
assert.strictEqual(A.uciToSan(Chess.START, 'g1f3'), 'Nf3');
assert.strictEqual(A.uciToSan(Chess.START, 'zz'), '');

// Mat du berger : 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
function mv(f, t) { return { from: f, to: t }; }
var moves = [mv('e2', 'e4'), mv('e7', 'e5'), mv('d1', 'h5'), mv('b8', 'c6'), mv('f1', 'c4'), mv('g8', 'f6'), mv('h5', 'f7')];
var evals = [
  { cp: 30, best: 'e2e4' },     // départ, Blancs au trait
  { cp: -30, best: 'e7e5' },    // Noirs au trait
  { cp: 30, best: 'g1f3' },
  { cp: 0, best: 'b8c6' },      // Noirs au trait : égalité
  { cp: 0, best: 'g1f3' },
  { cp: -20, best: 'd8e7' },    // Noirs au trait, il faut défendre f7
  { mate: 1, best: 'h5f7' },    // Blancs au trait : mat en 1
  null                          // position finale (mat) : évaluée sans moteur
];
var a = A.analyse(Chess.START, moves, evals);
assert(a.complete);
assert.strictEqual(a.moves.length, 7);
assert.strictEqual(a.moves[0].cls, 'best');
assert.strictEqual(a.moves[2].cls, 'good');
assert.strictEqual(a.moves[5].cls, 'blunder');                // Nf6??
assert.strictEqual(a.moves[5].bestSan, 'Qe7');
assert.strictEqual(a.moves[6].cls, 'best');                   // Qxf7#
assert.strictEqual(a.curve[7], 100);                          // mat pour les Blancs
assert.deepStrictEqual(a.keyPlies, [6]);
assert(a.accuracy.w > a.accuracy.b);
assert.strictEqual(a.counts.b.blunder, 1);

// Commentaires
assert(/gaffe|filer/.test(A.comment(a.moves[5], { w: 'Alice', b: 'Bob' })));
assert(/Qe7/.test(A.comment(a.moves[5], { w: 'Alice', b: 'Bob' })));
assert(/mat/i.test(A.comment(a.moves[6], { w: 'Alice', b: 'Bob' })));
var sum = A.summary(a, { w: 'Alice', b: 'Bob' });
assert(/Alice : précision \d+ %/.test(sum) && /Bob/.test(sum) && /1 gaffe/.test(sum) && /1 moment clé/.test(sum));
assert(/les Blancs/.test(A.summary(a, { w: 'Blancs', b: 'Noirs' })));

// Analyse incomplète : coups non évalués laissés sans classe
var part = A.analyse(Chess.START, moves.slice(0, 2), [{ cp: 20, best: 'e2e4' }, null, null]);
assert(!part.complete);
assert.strictEqual(part.moves[0].cls, null);

// Mat manqué : mat en 2 disponible, coup joué qui le laisse filer sans perdre l'avantage
var miss = A.analyse(Chess.START, [mv('e2', 'e4')], [{ mate: 2, best: 'd2d4' }, { cp: -900 }]);
assert.strictEqual(miss.moves[0].cls, 'miss');

// Explications détaillées (variantes du moteur)
var ev2 = evals.map(function (e) { return e && JSON.parse(JSON.stringify(e)); });
ev2[5].pv = ['d8e7', 'b1c3', 'g8f6'];
ev2[6].pv = ['h5f7'];
var a2 = A.analyse(Chess.START, moves, ev2), names = { w: 'Alice', b: 'Bob' };
var c5 = A.comment(a2.moves[5], names);
assert(/Le cavalier se développe en f6/.test(c5), c5);
assert(/Alice peut mater tout de suite : 4\.Qxf7#/.test(c5), c5);
assert(/Il fallait jouer Qe7/.test(c5), c5);
assert(/Évaluation \(côté Blancs\) : \+0,2 → mat pour les Blancs/.test(c5), c5);
assert(/mat/i.test(A.comment(a2.moves[6], names)));
// Pièce laissée en prise : 1.Nf3 d5 2.Ne5 Qd6?? 3.Nxf7 (bilan matériel de la variante adverse)
var m3 = [mv('g1', 'f3'), mv('d7', 'd5'), mv('f3', 'e5'), mv('d8', 'd6')];
var e3 = [{ cp: 20, best: 'g1f3' }, { cp: -20, best: 'd7d5' }, { cp: 20, best: 'd2d4' }, { cp: 0, best: 'g8f6', pv: ['g8f6'] },
  { cp: 600, best: 'e5f7', pv: ['e5f7', 'd6e6', 'f7h8'] }];
var a3 = A.analyse(Chess.START, m3, e3), c3 = A.comment(a3.moves[3], names);
assert.strictEqual(a3.moves[3].cls, 'blunder');
assert(/Alice répond Nxf7 et, après 3\.Nxf7 Qe6 4\.Nxh8, Bob perd une tour et un pion/.test(c3), c3);
assert(/La dame va en d6/.test(c3), c3);
// Utilitaires
assert.strictEqual(A.fmtEval(123), '+1,2');
assert.strictEqual(A.fmtEval(-50), '−0,5');
assert.strictEqual(A.fmtEval(0), '0');
assert.strictEqual(A.pieceList(['bN', 'bP', 'bP']), 'un cavalier et deux pions');
assert.strictEqual(A.pieceList(['wQ']), 'une dame');
assert.strictEqual(A.lineText('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e5', 'Nf3']), '1…e5 2.Nf3');

console.log('analysis OK');
