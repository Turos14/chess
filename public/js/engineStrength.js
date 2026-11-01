/* Calibration Elo -> réglages du moteur — module pur (aucun DOM, aucun Worker), testable sous Node.
 * Le moteur vendu ici (Stockfish.js 10, voir public/vendor/) n'a PAS les options UCI_LimitStrength/UCI_Elo des
 * versions récentes (vérifié : absentes de son option-list) — seule « Skill Level » (0-20, injecte des erreurs)
 * existe. On calibre donc nous-mêmes Skill Level à partir de la correspondance Elo approximative généralement
 * admise pour ce réglage (~1320 en bas, pleine force autour de 20), et on étend la plage vers le bas (sous 1320)
 * en piochant au hasard parmi plusieurs des meilleurs coups plutôt qu'en imposant le meilleur — Skill Level seul
 * ne descend pas assez bas pour un vrai débutant. Approximatif par nature : c'est un calibrage relatif au
 * classement Elo (local, propre à l'appareil) de l'application, pas une mesure FIDE.
 * Le temps de réflexion est tiré au hasard entre MOVE_TIME_MIN et MOVE_TIME_MAX à chaque coup, quel que soit le
 * niveau (sur demande explicite) : l'IA ne joue pas à un rythme mécanique. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EngineStrength = factory();
})(this, function () {
  'use strict';

  var FLOOR_ELO = 400;          // en dessous : traité comme 400 (déjà très faible avec randomTop au max)
  var SKILL_FLOOR_ELO = 1320;   // en dessous : Skill Level reste à 0, on ajoute de l'aléa à la place
  var CEIL_ELO = 2900;          // au-delà : Skill Level 20 (déjà bien plus fort que la plupart des joueurs)
  var MOVE_TIME_MIN = 1000;     // temps de réflexion par coup : tiré entre ces deux bornes (ms), à tous les niveaux
  var MOVE_TIME_MAX = 2000;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Temps de réflexion d'un coup (ms), uniforme dans [MOVE_TIME_MIN, MOVE_TIME_MAX]. rand : 0 <= x < 1 (Math.random par défaut).
  function moveTime(rand) {
    var r = typeof rand === 'number' ? rand : Math.random();
    return MOVE_TIME_MIN + Math.floor(clamp(r, 0, 0.999999) * (MOVE_TIME_MAX - MOVE_TIME_MIN + 1));
  }

  // elo -> { skill: 0-20, randomTop: nombre de meilleurs coups parmi lesquels piocher (1 = toujours le meilleur) }
  function paramsFor(elo) {
    var e = Math.round(Number(elo));
    if (!isFinite(e)) e = 1200;
    e = clamp(e, FLOOR_ELO, CEIL_ELO);
    if (e >= SKILL_FLOOR_ELO) {
      var t = (e - SKILL_FLOOR_ELO) / (CEIL_ELO - SKILL_FLOOR_ELO);
      return { skill: Math.round(t * 20), randomTop: 1 };
    }
    var u = (SKILL_FLOOR_ELO - e) / (SKILL_FLOOR_ELO - FLOOR_ELO);   // 0 (juste sous le plancher) -> 1 (FLOOR_ELO)
    return {
      skill: 0,
      randomTop: 1 + Math.round(u * 4)          // jusqu'à piocher parmi les 5 meilleurs coups
    };
  }

  return { paramsFor: paramsFor, FLOOR_ELO: FLOOR_ELO, SKILL_FLOOR_ELO: SKILL_FLOOR_ELO, CEIL_ELO: CEIL_ELO, moveTime: moveTime,
    MOVE_TIME_MIN: MOVE_TIME_MIN, MOVE_TIME_MAX: MOVE_TIME_MAX };
});
