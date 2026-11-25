/* Comptes de l'admin du relais. Le compte « admin » (mot de passe ADMIN_PASSWORD) a tous les droits et est le seul à
 * pouvoir créer, modifier ou supprimer les autres comptes. Les autres comptes sont gardés dans Redis (hash
 * `admin:users`, champ = identifiant, valeur = JSON) avec un mot de passe haché (scrypt + sel) et une liste de droits.
 * `v` change à chaque nouveau mot de passe : les sessions ouvertes avec l'ancien deviennent invalides.
 * Module sans réseau, testé par test/relaisadmin.test.js. */
'use strict';
var crypto = require('crypto');

var ROOT = 'admin';
var KEY = 'admin:users';
// Droits, dans l'ordre d'affichage : un droit = un onglet de la page admin.
var PERMS = ['mod', 'live', 'stats', 'log'];
var NAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
var PW_MIN = 10, PW_MAX = 200;

function normName(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
// Identifiant d'un compte secondaire : 2 à 32 caractères a-z 0-9 _ . -, « admin » réservé.
function validName(n) { return typeof n === 'string' && NAME_RE.test(n) && n !== ROOT; }
function cleanPerms(list) {
  if (!Array.isArray(list)) return [];
  return PERMS.filter(function (p) { return list.indexOf(p) >= 0; });
}
// Message d'erreur, ou null si le mot de passe est acceptable.
function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < PW_MIN) return 'Mot de passe trop court (' + PW_MIN + ' caractères minimum).';
  if (pw.length > PW_MAX) return 'Mot de passe trop long.';
  return null;
}

function scrypt(pw, salt) { return crypto.scryptSync(String(pw), salt, 32); }
function hashPassword(pw) {
  var salt = crypto.randomBytes(16).toString('hex');
  return { salt: salt, hash: scrypt(pw, salt).toString('hex') };
}
function verifyPassword(pw, rec) {
  if (typeof pw !== 'string' || !pw || !rec || typeof rec.salt !== 'string' || typeof rec.hash !== 'string') return false;
  var want = Buffer.from(rec.hash, 'hex');
  if (want.length !== 32) return false;
  return crypto.timingSafeEqual(scrypt(pw, rec.salt), want);
}
function newVersion() { return crypto.randomBytes(8).toString('hex'); }

// Nouveau compte (enregistrement complet, avec le haché).
function makeAccount(name, pw, perms, nowMs) {
  var h = hashPassword(pw);
  return { name: name, salt: h.salt, hash: h.hash, v: newVersion(), perms: cleanPerms(perms), createdAt: nowMs, updatedAt: nowMs };
}
function parse(s) {
  var o;
  try { o = JSON.parse(s); } catch (e) { return null; }
  return o && typeof o === 'object' && typeof o.name === 'string' ? o : null;
}
// Ce que l'API renvoie d'un compte : jamais le haché ni le sel.
function publicAccount(rec) {
  return { name: rec.name, perms: cleanPerms(rec.perms), createdAt: rec.createdAt || 0, updatedAt: rec.updatedAt || 0 };
}

// Identité d'une session : { name, root, perms }.
function rootIdentity() { return { name: ROOT, root: true, perms: PERMS.slice() }; }
function identityOf(rec) { return { name: rec.name, root: false, perms: cleanPerms(rec.perms) }; }
function can(who, perm) { return !!who && (who.root || who.perms.indexOf(perm) >= 0); }

module.exports = {
  ROOT: ROOT, KEY: KEY, PERMS: PERMS, PW_MIN: PW_MIN, normName: normName, validName: validName, cleanPerms: cleanPerms,
  passwordError: passwordError, hashPassword: hashPassword, verifyPassword: verifyPassword, newVersion: newVersion,
  makeAccount: makeAccount, parse: parse, publicAccount: publicAccount, rootIdentity: rootIdentity, identityOf: identityOf, can: can
};
