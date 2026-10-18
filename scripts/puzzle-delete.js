#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-delete.yml à chaque ouverture/modification/étiquetage d'un ticket
 * "delete-puzzle" — mais le job ne tourne (voir le `if` du workflow) que si l'étiquette `delete-approved` est
 * présente en plus de `delete-puzzle`. N'importe qui peut ouvrir un tel ticket (la 1ère étiquette est automatique,
 * posée par le template) ; seul Turos14 peut faire aboutir une suppression, en ajoutant `delete-approved` à la
 * main depuis GitHub une fois la demande vérifiée — ce script n'a donc plus de vérification à faire lui-même,
 * l'approbation a déjà eu lieu avant qu'il ne s'exécute. Retire les identifiants demandés de
 * public/data/puzzles.json, commit + push (republie le site via le workflow de déploiement Pages), commente le
 * résultat et ferme le ticket. */
'use strict';
var path = require('path');
var fs = require('fs');
var cp = require('child_process');

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';

function sh(cmd) { return cp.execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }); }

// Le corps d'un ticket créé via un formulaire GitHub est formaté en "### <Label>\n\n<valeur>" par champ.
function field(label) {
  var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('### ' + escaped + '\\s*\\n+([^\\n]*)');
  var m = body.match(re);
  if (!m) return '';
  var v = m[1].replace(/^\s+|\s+$/g, '');
  return v === '_No response_' ? '' : v;
}

function comment(msg) {
  var f = path.join(require('os').tmpdir(), 'puzzle-delete-comment.md');
  fs.writeFileSync(f, msg);
  sh('gh issue comment ' + issueNumber + ' --body-file ' + JSON.stringify(f));
}

var idsRaw = field('Identifiant(s) du/des problème(s)');
if (!idsRaw) {
  comment('❌ Aucun identifiant fourni (ou champ illisible). Modifie ce ticket pour en indiquer au moins un.');
  console.log('Rejeté : identifiants manquants.');
  process.exit(0);
}
var ids = idsRaw.split(/[\s,]+/).filter(function (s) { return s; });

var dataPath = path.join(__dirname, '..', 'public', 'data', 'puzzles.json');
var list = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

var removed = [], notFound = [];
ids.forEach(function (id) {
  var idx = -1;
  for (var k = 0; k < list.length; k++) if (list[k].id === id) idx = k;
  if (idx >= 0) { list.splice(idx, 1); removed.push(id); } else { notFound.push(id); }
});

if (removed.length) {
  fs.writeFileSync(dataPath, JSON.stringify(list, null, 2) + '\n');
  sh('git config user.name "github-actions[bot]"');
  sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  sh('git add public/data/puzzles.json');
  sh('git commit -m ' + JSON.stringify('Supprime le(s) problème(s) ' + removed.join(', ') + ' (#' + issueNumber + ')'));
  sh('git push');
  console.log('Supprimé(s) : ' + removed.join(', '));
  // Comme dans scripts/puzzle-intake.js : un push avec le GITHUB_TOKEN par défaut ne redéclenche pas
  // .github/workflows/deploy.yml (trigger "push"), donc on le déclenche explicitement.
  try { sh('gh workflow run deploy.yml --ref main'); console.log('Déploiement Pages déclenché.'); }
  catch (e) { console.log('Avertissement : déclenchement du déploiement impossible (' + e.message + ').'); }
}

var msg = '';
if (removed.length) msg += '✅ Supprimé(s) : ' + removed.map(function (i) { return '`' + i + '`'; }).join(', ') + '.\n';
if (notFound.length) msg += (msg ? '\n' : '') + '⚠️ Introuvable(s) (déjà supprimé ou identifiant invalide) : ' + notFound.map(function (i) { return '`' + i + '`'; }).join(', ') + '.\n';
if (removed.length) msg += '\nVisible sur le site d’ici une minute (le temps que la page se republie).';
comment(msg);
sh('gh issue close ' + issueNumber);
