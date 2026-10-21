/* Point d'entrée du relais (fonction Vercel, Node 18+) : POST /api/submit depuis l'appli, sans compte GitHub.
 * Crée le ticket GitHub correspondant avec une clé gardée secrète côté serveur (variable GITHUB_TOKEN : jeton
 * « fine-grained » limité au dépôt, permission Issues en lecture/écriture). Configuration : voir relais/README.md.
 * Garde-fous : origine autorisée (CORS), champ piège anti-robot, limite d'envois par adresse IP (en mémoire,
 * approximative — le vrai filet reste l'approbation manuelle avant toute publication). */
'use strict';
var buildIssue = require('../lib/ticket.js').buildIssue;

var REPO = process.env.GITHUB_REPO || 'Turos14/chess';
var ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://turos14.github.io').split(',').map(function (s) { return s.trim(); });
var WINDOW_MS = 10 * 60 * 1000, MAX_PER_WINDOW = 5;
var hits = {};   // ip -> [horodatages]

function allowed(ip, now) {
  var list = (hits[ip] || []).filter(function (t) { return now - t < WINDOW_MS; });
  if (list.length >= MAX_PER_WINDOW) { hits[ip] = list; return false; }
  list.push(now); hits[ip] = list;
  return true;
}

function githubHeaders() {
  return {
    Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'echecs-relais',
    'Content-Type': 'application/json'
  };
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || '';
  if (ORIGINS.indexOf(origin) >= 0 || ORIGINS.indexOf('*') >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } else if (origin) {
    return send(res, 403, { error: 'Origine non autorisée.' });
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') {
    // Diagnostic sans rien créer : GET /api/submit?check=1 teste la clé GitHub en lecture sur le dépôt
    // (401 = clé invalide ou expirée, 404 = clé sans accès au dépôt). La clé elle-même n'est jamais renvoyée.
    if (!/[?&]check=1\b/.test(req.url || '')) return send(res, 200, { ok: true, service: 'relais des problèmes' });
    if (!process.env.GITHUB_TOKEN) return send(res, 200, { ok: false, token: 'absent' });
    try {
      var c = await fetch('https://api.github.com/repos/' + REPO + '/issues?per_page=1', { headers: githubHeaders() });
      return send(res, 200, { ok: c.ok, repo: REPO, github: c.status, origins: ORIGINS });
    } catch (e) { return send(res, 200, { ok: false, github: 'injoignable' }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée.' });
  if (!process.env.GITHUB_TOKEN) return send(res, 500, { error: 'Relais mal configuré (GITHUB_TOKEN manquant).' });

  var data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
  if (!data || typeof data !== 'object') return send(res, 400, { error: 'Demande illisible.' });
  if (data.website) return send(res, 200, { ok: true });   // champ piège rempli : robot, on ignore en silence

  var ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue';
  if (!allowed(ip, Date.now())) return send(res, 429, { error: 'Trop d’envois, réessaie dans quelques minutes.' });

  var issue = buildIssue(data);
  if (issue.error) return send(res, 400, { error: issue.error });

  var r;
  try {
    r = await fetch('https://api.github.com/repos/' + REPO + '/issues', {
      method: 'POST',
      headers: githubHeaders(),
      body: JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels })
    });
  } catch (e) {
    return send(res, 502, { error: 'GitHub injoignable, réessaie plus tard.' });
  }
  if (!r.ok) {
    var detail = '';
    try { detail = (await r.json()).message || ''; } catch (e) { /* ignore */ }
    console.error('GitHub a refusé la création du ticket', r.status, detail);
    return send(res, 502, { error: 'GitHub a refusé la demande (HTTP ' + r.status + (detail ? ' : ' + detail : '') + ').' });
  }
  var created = await r.json();
  return send(res, 200, { ok: true, number: created.number, url: created.html_url });
};
