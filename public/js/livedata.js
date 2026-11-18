/* Parties en direct : construit le corps JSON envoyé au relais (POST /api/live) à partir de l'état d'une partie.
 * Module pur (ES5, sans DOM ni réseau), testé sous Node ; l'envoi est dans live.js. Les listes de valeurs sont
 * identiques à celles du serveur (relais/lib/live.js).
 * JAMAIS de nom, de pseudo, de message de chat, de code de salle ni d'identifiant d'appareil : le corps est construit
 * champ par champ à partir des seuls coups, de la variante, de la pendule et du résultat. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveData = factory();
})(this, function () {
  'use strict';

  var MODES = ['local', 'ai', 'online', 'multi_local', 'multi_online'];
  var VARIANTS = ['classic', '960', 'yalta', 'cross4'];
  var REASONS = ['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty', 'resign', 'timeout', 'agreement', 'multi', 'quit'];
  var MAX_MOVES = 700;
  var GID_RE = /^[a-z0-9]{10,20}$/;
  var FEN_RE = /^[A-Za-z0-9\/ \-]{10,100}$/;
  var UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
  var ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';

  function has(list, v) { return list.indexOf(v) >= 0; }
  function isInt(n, min, max) { return typeof n === 'number' && n % 1 === 0 && n >= min && n <= max; }

  // Identifiant aléatoire de partie (12 caractères), sans lien avec l'appareil, le code de salle ni un nom
  function newGid() {
    var s = '', i;
    for (i = 0; i < 12; i++) s += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
    return s;
  }

  function promoLetter(p) {
    p = p ? String(p).toLowerCase() : '';
    return /^[qrbn]$/.test(p) ? p : '';
  }

  // Pendule : [base_ms, incrément_ms] ou null
  function tcOf(tc) {
    if (!tc) return null;
    var base = Math.round(Number(tc.base)), inc = Math.round(Number(tc.inc) || 0);
    if (!isInt(base, 0, 36000000) || !isInt(inc, 0, 300000)) return null;
    return [base, inc];
  }

  // Raison et gagnant d'une partie à deux : res = {reason, winner:'w'|'b'|null}
  function endTwo(res) {
    if (!res || !has(REASONS, res.reason)) return null;
    return { r: res.reason, w: res.winner === 'w' || res.winner === 'b' ? res.winner : 'd' };
  }

  // Fin d'une partie à plusieurs : winners = liste de camps (vide ou null = nulle)
  function endMulti(winners) {
    var w = [], i;
    for (i = 0; winners && i < winners.length; i++) if (isInt(winners[i], 0, 3) && w.indexOf(winners[i]) < 0) w.push(winners[i]);
    return { r: 'multi', w: w };
  }

  function bodyBase(gid, m, vr) {
    if (!GID_RE.test(String(gid)) || !has(MODES, m) || !has(VARIANTS, vr)) return null;
    return { v: 1, gid: gid, m: m, 'var': vr };
  }

  // Partie à deux (chess.js). opts : {gid, mode:'local'|'ai'|'online', variant:'classic'|'960', startFen, history:[{from,to,promo}],
  // tc:{base,inc}|null, result:{reason, winner}|null, quit:bool}. null si le corps ne peut pas être valide (ex. trop de coups).
  function buildTwo(opts) {
    var vr = opts.variant === '960' ? '960' : 'classic';
    if (opts.mode !== 'local' && opts.mode !== 'ai' && opts.mode !== 'online') return null;
    var b = bodyBase(opts.gid, opts.mode, vr), mv = [], h = opts.history || [], i, s;
    if (!b || h.length > MAX_MOVES) return null;
    if (vr === '960' && typeof opts.startFen === 'string' && FEN_RE.test(opts.startFen)) b.sf = opts.startFen;
    for (i = 0; i < h.length; i++) {
      s = String(h[i].from) + String(h[i].to) + promoLetter(h[i].promo);
      if (!UCI_RE.test(s)) return null;
      mv.push(s);
    }
    b.mv = mv;
    var tc = tcOf(opts.tc);
    if (tc) b.tc = tc;
    if (opts.result) { var e = endTwo(opts.result); if (e) b.end = e; }
    else if (opts.quit) b.end = { r: 'quit' };
    return b;
  }

  // Partie à plusieurs (multichess.js). opts : {gid, mode:'local'|'online', variant:'yalta'|'cross4', teams, history:[{from,to,promo}|{resign}],
  // over:bool, winners:[camps], quit:bool}
  function buildMulti(opts) {
    var vr = opts.variant;
    if (vr !== 'yalta' && vr !== 'cross4') return null;
    if (opts.mode !== 'local' && opts.mode !== 'online') return null;
    var b = bodyBase(opts.gid, 'multi_' + opts.mode, vr), mv = [], h = opts.history || [], i, a, s;
    if (!b || h.length > MAX_MOVES) return null;
    if (vr === 'cross4' && opts.teams) b.teams = true;
    for (i = 0; i < h.length; i++) {
      a = h[i];
      if (a.resign != null) s = 'r' + a.resign;
      else s = String(a.from) + '-' + String(a.to) + promoLetter(a.promo);
      if (!/^(?:r[0-3]|(?:0|[1-9]\d{0,2})-(?:0|[1-9]\d{0,2})[qrbn]?)$/.test(s)) return null;
      mv.push(s);
    }
    b.mv = mv;
    if (opts.over) b.end = endMulti(opts.winners);
    else if (opts.quit) b.end = { r: 'quit' };
    return b;
  }

  // Corps « retirer la partie du direct »
  function buildStop(gid) {
    if (!GID_RE.test(String(gid))) return null;
    return { v: 1, gid: gid, stop: true };
  }

  return {
    newGid: newGid, buildTwo: buildTwo, buildMulti: buildMulti, buildStop: buildStop, endTwo: endTwo, endMulti: endMulti,
    MODES: MODES, VARIANTS: VARIANTS, REASONS: REASONS, MAX_MOVES: MAX_MOVES, GID_RE: GID_RE
  };
});
