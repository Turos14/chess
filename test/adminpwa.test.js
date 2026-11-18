// Installation de la page admin : manifeste, icônes (mêmes fichiers que le logo choisi) et liens dans la page.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var ADMIN = path.join(__dirname, '..', 'relais', 'admin');

var man = JSON.parse(fs.readFileSync(path.join(ADMIN, 'manifest.webmanifest'), 'utf8'));
['name', 'short_name', 'start_url', 'scope', 'id', 'display', 'icons'].forEach(function (k) { assert.ok(man[k], 'manifest.' + k); });
assert.strictEqual(man.display, 'standalone');
assert.strictEqual(man.start_url, '/admin/');
assert.ok(man.start_url.indexOf(man.scope) === 0, 'start_url dans le scope');

function pngSize(file) {
  var b = fs.readFileSync(file);
  assert.strictEqual(b.slice(1, 4).toString(), 'PNG', file);
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}
var seen = {};
man.icons.forEach(function (ic) {
  var f = path.join(ADMIN, ic.src);
  assert.ok(fs.existsSync(f), 'icône absente : ' + ic.src);
  if (ic.type === 'image/png') assert.strictEqual(pngSize(f), ic.sizes, ic.src);
  seen[ic.sizes + ' ' + (ic.purpose || 'any')] = true;
});
['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable'].forEach(function (k) { assert.ok(seen[k], 'icône manquante : ' + k); });
assert.strictEqual(pngSize(path.join(ADMIN, 'icons/icon-180.png')), '180x180');

var html = fs.readFileSync(path.join(ADMIN, 'index.html'), 'utf8');
assert.ok(/rel="manifest" href="manifest\.webmanifest"/.test(html));
assert.ok(/rel="apple-touch-icon" href="icons\/icon-180\.png"/.test(html));
assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), 'aucun script en ligne (CSP)');
// Pas de service worker dans l'admin (données de modération : rien ne doit être mis en cache hors ligne)
assert.ok(!fs.existsSync(path.join(ADMIN, 'sw.js')));
console.log('admin pwa OK');
