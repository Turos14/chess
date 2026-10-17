#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-delete.yml à chaque ouverture/modification d'un ticket "delete-puzzle" :
 * n'agit que si le ticket a été ouvert par Turos14 (seul autorisé à faire supprimer un problème — contrairement
 * à l'ajout, rien dans le contenu d'une demande de suppression ne peut être validé automatiquement, donc le
 * contrôle se fait sur l'identité de l'auteur du ticket). Si l'auteur n'est pas Turos14 : commente le refus et
 * ferme le ticket (il n'y a rien à corriger en le modifiant, donc pas d'intérêt à le laisser ouvert, contrairement
 * à scripts/puzzle-intake.js). Si l'auteur est Turos14 : retire les identifiants demandés de
 * public/data/puzzles.json, commit + push (republie le site via le workflow de déploiement Pages), commente le
 * résultat et ferme le ticket. */
'use strict';
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var Chess = require(path.join(__dirname, '..', 'public', 'js', 'chess.js'));
void Chess; // non utilisé ici (pas de validation de contenu pour une suppression), gardé pour clarté d'intention

var ALLOWED_LOGIN = 'turos14';

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';
var login = process.env.ISSUE_LOGIN || '';

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

function closeIssue() { sh('gh issue close ' + issueNumber); }

if (login.toLowerCase() !== ALLOWED_LOGIN) {
  comment('❌ Seul **Turos14** peut demander la suppression d’un problème. Ce ticket a été ouvert par @' + login + ', il est donc refusé.');
  closeIssue();
  process.exit(0);
}

var idsRaw = field('Identifiant(s) du/des problème(s)');
if (!idsRaw) {
  comment('❌ Aucun identifiant fourni (ou champ illisible). Modifie ce ticket pour en indiquer au moins un : il sera revérifié automatiquement à l’enregistrement.');
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
closeIssue();
