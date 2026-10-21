/* Relais des problèmes : transforme une demande envoyée par l'appli (proposer / modifier / supprimer un problème)
 * en ticket GitHub, au format exact des formulaires de .github/ISSUE_TEMPLATE/ (« ### <Libellé>\n\n<valeur> »),
 * pour que les Actions existantes (scripts/puzzle-*.js) le traitent sans changement. Module pur, testé sous Node
 * (test/relais.test.js) — aucune vérification d'échecs ici : la FEN et la solution sont revalidées par l'Action
 * avec public/js/chess.js avant toute publication (le site les a aussi vérifiées avant l'envoi).
 *
 * Étiquettes posées : une proposition attend l'approbation de Turos14 (`puzzle-pending`, puis `puzzle-approved`
 * posée à la main déclenche l'intégration) ; modification et suppression gardent leur circuit d'approbation
 * habituel (`edit-puzzle` + `edit-approved`, `delete-puzzle` + `delete-approved`). */
'use strict';

var LIMITS = { fen: 100, solution: 400, title: 80, author: 30, category: 120, description: 1000, reason: 300, id: 20, ids: 200 };
var DIFFICULTY_LABEL = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' };
var NO_RESPONSE = '_No response_';

function str(v) { return v == null ? '' : String(v); }

// Une seule ligne, sans caractères de contrôle ni « ### » qui casserait la lecture des champs du ticket.
function line(v) {
  return str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/#{3,}/g, '#').replace(/^\s+|\s+$/g, '');
}
// Plusieurs lignes autorisées (description), mais aucune ne doit commencer par « ### ».
function block(v) {
  return str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/^[ \t]*#{3,}/gm, '#').replace(/^\s+|\s+$/g, '');
}

function check(name, value, required) {
  if (required && !value) return 'Champ manquant : ' + name + '.';
  if (value.length > LIMITS[name]) return 'Champ trop long : ' + name + ' (' + LIMITS[name] + ' caractères maximum).';
  return null;
}

function body(fields) {
  return fields.map(function (f) { return '### ' + f[0] + '\n\n' + (f[1] || NO_RESPONSE); }).join('\n\n') + '\n';
}

// Champs communs à une proposition et à une modification. Retourne { error } ou { fields, title }.
function puzzleFields(d) {
  var fen = line(d.fen), solution = line(d.solution).split(/\s+/).join(' ');
  var title = line(d.title), category = line(d.category), description = block(d.description);
  var difficulty = d.difficulty ? DIFFICULTY_LABEL[line(d.difficulty).toLowerCase()] : '';
  var err = check('fen', fen, true) || check('solution', solution, true) || check('title', title) ||
    check('category', category) || check('description', description);
  if (err) return { error: err };
  if (d.difficulty && !difficulty) return { error: 'Niveau de difficulté invalide.' };
  if (!/^[1-8pnbrqkPNBRQK\/]+ [wb] [-A-Ha-hKQkq]+ [-a-h1-8]+( \d+ \d+)?$/.test(fen)) return { error: 'FEN invalide.' };
  if (!/^([a-h][1-8][a-h][1-8][qrbn]?)( [a-h][1-8][a-h][1-8][qrbn]?)*$/i.test(solution)) return { error: 'Solution invalide (coups UCI attendus, ex : e2e4).' };
  return {
    title: title,
    fields: [['FEN de départ', fen], ['Solution', solution], ['Titre (optionnel)', title]],
    tail: [['Catégorie (optionnel)', category], ['Niveau de difficulté (optionnel)', difficulty], ['Description (optionnel)', description]]
  };
}

// d : { kind: 'propose'|'edit'|'delete', ... }. Retourne { error } ou { title, body, labels }.
function buildIssue(d) {
  d = d || {};
  var p, id, err;
  if (d.kind === 'propose') {
    p = puzzleFields(d);
    if (p.error) return p;
    var author = line(d.author) || 'anonyme';
    if ((err = check('author', author))) return { error: err };
    return {
      title: '[Problème] ' + (p.title || 'sans titre'),
      body: body(p.fields.concat([['Pseudo (optionnel)', author]], p.tail)),
      labels: ['puzzle-pending']
    };
  }
  if (d.kind === 'edit') {
    id = line(d.id);
    if ((err = check('id', id, true))) return { error: err };
    if (!/^[\w-]+$/.test(id)) return { error: 'Identifiant invalide.' };
    var reason = line(d.reason);
    if ((err = check('reason', reason))) return { error: err };
    p = puzzleFields(d);
    if (p.error) return p;
    return {
      title: '[Modification] ' + (p.title || 'Problème #' + id) + ' (' + id + ')',
      body: body([['Identifiant du problème', id]].concat(p.fields, p.tail.slice(0, 2), [['Raison de la modification (optionnel)', reason]], p.tail.slice(2))),
      labels: ['edit-puzzle']
    };
  }
  if (d.kind === 'delete') {
    var ids = line(d.ids || d.id).split(/[\s,]+/).filter(function (s) { return s; }).join(' ');
    if ((err = check('ids', ids, true))) return { error: err };
    if (!/^[\w-]+( [\w-]+)*$/.test(ids)) return { error: 'Identifiant invalide.' };
    var why = line(d.reason);
    if ((err = check('reason', why))) return { error: err };
    return {
      title: '[Suppression] ' + (line(d.title).slice(0, LIMITS.title) || ids),
      body: body([['Identifiant(s) du/des problème(s)', ids], ['Raison (optionnel)', why]]),
      labels: ['delete-puzzle']
    };
  }
  return { error: 'Type de demande inconnu.' };
}

module.exports = { buildIssue: buildIssue, LIMITS: LIMITS };
