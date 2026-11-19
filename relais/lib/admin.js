/* Outils de l'admin du relais : session signée (HMAC), mot de passe comparé en temps constant, lecture des
 * tickets de problèmes (découpage du corps en champs, type de demande) et nettoyage de la raison d'un refus.
 * Module sans réseau, testé par test/relaisadmin.test.js. */
'use strict';
var crypto = require('crypto');
var neutralize = require('./ticket.js').neutralize;

var SESSION_S = 2 * 60 * 60;
var COOKIE = 'admin_session';
var NO_RESPONSE = '_No response_';
var REASON_MAX = 300;

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
// Comparaison en temps constant : on compare des condensés de même longueur.
function safeEqual(a, b) { return crypto.timingSafeEqual(sha256(a), sha256(b)); }

function checkPassword(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  return safeEqual(given, expected);
}

// Clé HMAC : ADMIN_SESSION_SECRET si défini, sinon dérivée du mot de passe (le changer invalide les sessions).
function sessionKey(env) {
  if (env.ADMIN_SESSION_SECRET) return String(env.ADMIN_SESSION_SECRET);
  return crypto.createHash('sha256').update('admin-session:' + (env.ADMIN_PASSWORD || '')).digest('hex');
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function mac(key, payload) { return crypto.createHmac('sha256', key).update(payload).digest('base64url'); }

// Jeton `<payload>.<signature>` ; payload = { exp } (ms).
function signSession(env, nowMs) {
  var payload = b64url(JSON.stringify({ exp: nowMs + SESSION_S * 1000 }));
  return payload + '.' + mac(sessionKey(env), payload);
}
function verifySession(env, token, nowMs) {
  if (typeof token !== 'string' || !env.ADMIN_PASSWORD) return false;
  var parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  if (!safeEqual(parts[1], mac(sessionKey(env), parts[0]))) return false;
  var p;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return false; }
  return !!p && typeof p.exp === 'number' && p.exp > nowMs;
}

function cookieValue(header, name) {
  var out = null;
  String(header || '').split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    if (part.slice(0, i).trim() === name && out === null) out = part.slice(i + 1).trim();
  });
  return out;
}
function sessionCookie(token) {
  return COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + SESSION_S;
}
function clearCookie() { return COOKIE + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'; }

// Corps du ticket (« ### <Libellé>\n\n<valeur> ») -> { libellé: valeur }. Les U+200B sont retirés, « _No response_ » -> "".
function splitFields(body) {
  var out = {}, name = null, buf = [];
  function flush() {
    if (name === null) return;
    var v = buf.join('\n').replace(/^\s+|\s+$/g, '');
    out[name] = v === NO_RESPONSE ? '' : v;
  }
  String(body || '').replace(/​/g, '').replace(/\r\n?/g, '\n').split('\n').forEach(function (l) {
    var m = /^### (.+?)\s*$/.exec(l);
    if (m) { flush(); name = m[1]; buf = []; } else if (name !== null) buf.push(l);
  });
  flush();
  return out;
}

// Étiquettes qui font entrer un ticket dans la file, et celles que l'admin pose à l'approbation.
var KINDS = [
  // `legacy` : étiquette des tickets ouverts directement sur GitHub (ancien formulaire, plus traités automatiquement).
  { kind: 'propose', pending: 'puzzle-pending', legacy: 'puzzle', approved: 'puzzle-approved' },
  { kind: 'edit', pending: 'edit-puzzle', approved: 'edit-approved' },
  { kind: 'delete', pending: 'delete-puzzle', approved: 'delete-approved' }
];
function labelNames(labels) {
  return (labels || []).map(function (l) { return typeof l === 'string' ? l : (l && l.name) || ''; });
}
// Type de demande en attente d'approbation, ou null.
function kindOf(labels) {
  var names = labelNames(labels), i;
  for (i = 0; i < KINDS.length; i++) {
    if (names.indexOf(KINDS[i].approved) >= 0) continue;
    if (names.indexOf(KINDS[i].pending) >= 0 || (KINDS[i].legacy && names.indexOf(KINDS[i].legacy) >= 0)) return KINDS[i].kind;
  }
  return null;
}
function approvedLabel(kind) {
  var i;
  for (i = 0; i < KINDS.length; i++) if (KINDS[i].kind === kind) return KINDS[i].approved;
  return null;
}

// Étiquettes à interroger pour remplir la file (étiquettes d'attente, anciennes comprises).
function queueLabels() {
  var out = [];
  KINDS.forEach(function (k) { out.push(k.pending); if (k.legacy) out.push(k.legacy); });
  return out;
}
// Requêtes d'étiquetage de l'approbation, dans l'ordre : un ticket ancien (`puzzle` sans `puzzle-pending`) reçoit
// d'abord `puzzle-pending` (requête séparée), puis l'étiquette d'approbation, car le workflow exige `puzzle-pending`
// au moment de l'évènement « labeled » de `puzzle-approved`.
function approveSteps(kind, labels) {
  var names = labelNames(labels), steps = [], i;
  for (i = 0; i < KINDS.length; i++) {
    if (KINDS[i].kind !== kind) continue;
    if (names.indexOf(KINDS[i].pending) < 0) steps.push([KINDS[i].pending]);
    steps.push([KINDS[i].approved]);
  }
  return steps;
}

// Raison d'un refus : une ligne, ≤ 300 caractères, mentions neutralisées (le commentaire est posté avec le jeton).
function cleanReason(v) {
  var s = v == null ? '' : String(v);
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').replace(/#{3,}/g, '#').replace(/^\s+|\s+$/g, '');
  return neutralize(s).slice(0, REASON_MAX);
}

module.exports = {
  checkPassword: checkPassword, signSession: signSession, verifySession: verifySession, cookieValue: cookieValue,
  sessionCookie: sessionCookie, clearCookie: clearCookie, splitFields: splitFields, kindOf: kindOf,
  approvedLabel: approvedLabel, queueLabels: queueLabels, approveSteps: approveSteps, labelNames: labelNames, cleanReason: cleanReason, KINDS: KINDS, COOKIE: COOKIE, SESSION_S: SESSION_S
};
