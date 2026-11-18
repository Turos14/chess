var assert = require('assert');
var S = require('../public/js/statsdata.js');

function d(ua, touch) { return S.detect(ua, { maxTouchPoints: touch || 0 }); }
function is(r, b, o) { assert.deepStrictEqual(r, { b: b, o: o }); }

// --- Détection navigateur / système
is(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), 'chrome', 'windows');
is(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'), 'edge', 'windows');
is(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'), 'opera', 'windows');
is(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0 (Edition GX)'), 'opera', 'windows');
is(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'), 'firefox', 'windows');
is(d('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'), 'safari', 'ios');
is(d('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'), 'chrome', 'ios');
is(d('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15'), 'firefox', 'ios');
// iPadOS en mode bureau : se présente comme un Mac, mais l'écran est tactile
var mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
is(d(mac, 5), 'safari', 'ios');
is(d(mac, 0), 'safari', 'mac');
is(d('Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'), 'samsung', 'android');
is(d('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'), 'chrome', 'android');
is(d('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0'), 'edge', 'android');
is(d('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'), 'chrome', 'linux');
is(d('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'), 'firefox', 'linux');
is(d('curl/8.0'), 'other', 'other');
is(d(undefined), 'other', 'other');

// --- Nettoyage des événements
assert.deepStrictEqual(S.clean({ e: 'app_open' }), { e: 'app_open' });
assert.deepStrictEqual(S.clean({ e: 'app_open', name: 'Alice', m: 'local' }), { e: 'app_open' });            // propriété inconnue retirée
assert.deepStrictEqual(S.clean({ e: 'game_start', m: 'local', 'var': '960', nom: 'x' }), { e: 'game_start', m: 'local', 'var': '960' });
assert.deepStrictEqual(S.clean({ e: 'game_start', m: 'local', 'var': 960 }), { e: 'game_start', m: 'local', 'var': '960' });
assert.deepStrictEqual(S.clean({ e: 'game_start', m: 'robot', 'var': 'classic' }), { e: 'game_start', 'var': 'classic' });   // valeur hors liste
assert.deepStrictEqual(S.clean({ e: 'game_end', m: 'ai', r: 'resign' }), { e: 'game_end', m: 'ai', r: 'resign' });
assert.deepStrictEqual(S.clean({ e: 'online_error', k: 'webrtc', ph: 'game', g: 'duo' }), { e: 'online_error', k: 'webrtc', ph: 'game', g: 'duo' });
assert.deepStrictEqual(S.clean({ e: 'online_ok', role: 'host', g: 'multi' }), { e: 'online_ok', role: 'host', g: 'multi' });
assert.deepStrictEqual(S.clean({ e: 'chat_msg', g: 'duo', text: 'salut' }), { e: 'chat_msg', g: 'duo' });
assert.strictEqual(S.clean({ e: 'inconnu' }), null);
assert.strictEqual(S.clean({ e: 'constructor' }), null);
assert.strictEqual(S.clean({ e: 'toString' }), null);
assert.strictEqual(S.clean({}), null);
assert.strictEqual(S.clean(null), null);
assert.strictEqual(S.clean('app_open'), null);

// --- Type d'erreur réseau
assert.strictEqual(S.errorKind('Serveur de mise en relation injoignable.'), 'server');
assert.strictEqual(S.errorKind('Partie introuvable. Vérifie le code (l’hôte doit être connecté).'), 'peer_unavailable');
assert.strictEqual(S.errorKind('Partie introuvable ou hôte hors ligne.'), 'peer_unavailable');
assert.strictEqual(S.errorKind('La connexion directe a échoué.'), 'webrtc');
assert.strictEqual(S.errorKind('Délai dépassé lors de la connexion au serveur de mise en relation.'), 'timeout');
assert.strictEqual(S.errorKind('L’hôte de la partie ne répond pas.'), 'timeout');
assert.strictEqual(S.errorKind('L’hôte a quitté la partie.'), 'host_lost');
assert.strictEqual(S.errorKind('Connexion perdue avec l’hôte.'), 'host_lost');
assert.strictEqual(S.errorKind('Autre chose'), 'other');
assert.strictEqual(S.errorKind(null), 'other');

console.log('statsdata: OK');
