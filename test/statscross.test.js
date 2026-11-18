// L'appli (public/js/statsdata.js) et le relais (relais/lib/stats.js) doivent autoriser exactement les mêmes
// événements et valeurs : sinon des statistiques envoyées seraient ignorées sans bruit par le serveur.
var assert = require('assert');
var client = require('../public/js/statsdata.js');
var server = require('../relais/lib/stats.js');

assert.deepStrictEqual(client.BROWSERS, server.BROWSERS);
assert.deepStrictEqual(client.SYSTEMS, server.SYSTEMS);
assert.deepStrictEqual(Object.keys(client.EVENTS).sort(), Object.keys(server.EVENTS).sort());
Object.keys(server.EVENTS).forEach(function (e) {
  assert.deepStrictEqual(client.EVENTS[e], server.EVENTS[e], 'propriétés de ' + e);
  // Chaque valeur autorisée, nettoyée par l'appli, est comptée par le serveur
  var spec = server.EVENTS[e];
  Object.keys(spec).forEach(function (p) {
    spec[p].forEach(function (val) {
      var ev = { e: e }; ev[p] = val; ev.inconnu = 'x';
      var c = client.clean(ev);
      assert.ok(c && !('inconnu' in c), e + '.' + p);
      var r = server.parse({ v: 1, b: 'chrome', o: 'windows', pwa: false, ver: 36, events: [c] });
      assert.strictEqual(r.fields['e=' + e + '|' + p + '=' + val], 1, e + '|' + p + '=' + val);
    });
  });
});
console.log('statscross OK');
