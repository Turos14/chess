#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-delete.yml à chaque ouverture/modification d'un ticket "delete-puzzle" :
 * n'agit que si le bon mot de passe (secret du dépôt PUZZLE_DELETE_PASSWORD) est fourni dans le ticket —
 * contrairement à l'ajout, rien dans le contenu d'une demande de suppression ne peut être validé automatiquement,
 * donc le contrôle se fait sur un secret partagé plutôt que sur l'identité de l'auteur du ticket.
 * Le champ "Mot de passe" est effacé du corps du ticket juste après lecture (succès ou échec) : un ticket est
 * public, donc ce mot de passe ne reste pas vraiment secret une fois utilisé (le retrait limite l'exposition
 * sans l'annuler complètement — l'historique de modification d'un ticket public reste accessible). Si le mot de
 * passe est incorrect : commente l'erreur et laisse le ticket ouvert (le corriger relance la vérification). Si
 * correct : retire les identifiants demandés de public/data/puzzles.json, commit + push (republie le site via le
 * workflow de déploiement Pages), commente le résultat et ferme le ticket. */
'use strict';
var path = require('path');
var fs = require('fs');
var cp = require('child_process');

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';
var expectedPassword = process.env.DELETE_PASSWORD || '';

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

// Retire la valeur du champ "Mot de passe" du corps public du ticket, que la vérification ait réussi ou non.
function redactPassword() {
  var re = /(### Mot de passe\s*\n+)([^\n]*)/;
  if (!re.test(body)) return;
  var redacted = body.replace(re, '$1(effacé automatiquement après lecture)');
  var f = path.join(require('os').tmpdir(), 'puzzle-delete-body.md');
  fs.writeFileSync(f, redacted);
  try { sh('gh issue edit ' + issueNumber + ' --body-file ' + JSON.stringify(f)); }
  catch (e) { console.log('Avertissement : effacement du mot de passe impossible (' + e.message + ').'); }
}

var password = field('Mot de passe');
redactPassword();

if (!expectedPassword) {
  comment('❌ Suppression désactivée : aucun mot de passe n’est configuré côté dépôt (secret `PUZZLE_DELETE_PASSWORD` manquant).');
  sh('gh issue close ' + issueNumber);
  console.log('Rejeté : secret PUZZLE_DELETE_PASSWORD manquant.');
  process.exit(0);
}

if (!password || password !== expectedPassword) {
  comment('❌ Mot de passe incorrect (ou manquant). Modifie ce ticket avec le bon mot de passe : il sera revérifié automatiquement à l’enregistrement.');
  console.log('Rejeté : mot de passe incorrect.');
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
sh('gh issue close ' + issueNumber);
