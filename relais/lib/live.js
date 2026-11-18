/* Parties en direct : validation du corps reçu de l'appli (POST /api/live) et normalisation. Module pur (aucun
 * réseau ici), testé par test/relaislive.test.js. Seuls les champs listés ci-dessous sont conservés : jamais de
 * nom, de pseudo, de message de chat, de code de salle ni d'adresse IP ; tout champ inconnu est ignoré.
 * Les listes exportées (MODES, VARS, REASONS…) servent à un test croisé avec l'appli (public/js/livedata.js). */
'use strict';

var MODES = ['local', 'ai', 'online', 'multi_local', 'multi_online'];
var VARS = ['classic', '960', 'yalta', 'cross4'];
var TWO_MODES = ['local', 'ai', 'online'];            // parties à deux (chess.js) : variantes classic / 960
var MULTI_MODES = ['multi_local', 'multi_online'];    // parties à plusieurs : variantes yalta / cross4
var REASONS = ['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty', 'resign', 'timeout', 'agreement', 'multi', 'quit'];
var WINNERS = ['w', 'b', 'd'];
var MAX_MOVES = 700;
var MAX_TC_BASE = 36000000, MAX_TC_INC = 300000;
var GID_RE = /^[a-z0-9]{10,20}$/;
var FEN_RE = /^[A-Za-z0-9\/ \-]{10,100}$/;
var UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
var MULTI_MV_RE = /^(?:0|[1-9]\d{0,2})-(?:0|[1-9]\d{0,2})[qrbn]?$/;
var MULTI_RESIGN_RE = /^r[0-3]$/;

function isInt(n, min, max) { return typeof n === 'number' && n % 1 === 0 && n >= min && n <= max; }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// data : objet déjà décodé. Retourne { error } ou { gid, stop: true } ou { gid, game }.
function parse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Corps illisible.' };
  if (data.v !== 1) return { error: 'Version inconnue.' };
  if (typeof data.gid !== 'string' || !GID_RE.test(data.gid)) return { error: 'Identifiant de partie invalide.' };
  var gid = data.gid;
  if (data.stop === true) return { gid: gid, stop: true };

  if (typeof data.m !== 'string' || MODES.indexOf(data.m) < 0) return { error: 'Mode invalide.' };
  var multi = MULTI_MODES.indexOf(data.m) >= 0;
  var vr = data['var'];
  if (typeof vr !== 'string' || VARS.indexOf(vr) < 0) return { error: 'Variante invalide.' };
  if (multi ? (vr !== 'yalta' && vr !== 'cross4') : (vr !== 'classic' && vr !== '960')) return { error: 'Variante incompatible avec le mode.' };

  if (!Array.isArray(data.mv) || data.mv.length > MAX_MOVES) return { error: 'Liste de coups invalide.' };
  var mv = [], i, s;
  for (i = 0; i < data.mv.length; i++) {
    s = data.mv[i];
    if (typeof s !== 'string' || !(multi ? (MULTI_MV_RE.test(s) || MULTI_RESIGN_RE.test(s)) : UCI_RE.test(s))) return { error: 'Coup invalide.' };
    mv.push(s);
  }
  var game = { m: data.m, 'var': vr, mv: mv };

  if (vr === '960' && data.sf !== undefined) {
    if (typeof data.sf !== 'string' || !FEN_RE.test(data.sf)) return { error: 'Position de départ invalide.' };
    game.sf = data.sf;
  }
  if (vr === 'cross4' && data.teams !== undefined) {
    if (typeof data.teams !== 'boolean') return { error: 'Champ teams invalide.' };
    game.teams = data.teams;
  }
  if (!multi && data.tc !== undefined) {
    var tc = data.tc;
    if (!Array.isArray(tc) || tc.length !== 2 || !isInt(tc[0], 0, MAX_TC_BASE) || !isInt(tc[1], 0, MAX_TC_INC)) return { error: 'Pendule invalide.' };
    game.tc = [tc[0], tc[1]];
  }
  if (data.end !== undefined) {
    var e = data.end;
    if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.r !== 'string' || REASONS.indexOf(e.r) < 0) return { error: 'Fin de partie invalide.' };
    var end = { r: e.r };
    if (e.r !== 'quit' || e.w !== undefined) {
      if (multi) {
        if (!Array.isArray(e.w) || e.w.length > 4) return { error: 'Gagnants invalides.' };
        var ws = [];
        for (i = 0; i < e.w.length; i++) {
          if (!isInt(e.w[i], 0, 3) || ws.indexOf(e.w[i]) >= 0) return { error: 'Gagnants invalides.' };
          ws.push(e.w[i]);
        }
        end.w = ws;
      } else {
        if (typeof e.w !== 'string' || WINNERS.indexOf(e.w) < 0) return { error: 'Gagnant invalide.' };
        end.w = e.w;
      }
    }
    game.end = end;
  }
  return { gid: gid, game: game };
}

var TTL_PLAYING_S = 900, TTL_ENDED_S = 3600, START_TTL_S = 86400;
var PLAYING_MS = TTL_PLAYING_S * 1000, ENDED_MS = TTL_ENDED_S * 1000;

// Commandes Redis (pipeline) pour le résultat de parse() à l'instant `at` (ms).
function commands(parsed, at) {
  var gid = parsed.gid, key = 'live:' + gid, st = 'live:st:' + gid;
  if (parsed.stop) return [['DEL', key, st], ['ZREM', 'live:idx', gid]];
  var stored = {};
  Object.keys(parsed.game).forEach(function (k) { stored[k] = parsed.game[k]; });
  stored.at = at;
  return [
    ['SET', key, JSON.stringify(stored), 'EX', parsed.game.end ? TTL_ENDED_S : TTL_PLAYING_S],
    ['SET', st, String(at), 'NX', 'EX', START_TTL_S],
    ['ZADD', 'live:idx', at, gid]
  ];
}

module.exports = {
  parse: parse, commands: commands,
  MODES: MODES, VARS: VARS, TWO_MODES: TWO_MODES, MULTI_MODES: MULTI_MODES, REASONS: REASONS, WINNERS: WINNERS,
  MAX_MOVES: MAX_MOVES, MAX_TC_BASE: MAX_TC_BASE, MAX_TC_INC: MAX_TC_INC,
  GID_RE: GID_RE, FEN_RE: FEN_RE, UCI_RE: UCI_RE, MULTI_MV_RE: MULTI_MV_RE, MULTI_RESIGN_RE: MULTI_RESIGN_RE,
  PLAYING_MS: PLAYING_MS, ENDED_MS: ENDED_MS
};
