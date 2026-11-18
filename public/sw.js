/* Service worker : permet d'installer l'appli et de l'ouvrir sans connexion. ES5.
 * Stratégie « réseau d'abord » : en ligne, on prend toujours la version la plus récente du site (le cache-busting
 * manuel « ?v=N » reste donc efficace, aucun risque de voir une ancienne version) et on la range en cache ; hors
 * ligne, on sert la copie en cache. Seules les requêtes GET de ce site sont gérées : le serveur PeerJS, le relais
 * et tout ce qui est à une autre adresse passent directement sur le réseau. Le cache change à chaque « ?v=N »
 * (sw.js?v=N est enregistré par app.js) et les anciens sont supprimés. Les parties en ligne restent impossibles
 * hors connexion : seul le reste de l'appli fonctionne. */
(function () {
  'use strict';
  var m = /[?&]v=(\d+)/.exec(self.location.search || '');
  var CACHE = 'echecs-v' + (m ? m[1] : '0');
  var Q = m ? '?v=' + m[1] : '';
  var PIECES = [
    'pieces/wK.svg',
    'pieces/wQ.svg',
    'pieces/wR.svg',
    'pieces/wB.svg',
    'pieces/wN.svg',
    'pieces/wP.svg',
    'pieces/bK.svg',
    'pieces/bQ.svg',
    'pieces/bR.svg',
    'pieces/bB.svg',
    'pieces/bN.svg',
    'pieces/bP.svg',
    'pieces/rK.svg',
    'pieces/rQ.svg',
    'pieces/rR.svg',
    'pieces/rB.svg',
    'pieces/rN.svg',
    'pieces/rP.svg',
    'pieces/uK.svg',
    'pieces/uQ.svg',
    'pieces/uR.svg',
    'pieces/uB.svg',
    'pieces/uN.svg',
    'pieces/uP.svg',
    'pieces/yK.svg',
    'pieces/yQ.svg',
    'pieces/yR.svg',
    'pieces/yB.svg',
    'pieces/yN.svg',
    'pieces/yP.svg',
    'pieces/gK.svg',
    'pieces/gQ.svg',
    'pieces/gR.svg',
    'pieces/gB.svg',
    'pieces/gN.svg',
    'pieces/gP.svg'
  ];

  // Fichiers de l'appli (scripts, feuilles de style, icônes…) lus dans index.html pour ne rien oublier quand on en ajoute
  function assetsOf(html) {
    var out = [], re = /(?:src|href)="([^"#]+)"/g, r;
    while ((r = re.exec(html))) if (!/^(?:[a-z]+:)?\/\//i.test(r[1]) && r[1].indexOf('data:') !== 0) out.push(r[1]);
    return out;
  }

  self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CACHE).then(function (cache) {
      return fetch('index.html', { cache: 'no-cache' }).then(function (r) {
        return r.text().then(function (html) {
          var list = ['./', 'index.html', 'data/puzzles.json', 'icons/icon-512.png', 'vendor/stockfish.js?v=6', 'vendor/stockfish.wasm',
            'vendor/peerjs.min.js' + Q].concat(PIECES, assetsOf(html));
          // Un fichier manquant ne doit pas empêcher l'installation : on ajoute un par un
          return Promise.all(list.map(function (u) { return cache.add(new Request(u, { cache: 'no-cache' })).catch(function () { /* ignoré */ }); }));
        });
      });
    }).then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('echecs-v') === 0 && k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); }));
  });

  // La liste des problèmes est demandée avec « ?t=<horodatage> » : on la range sans cette partie variable.
  function keyOf(req, url) {
    return /\/data\/puzzles\.json$/.test(url.pathname) ? new Request(url.origin + url.pathname) : req;
  }

  self.addEventListener('fetch', function (e) {
    var req = e.request, url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    var key = keyOf(req, url);
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(key, copy); }).catch(function () { /* ignoré */ });
        }
        return res;
      }).catch(function () {
        return caches.match(key).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('index.html').then(function (p) { return p || caches.match('./'); });
          return Response.error();
        });
      })
    );
  });
})();
