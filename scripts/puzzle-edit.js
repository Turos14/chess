#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-edit.yml quand l'étiquette `edit-approved` est ajoutée à un ticket
 * "edit-puzzle". N'importe qui peut ouvrir un tel ticket (bouton « Modif. » du site, la 1ère étiquette est posée
 * par le template), mais seul Turos14 peut le faire aboutir en posant `edit-approved` à la main une fois la
 * demande vérifiée. Le ticket contient le problème complet tel qu'il doit devenir (pré-rempli par le site avec les
 * valeurs actuelles) : un champ optionnel vidé est donc effacé. L'id, l'auteur et la date d'ajout sont conservés.
 * Revalide avec le vrai moteur d'échecs, met à jour public/data/puzzles.json, commit + push, commente et ferme. */
'use strict';
var C = require('./puzzle-common.js');

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';

function fail(msg) {
  C.comment(issueNumber, '❌ ' + msg + '\n\nCorrige ce ticket, puis retire et remets l’étiquette `edit-approved` pour relancer la modification.');
  console.log('Rejeté : ' + msg);
  process.exit(0);
}

var id = C.field(body, 'Identifiant du problème');
if (!id) fail('Identifiant du problème manquant (ou champ illisible).');

var list = C.loadList();
var idx = -1;
for (var k = 0; k < list.length; k++) if (list[k].id === id) idx = k;
if (idx < 0) fail('Problème `' + id + '` introuvable (déjà supprimé, ou identifiant invalide).');

var read = C.readPuzzleFields(body);
if (read.error) fail(read.error);

var old = list[idx], p = read.puzzle;
list[idx] = {
  id: old.id, fen: p.fen, solution: p.solution, title: p.title, author: old.author,
  category: p.category, difficulty: p.difficulty, description: p.description,
  addedAt: old.addedAt, editedAt: Date.now()
};

var changed = C.publish(list, 'Modifie le problème ' + id + ' (#' + issueNumber + ')');
console.log(changed ? 'Modifié : ' + id : 'Rien à committer (identique).');
C.comment(issueNumber, changed
  ? '✅ Problème `' + id + '` modifié ! Visible sur le site d’ici une minute (le temps que la page se republie).'
  : 'ℹ️ Aucune différence avec la version actuelle de `' + id + '` : rien à modifier.');
C.sh('gh issue close ' + issueNumber);
