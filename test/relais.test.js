var assert = require('assert');
var buildIssue = require('../relais/lib/ticket.js').buildIssue;
var C = require('../scripts/puzzle-common.js');
var handler = require('../relais/api/submit.js');

// Proposition : le ticket créé par le relais est lu à l'identique par le script de l'Action (puzzle-common.js).
var prop = buildIssue({
  kind: 'propose', fen: '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', solution: ' f1f8 ', title: 'Mat du couloir',
  author: '', category: 'Mats, Tactique', difficulty: 'facile', description: 'Ligne 1\n\n### pas un champ\nLigne 3'
});
assert.deepStrictEqual(prop.labels, ['puzzle-pending']);
var read = C.readPuzzleFields(prop.body);
assert(!read.error, read.error);
assert.deepStrictEqual(read.puzzle.solution, ['f1f8']);
assert.strictEqual(read.puzzle.title, 'Mat du couloir');
assert.deepStrictEqual(read.puzzle.category, ['Mats', 'Tactique']);
assert.strictEqual(read.puzzle.difficulty, 'facile');
assert.strictEqual(read.puzzle.description, 'Ligne 1\n\n# pas un champ\nLigne 3');
assert.strictEqual(C.field(prop.body, 'Pseudo (optionnel)'), 'anonyme');

// Champs optionnels vides -> « _No response_ », comme un vrai formulaire GitHub.
var bare = buildIssue({ kind: 'propose', fen: '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', solution: 'f1f8', author: 'Zoé' });
var rb = C.readPuzzleFields(bare.body).puzzle;
assert(rb.title === null && rb.category === null && rb.difficulty === null && rb.description === null);
assert.strictEqual(C.field(bare.body, 'Pseudo (optionnel)'), 'Zoé');

// Modification et suppression : mêmes libellés que les templates, étiquettes d'approbation habituelles.
var ed = buildIssue({ kind: 'edit', id: 'gh-30', fen: '6rk/3K2pp/8/4N3/8/8/8/8 w - - 0 1', solution: 'e5f7', title: 'Étouffé', reason: 'typo', description: 'Le cavalier mate.' });
assert.deepStrictEqual(ed.labels, ['edit-puzzle']);
assert.strictEqual(C.field(ed.body, 'Identifiant du problème'), 'gh-30');
assert.strictEqual(C.readPuzzleFields(ed.body).puzzle.description, 'Le cavalier mate.');
assert.strictEqual(C.field(ed.body, 'Raison de la modification (optionnel)'), 'typo');
var del = buildIssue({ kind: 'delete', ids: 'gh-1, gh-2', title: 'Doublon' });
assert.deepStrictEqual(del.labels, ['delete-puzzle']);
assert.strictEqual(C.field(del.body, 'Identifiant(s) du/des problème(s)'), 'gh-1 gh-2');

// Refus
assert(buildIssue({ kind: 'propose', fen: '', solution: 'e2e4' }).error);
assert(buildIssue({ kind: 'propose', fen: Array(200).join('x'), solution: 'e2e4' }).error);
assert(buildIssue({ kind: 'propose', fen: '7k/8/8/8/8/8/8/K7 w - - 0 1', solution: 'e2e4 ### x' }).error);
assert(buildIssue({ kind: 'propose', fen: '7k/8/8/8/8/8/8/K7 w - - 0 1', solution: 'a1a2', difficulty: 'expert' }).error);
assert(buildIssue({ kind: 'edit', id: 'gh 30; rm', fen: '7k/8/8/8/8/8/8/K7 w - - 0 1', solution: 'a1a2' }).error);
assert(buildIssue({ kind: 'hack' }).error);

// Point d'entrée HTTP, avec un faux GitHub.
process.env.GITHUB_TOKEN = 'test';
var sent = [];
global.fetch = function (url, opts) {
  sent.push({ url: url, opts: opts });
  // Comme le vrai GitHub avec une clé « fine-grained » : étiquettes ignorées à la création.
  return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({ number: 101, html_url: 'https://github.com/Turos14/chess/issues/101', labels: [] }); } });
};
function call(method, origin, body, ip) {
  return new Promise(function (resolve) {
    var res = { headers: {}, statusCode: 200, setHeader: function (k, v) { this.headers[k] = v; }, end: function (s) { resolve({ status: this.statusCode, headers: this.headers, json: s ? JSON.parse(s) : null }); } };
    handler({ method: method, headers: { origin: origin, 'x-forwarded-for': ip || '1.2.3.4' }, body: body }, res);
  });
}
var ORIGIN = 'https://turos14.github.io';
(async function () {
  var r = await call('OPTIONS', ORIGIN);
  assert.strictEqual(r.status, 204); assert.strictEqual(r.headers['Access-Control-Allow-Origin'], ORIGIN);
  r = await call('POST', 'https://pirate.example', { kind: 'delete', ids: 'gh-1' });
  assert.strictEqual(r.status, 403);
  r = await call('POST', ORIGIN, { kind: 'propose', fen: '7k/6pp/8/8/8/8/8/5R1K w - - 0 1', solution: 'f1f8' });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.json.number, 101);
  var payload = JSON.parse(sent[0].opts.body);
  assert.strictEqual(sent[0].url, 'https://api.github.com/repos/Turos14/chess/issues');
  assert.deepStrictEqual(payload.labels, ['puzzle-pending']);
  assert.strictEqual(sent[0].opts.headers.Authorization, 'Bearer test');
  assert.strictEqual(sent[1].url, 'https://api.github.com/repos/Turos14/chess/issues/101/labels');
  assert.deepStrictEqual(JSON.parse(sent[1].opts.body).labels, ['puzzle-pending']);
  sent.length = 1;
  r = await call('POST', ORIGIN, { kind: 'propose', fen: 'x', solution: 'f1f8' });
  assert.strictEqual(r.status, 400);
  r = await call('POST', ORIGIN, { kind: 'delete', ids: 'gh-1', website: 'spam' });   // champ piège
  assert(r.json.ok && sent.length === 1);
  for (var i = 0; i < 6; i++) r = await call('POST', ORIGIN, { kind: 'delete', ids: 'gh-1' }, '9.9.9.9');
  assert.strictEqual(r.status, 429);
  console.log('relais OK');
})().catch(function (e) { console.error(e); process.exit(1); });
