var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Chess = require('../public/js/chess.js');

// Garde-fou : les problèmes fournis avec le site doivent toujours être une FEN + solution légales,
// vérifiées avec le même moteur que le site et que l'Action GitHub d'intégration (scripts/puzzle-intake.js).
var list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'puzzles.json'), 'utf8'));
assert(Array.isArray(list) && list.length > 0, 'la liste de problèmes de départ ne doit pas être vide');

var ids = {};
list.forEach(function (p) {
  assert(!ids[p.id], 'id de problème en double : ' + p.id);
  ids[p.id] = true;
  assert(typeof p.fen === 'string' && p.fen, 'FEN manquante pour #' + p.id);
  assert(Array.isArray(p.solution) && p.solution.length > 0, 'solution manquante pour #' + p.id);

  var g = new Chess.Game(p.fen);   // doit analyser sans exception
  p.solution.forEach(function (u, i) {
    var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(u);
    assert(m, 'coup mal formé pour #' + p.id + ' (' + u + ')');
    var rec = g.move(m[1], m[2], m[3] || null);
    assert(rec, 'coup illégal pour #' + p.id + ' au ply ' + (i + 1) + ' (' + u + ')');
  });
});

console.log('OK : ' + list.length + ' problèmes vérifiés');
