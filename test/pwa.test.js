// Installation de l'appli : le manifeste, les icônes et la liste de pièces du service worker doivent rester cohérents.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var PUB = path.join(__dirname, '..', 'public');

var man = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));
['name', 'short_name', 'start_url', 'display', 'icons', 'id', 'scope'].forEach(function (k) { assert.ok(man[k], 'manifest.' + k); });
assert.strictEqual(man.display, 'standalone');

function pngSize(file) {
  var b = fs.readFileSync(file);
  assert.strictEqual(b.slice(1, 4).toString(), 'PNG', file);
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}
var purposes = {};
man.icons.forEach(function (ic) {
  var f = path.join(PUB, ic.src);
  assert.ok(fs.existsSync(f), 'icône absente : ' + ic.src);
  if (ic.type === 'image/png') assert.strictEqual(pngSize(f), ic.sizes, ic.src + ' : taille déclarée ≠ réelle');
  purposes[ic.sizes + ' ' + (ic.purpose || 'any')] = true;
});
['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable'].forEach(function (k) { assert.ok(purposes[k], 'icône manquante : ' + k); });
assert.strictEqual(pngSize(path.join(PUB, 'icons/icon-180.png')), '180x180');   // apple-touch-icon

var html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
assert.ok(/rel="manifest"/.test(html) && /rel="apple-touch-icon"/.test(html));

// Service worker : syntaxe, et chaque pièce de sa liste existe
var sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
new Function(sw);   // lève si la syntaxe est invalide
var listed = sw.match(/'pieces\/[A-Za-z]+\.svg'/g) || [];
assert.strictEqual(listed.length, 36, 'pièces listées');
listed.forEach(function (p) { assert.ok(fs.existsSync(path.join(PUB, p.slice(1, -1))), p); });
assert.ok(/serviceWorker/.test(fs.readFileSync(path.join(PUB, 'js/app.js'), 'utf8')), 'app.js enregistre le service worker');

console.log('pwa OK');
