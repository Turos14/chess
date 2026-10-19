/* Outils communs aux scripts lancés par les Actions GitHub sur les tickets de problèmes
 * (scripts/puzzle-intake.js, scripts/puzzle-edit.js) : lecture des champs d'un ticket créé via un formulaire
 * GitHub, validation d'un problème avec le vrai moteur d'échecs (public/js/chess.js, le même que le site),
 * commentaires sur le ticket et publication de public/data/puzzles.json. */
'use strict';
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var Chess = require(path.join(__dirname, '..', 'public', 'js', 'chess.js'));

var DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'puzzles.json');
var DIFFICULTY_MAP = { 'Facile': 'facile', 'Moyen': 'moyen', 'Difficile': 'difficile' };
var DESCRIPTION_MAX = 1000;

function sh(cmd) { return cp.execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }); }

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Le corps d'un ticket créé via un formulaire GitHub est formaté en "### <Label>\n\n<valeur>" par champ.
function field(body, label) {
  var re = new RegExp('### ' + escapeRe(label) + '\\s*\\n+([^\\n]*)');
  var m = body.match(re);
  if (!m) return '';
  var v = m[1].replace(/^\s+|\s+$/g, '');
  return v === '_No response_' ? '' : v;
}

// Champ sur plusieurs lignes (textarea) : tout jusqu'au titre de champ suivant ("### …") ou la fin du ticket.
function fieldBlock(body, label) {
  var re = new RegExp('### ' + escapeRe(label) + '[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |$)');
  var m = body.match(re);
  if (!m) return '';
  var v = m[1].replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '');
  return v === '_No response_' ? '' : v;
}

// Lit et valide les champs communs à une proposition et à une modification.
// Retourne { error: '…' } ou { puzzle: {fen, solution, title, category, difficulty, description} }.
function readPuzzleFields(body) {
  var fen = field(body, 'FEN de départ');
  var solutionRaw = field(body, 'Solution');
  var title = field(body, 'Titre (optionnel)') || null;
  // Plusieurs catégories possibles, séparées par des virgules : stockées en liste (un onglet par catégorie sur le
  // site), ou en simple texte s'il n'y en a qu'une (format historique).
  var categories = field(body, 'Catégorie (optionnel)').split(',').map(function (c) { return c.replace(/^\s+|\s+$/g, ''); }).filter(function (c) { return c; });
  var category = categories.length > 1 ? categories : (categories[0] || null);
  var difficultyLabel = field(body, 'Niveau de difficulté (optionnel)');
  var difficulty = difficultyLabel ? DIFFICULTY_MAP[difficultyLabel] : null;
  var description = fieldBlock(body, 'Description (optionnel)') || null;

  if (!fen) return { error: 'FEN manquante (ou champ illisible).' };
  if (!solutionRaw) return { error: 'Solution manquante.' };
  if (difficultyLabel && !difficulty) return { error: 'Niveau de difficulté invalide : « ' + difficultyLabel + ' » (attendu : Facile, Moyen ou Difficile).' };
  if (description && description.length > DESCRIPTION_MAX) return { error: 'Description trop longue (' + description.length + ' caractères, maximum ' + DESCRIPTION_MAX + ').' };

  var uci = solutionRaw.replace(/^\s+|\s+$/g, '').split(/\s+/).filter(function (s) { return s; });
  if (!uci.length) return { error: 'Solution manquante.' };

  var game;
  try { game = new Chess.Game(fen); } catch (e) { return { error: 'FEN invalide : ' + e.message }; }
  for (var i = 0; i < uci.length; i++) {
    var m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(uci[i]);
    if (!m) return { error: 'Coup illisible : « ' + uci[i] + ' » (format attendu : e2e4, ou e7e8q pour une promotion).' };
    var rec = null;
    try { rec = game.move(m[1], m[2], m[3] || null); } catch (e) { rec = null; }
    if (!rec) return { error: 'Le coup n°' + (i + 1) + ' (« ' + uci[i] + ' ») n’est pas légal dans cette position.' };
  }
  return { puzzle: { fen: fen, solution: uci, title: title, category: category, difficulty: difficulty, description: description } };
}

function comment(issueNumber, msg) {
  var f = path.join(require('os').tmpdir(), 'puzzle-comment-' + issueNumber + '.md');
  fs.writeFileSync(f, msg);
  sh('gh issue comment ' + issueNumber + ' --body-file ' + JSON.stringify(f));
}

function loadList() { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }

// Écrit la liste, commit + push si elle a changé, puis déclenche le déploiement. Retourne false si rien n'a changé.
function publish(list, commitMsg) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2) + '\n');
  sh('git config user.name "github-actions[bot]"');
  sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  sh('git add public/data/puzzles.json');
  if (cp.spawnSync('git', ['diff', '--cached', '--quiet']).status === 0) return false;
  sh('git commit -m ' + JSON.stringify(commitMsg.replace(/"/g, '\'')));
  sh('git push');
  // Un push effectué avec le GITHUB_TOKEN par défaut ne redéclenche pas les autres workflows déclenchés sur
  // "push" (limitation volontaire de GitHub, anti-boucle) : .github/workflows/deploy.yml ne se relancerait
  // donc jamais tout seul. On le déclenche explicitement (il a un trigger workflow_dispatch prévu pour ça).
  try { sh('gh workflow run deploy.yml --ref main'); console.log('Déploiement Pages déclenché.'); }
  catch (e) { console.log('Avertissement : déclenchement du déploiement impossible (' + e.message + ').'); }
  return true;
}

module.exports = {
  sh: sh, field: field, fieldBlock: fieldBlock, readPuzzleFields: readPuzzleFields,
  comment: comment, loadList: loadList, publish: publish, DESCRIPTION_MAX: DESCRIPTION_MAX
};
