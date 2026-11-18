/* Service worker de nettoyage : l'appli publique n'en utilise plus (installation / hors ligne retirés). Une version
 * précédente a pu être enregistrée chez quelques visiteurs ; ce fichier, au même emplacement, la remplace, vide
 * son cache et se désinscrit. Sans effet pour les autres (jamais enregistré). À supprimer dans quelques mois. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('echecs-v') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.unregister(); }).then(function () { return self.clients.matchAll(); })
    .then(function (list) { list.forEach(function (c) { try { c.navigate(c.url); } catch (err) { /* ignoré */ } }); }));
});
