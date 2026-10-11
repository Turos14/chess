var assert = require('assert');
var ES = require('../public/js/engineStrength.js');

// Monotone : plus l'Elo visé est haut, plus le moteur est fort (skill en hausse, aléa en baisse) ;
// le temps de réflexion est fixe (2 s) quel que soit le niveau.
var elos = [200, 400, 800, 1100, 1320, 1600, 2000, 2400, 2900, 3200];
var prev = null;
elos.forEach(function (e) {
  var p = ES.paramsFor(e);
  assert(p.skill >= 0 && p.skill <= 20, 'skill hors bornes pour ' + e);
  assert.strictEqual(p.moveTime, 2000, 'moveTime fixe à 2000 ms pour ' + e);
  assert(p.randomTop >= 1, 'randomTop >= 1 pour ' + e);
  if (prev) {
    assert(p.skill >= prev.skill, 'skill doit croître (' + e + ')');
    assert(p.randomTop <= prev.randomTop, 'randomTop doit décroître (' + e + ')');
  }
  prev = p;
});
assert.strictEqual(ES.MOVE_TIME, 2000);

// Bornes et valeurs extrêmes
assert.strictEqual(ES.paramsFor(100).skill, 0);
assert.strictEqual(ES.paramsFor(100).randomTop, 5);          // en dessous du plancher : aléa maximal
assert.strictEqual(ES.paramsFor(ES.CEIL_ELO).skill, 20);
assert.strictEqual(ES.paramsFor(ES.CEIL_ELO).randomTop, 1);
assert.strictEqual(ES.paramsFor(99999).skill, 20);            // clampé en haut
assert.strictEqual(ES.paramsFor(-500).randomTop, 5);          // clampé en bas
assert.strictEqual(ES.paramsFor(ES.SKILL_FLOOR_ELO).skill, 0);
assert.strictEqual(ES.paramsFor(ES.SKILL_FLOOR_ELO).randomTop, 1);
assert.strictEqual(ES.paramsFor('abc').skill, ES.paramsFor(1200).skill);   // valeur invalide -> repli 1200
assert.strictEqual(ES.paramsFor(null).skill, ES.paramsFor(1200).skill);

console.log('engineStrength OK');
