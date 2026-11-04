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

console.log('analysis OK');
