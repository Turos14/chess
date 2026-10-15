#!/usr/bin/env node
/* Lancé par .github/workflows/puzzle-intake.yml à chaque ouverture/modification d'un ticket "puzzle" :
 * relit le corps du ticket (formulaire GitHub), valide la FEN et la solution avec le vrai moteur
 * d'échecs (public/js/chess.js, le même que le site), puis :
 *  - si valide : ajoute/met à jour le problème dans public/data/puzzles.json, commit + push (republie
 *    le site via le workflow de déploiement Pages), commente et ferme le ticket ;
 *  - sinon : commente l'erreur et laisse le ticket ouvert (une modification du ticket relance ce script).
 * Utilise `gh` (préinstallé sur les runners GitHub, authentifié via GH_TOKEN) pour commenter/fermer. */
'use strict';
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var Chess = require(path.join(__dirname, '..', 'public', 'js', 'chess.js'));

var issueNumber = process.env.ISSUE_NUMBER;
var body = process.env.ISSUE_BODY || '';
var login = process.env.ISSUE_LOGIN || 'quelqu’un';

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
  var f = path.join(require('os').tmpdir(), 'puzzle-comment.md');
  fs.writeFileSync(f, msg);
  sh('gh issue comment ' + issueNumber + ' --body-file ' + JSON.stringify(f));
}

function fail(msg) {
  comment('❌ ' + msg + '\n\nModifie ce ticket (le champ en cause) : il sera revérifié automatiquement à l’enregistrement.');
  console.log('Rejeté : ' + msg);
  process.exit(0);
}

var fen = field('FEN de départ');
var solutionRaw = field('Solution');
var title = field('Titre (optionnel)') || null;
var author = field('Pseudo (optionnel)') || login;

if (!fen) fail('FEN manquante (ou champ illisible).');
if (!solutionRaw) fail('Solution manquante.');

var uci = solutionRaw.replace(/^\s+|\s+$/g, '').split(/\s+/).filter(function (s) { return s; });
if (!uci.length) fail('Solution manquante.');

var game;
try { game = new Chess.Game(fen); } catch (e) { fail('FEN invalide : ' + e.message); }

var moves = [];
for (var i = 0; i < uci.length; i++) {
  var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(uci[i]);
  if (!m) fail('Coup illisible : « ' + uci[i] + ' » (format attendu : e2e4, ou e7e8q pour une promotion).');
  moves.push({ from: m[1], to: m[2], promo: m[3] || null });
}
for (var j = 0; j < moves.length; j++) {
  var rec = null;
  try { rec = game.move(moves[j].from, moves[j].to, moves[j].promo); } catch (e) { rec = null; }
  if (!rec) fail('Le coup n°' + (j + 1) + ' (« ' + uci[j] + ' ») n’est pas légal dans cette position.');
}

var dataPath = path.join(__dirname, '..', 'public', 'data', 'puzzles.json');
var list = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
var num = parseInt(issueNumber, 10);
var puzzle = { id: num, fen: fen, solution: uci, title: title, author: author, addedAt: Date.now() };
var idx = -1;
for (var k = 0; k < list.length; k++) if (list[k].id === num) idx = k;
if (idx >= 0) list[idx] = puzzle; else list.push(puzzle);
fs.writeFileSync(dataPath, JSON.stringify(list, null, 2) + '\n');

sh('git config user.name "github-actions[bot]"');
sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
sh('git add public/data/puzzles.json');
var diff = cp.spawnSync('git', ['diff', '--cached', '--quiet']);
if (diff.status !== 0) {
  var safeTitle = title ? title.replace(/"/g, '\'') : null;
  sh('git commit -m ' + JSON.stringify('Ajoute le problème #' + num + (safeTitle ? ' (' + safeTitle + ')' : '')));
  sh('git push');
  console.log('Publié : problème #' + num);
} else {
  console.log('Rien à committer (identique à la version précédente).');
}

comment('✅ Problème ajouté ! Visible sur le site d’ici une minute (le temps que la page se republie).');
sh('gh issue close ' + issueNumber);
