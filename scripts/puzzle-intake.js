#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-intake.yml à chaque ouverture/modification d'un ticket "puzzle" :
 * relit le corps du ticket (formulaire GitHub), valide la FEN et la solution avec le vrai moteur
 * d'échecs (public/js/chess.js, le même que le site), puis :
 *  - si valide : ajoute/met à jour le problème dans public/data/puzzles.json, commit + push (republie
 *    le site via le workflow de déploiement Pages), commente et ferme le ticket ;
 *  - sinon : commente l'erreur et laisse le ticket ouvert (une modification du ticket relance ce script).
 * Utilise `gh` (préinstallé sur les runners GitHub, authentifié via GH_TOKEN) pour commenter/fermer.
 * Lecture/validation des champs et publication : scripts/puzzle-common.js (partagé avec puzzle-edit.js). */
'use strict';
var C = require('./puzzle-common.js');

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';
var login = process.env.ISSUE_LOGIN || 'quelqu’un';

var read = C.readPuzzleFields(body);
if (read.error) {
  C.comment(issueNumber, '❌ ' + read.error + '\n\nModifie ce ticket (le champ en cause) : il sera revérifié automatiquement à l’enregistrement.');
  console.log('Rejeté : ' + read.error);
  process.exit(0);
}

var list = C.loadList();
var num = parseInt(issueNumber, 10);
// Préfixé pour ne jamais entrer en collision avec les id des problèmes du jeu de départ (public/data/puzzles.json),
// ni avec rien d'autre : les numéros de ticket GitHub sont uniques et strictement croissants pour ce dépôt.
var id = 'gh-' + num;
var p = read.puzzle;
var puzzle = {
  id: id, fen: p.fen, solution: p.solution, title: p.title, author: C.field(body, 'Pseudo (optionnel)') || login,
  category: p.category, difficulty: p.difficulty, description: p.description, addedAt: Date.now()
};
var idx = -1;
for (var k = 0; k < list.length; k++) if (list[k].id === id) idx = k;
if (idx >= 0) list[idx] = puzzle; else list.push(puzzle);

if (C.publish(list, 'Ajoute le problème #' + num + (p.title ? ' (' + p.title + ')' : ''))) console.log('Publié : problème #' + num);
else console.log('Rien à committer (identique à la version précédente).');

C.comment(issueNumber, '✅ Problème ajouté ! Visible sur le site d’ici une minute (le temps que la page se republie).');
C.sh('gh issue close ' + issueNumber);
