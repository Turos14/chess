var assert = require('assert');
var Memo = require('../public/js/memo.js');

// Coups numérotés
var moves = [{ from: 'e2', to: 'e4', san: 'e4' }, { from: 'e7', to: 'e5', san: 'e5' }, { from: 'g1', to: 'f3', san: 'Nf3' }];
assert.strictEqual(Memo.moveText(moves), '1.e4 e5 2.Nf3');
assert.strictEqual(Memo.moveText([]), '');
assert.strictEqual(Memo.moveText([{ san: 'e5' }, { san: 'Nf3' }], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), '1...e5 2.Nf3');

// Remise en forme : SAN recalculés, champs bornés, fiches illégales écartées
var m = Memo.sanitize({ id: 7, title: 'Italienne', notes: 'n', created: 5, moves: [{ from: 'e2', to: 'e4', san: 'faux' }, { from: 'e7', to: 'e5' }] });
assert.strictEqual(m.id, '7');
assert.deepStrictEqual(m.moves.map(function (x) { return x.san; }), ['e4', 'e5']);
assert.strictEqual(m.updated, 5);
assert.strictEqual(Memo.sanitize({ id: 'x', moves: [{ from: 'e2', to: 'e5' }] }), null);
assert.strictEqual(Memo.sanitize({ moves: [] }), null);
assert.strictEqual(Memo.sanitize(null), null);
assert.strictEqual(Memo.sanitize({ id: 'a', title: new Array(200).join('x') }).title.length, Memo.TITLE_MAX);
assert.strictEqual(Memo.sanitizeList('pas une liste').length, 0);
assert.strictEqual(Memo.sanitizeList([{ id: 'a' }, { id: 'b', moves: [{ from: 'a1', to: 'a8' }] }, 3]).length, 1);

// Promotion conservée
var promo = Memo.sanitize({ id: 'p', moves: [
  { from: 'h2', to: 'h4' }, { from: 'g7', to: 'g5' }, { from: 'h4', to: 'g5' }, { from: 'f7', to: 'f6' },
  { from: 'g5', to: 'g6' }, { from: 'a7', to: 'a6' }, { from: 'g6', to: 'g7' }, { from: 'a6', to: 'a5' },
  { from: 'g7', to: 'h8', promo: 'q' }] });
assert.strictEqual(promo.moves[8].promo, 'q');
assert(/^gxh8=Q/.test(promo.moves[8].san));

// Vide
assert(Memo.isEmpty({ title: '  ', notes: '', moves: [] }));
assert(!Memo.isEmpty({ title: 'a', notes: '', moves: [] }));
assert(!Memo.isEmpty({ title: '', notes: '', moves: moves }));

// Recherche (casse, accents, coups, plusieurs mots)
var list = [
  { id: '1', title: 'Défense française', notes: '', moves: [{ san: 'e4' }, { san: 'e6' }], updated: 1 },
  { id: '2', title: 'Sicilienne', notes: 'Najdorf', moves: [{ san: 'e4' }, { san: 'c5' }], updated: 3 }
];
assert.deepStrictEqual(Memo.filter(list, 'FRANCAISE').map(function (x) { return x.id; }), ['1']);
assert.deepStrictEqual(Memo.filter(list, 'c5').map(function (x) { return x.id; }), ['2']);
assert.deepStrictEqual(Memo.filter(list, 'e4 najdorf').map(function (x) { return x.id; }), ['2']);
assert.strictEqual(Memo.filter(list, '  ').length, 2);
assert.strictEqual(Memo.filter(list, 'zzz').length, 0);
assert.deepStrictEqual(Memo.sortList(list).map(function (x) { return x.id; }), ['2', '1']);

console.log('memo OK');
