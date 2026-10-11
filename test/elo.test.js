var assert = require('assert');
var Elo = require('../public/js/elo.js');

// Éligibilité
assert.strictEqual(Elo.eligible('Alice', 'Bob'), true);
assert.strictEqual(Elo.eligible('', 'Bob'), false);
assert.strictEqual(Elo.eligible('Alice', ''), false);
assert.strictEqual(Elo.eligible('Alice', 'Alice'), false);
assert.strictEqual(Elo.eligible('alice', ' ALICE '), false);
assert.strictEqual(Elo.eligible('Blancs', 'Bob'), false);
assert.strictEqual(Elo.eligible('Alice', 'Noirs'), false);
assert.strictEqual(Elo.eligible('Joueur', 'Bob'), false);
assert.strictEqual(Elo.eligible('Alice', 'Spectateur'), false);

// Partie non éligible : la base n'est pas modifiée
var db = Elo.newDb();
var r = Elo.apply(db, 'Blancs', 'Noirs', '1-0');
assert.strictEqual(r.applied, false);
assert.strictEqual(Object.keys(db.players).length, 0);

// Première partie : deux joueurs à 1200, victoire des Blancs -> K=40, E=0.5 -> ±20
db = Elo.newDb();
r = Elo.apply(db, 'Alice', 'Bob', '1-0', 'local', 1000);
assert.strictEqual(r.applied, true);
assert.strictEqual(r.w.before, 1200); assert.strictEqual(r.b.before, 1200);
assert.strictEqual(r.w.delta, 20); assert.strictEqual(r.b.delta, -20);
assert.strictEqual(r.w.after, 1220); assert.strictEqual(r.b.after, 1180);
var alice = Elo.player(db, 'alice');
assert.strictEqual(alice.games, 1); assert.strictEqual(alice.wins, 1); assert.strictEqual(alice.rating, 1220);

// Nulle : le favori (Alice, 1220) recule légèrement, l'outsider (Bob) avance
r = Elo.apply(db, 'Alice', 'Bob', '1/2-1/2', 'local', 2000);
assert.strictEqual(r.applied, true);
assert.strictEqual(r.w.delta, -2); assert.strictEqual(r.b.delta, 2);

// Insensible à la casse et aux espaces ; conserve la dernière orthographe saisie ; cumule les stats
r = Elo.apply(db, '  alice ', 'BOB', '0-1', 'local', 3000);
assert.strictEqual(r.applied, true);
assert.strictEqual(Elo.player(db, 'Alice').name, 'alice');
assert.strictEqual(Elo.player(db, 'bob').name, 'BOB');
assert.strictEqual(Elo.player(db, 'Alice').games, 3);
assert.strictEqual(Elo.player(db, 'Alice').losses, 1);
assert.strictEqual(Elo.player(db, 'Bob').wins, 1);

// Le facteur K décroît avec l'expérience
assert.strictEqual(Elo.kFactor(0), 40);
assert.strictEqual(Elo.kFactor(19), 40);
assert.strictEqual(Elo.kFactor(20), 30);
assert.strictEqual(Elo.kFactor(39), 30);
assert.strictEqual(Elo.kFactor(40), 20);

// Classement trié par note décroissante
db = Elo.newDb();
Elo.apply(db, 'A', 'B', '1-0', null, 1);
Elo.apply(db, 'A', 'C', '1-0', null, 2);
var list = Elo.list(db);
assert.strictEqual(list.length, 3);
assert.strictEqual(list[0].name, 'A');
assert(list[0].rating > list[1].rating);

// Historique borné (30 entrées), le plus récent en tête
db = Elo.newDb();
for (var i = 0; i < 35; i++) Elo.apply(db, 'A', 'B', i % 2 ? '1-0' : '0-1', null, i);
var a = Elo.player(db, 'A');
assert.strictEqual(a.history.length, 30);
assert.strictEqual(a.history[0].date, 34);
assert.strictEqual(a.games, 35);

// Note de départ personnalisée pour un joueur inédit
db = Elo.newDb();
r = Elo.apply(db, 'Nouveau', 'Chevronné', '1-0', 'manual', 1000, 1500, 1800);
assert.strictEqual(r.applied, true);
assert.strictEqual(r.w.before, 1500); assert.strictEqual(r.b.before, 1800);
var expW = 1 / (1 + Math.pow(10, (1800 - 1500) / 400));
assert.strictEqual(r.w.delta, Math.round(40 * (1 - expW)));

// Une note de départ n'écrase jamais un joueur déjà existant (seulement à la création)
r = Elo.apply(db, 'Nouveau', 'Chevronné', '0-1', 'manual', 2000, 999999, 999999);
assert.strictEqual(Elo.player(db, 'Nouveau').games, 2);
assert.notStrictEqual(r.w.before, 999999);

// Note de départ invalide ou hors bornes : repli sur la note par défaut
db = Elo.newDb();
r = Elo.apply(db, 'A', 'B', '1-0', null, 1, NaN, -50);
assert.strictEqual(r.w.before, Elo.DEFAULT_RATING);
assert.strictEqual(r.b.before, Elo.DEFAULT_RATING);
db = Elo.newDb();
r = Elo.apply(db, 'A', 'B', '1-0', null, 1, 9999, 'texte');
assert.strictEqual(r.w.before, Elo.DEFAULT_RATING);
assert.strictEqual(r.b.before, Elo.DEFAULT_RATING);
db = Elo.newDb();
r = Elo.apply(db, 'A', 'B', '1-0', null, 1, Elo.MIN_RATING, Elo.MAX_RATING);
assert.strictEqual(r.w.before, Elo.MIN_RATING);
assert.strictEqual(r.b.before, Elo.MAX_RATING);

console.log('elo OK');
