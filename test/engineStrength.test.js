var assert = require('assert');
var ES = require('../public/js/engineStrength.js');

// Monotone : plus l'Elo visé est haut, plus le moteur est fort (skill en hausse, aléa en baisse) ;
// le temps de réflexion est tiré à chaque coup entre 1 et 2 s, quel que soit le niveau.
var elos = [200, 400, 800, 1100, 1320, 1600, 2000, 2400, 2900, 3200];
var prev = null;
elos.forEach(function (e) {
  var p = ES.paramsFor(e);
  assert(p.skill >= 0 && p.skill <= 20, 'skill hors bornes pour ' + e);
  assert(p.randomTop >= 1, 'randomTop >= 1 pour ' + e);
  if (prev) {
    assert(p.skill >= prev.skill, 'skill doit croître (' + e + ')');
    assert(p.randomTop <= prev.randomTop, 'randomTop doit décroître (' + e + ')');
  }
  prev = p;
});
assert.strictEqual(ES.MOVE_TIME_MIN, 1000);
assert.strictEqual(ES.MOVE_TIME_MAX, 2000);
assert.strictEqual(ES.moveTime(0), 1000);
assert.strictEqual(ES.moveTime(0.5), 1500);
assert.strictEqual(ES.moveTime(0.9999999), 2000);
assert.strictEqual(ES.moveTime(1), 2000);          // borne haute incluse, jamais au-delà
assert.strictEqual(ES.moveTime(-3), 1000);
for (var k = 0; k < 500; k++) {
  var t = ES.moveTime();
  assert(t >= 1000 && t <= 2000 && t === Math.floor(t), 'moveTime aléatoire hors bornes : ' + t);
}

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
