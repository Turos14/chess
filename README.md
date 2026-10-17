# Échecs — pendule, parties locales et en ligne

Application web en JS / CSS / HTML (sans framework, code ES5 pour les anciens iOS / Android).

## Fonctions

- **Pendule seule** : deux moitiés d'écran face à face (celle du haut est retournée), bandeau central
  de la couleur du joueur dont c'est le tour, avec 3 boutons ronds (pause, plein écran, quitter).
  Les Blancs touchent leur moitié pour lancer la pendule, puis chaque joueur touche la sienne à la fin de son tour.
  Réglages : temps (et incrément) par joueur, alertes silencieux / vibreur / son. Quitter demande confirmation.
- **Partie d'échecs locale** (2 joueurs, sans IA) : règles complètes (roque, prise en passant, promotion, mat, pat,
  nulle par répétition / 50 coups / matériel insuffisant), pendule optionnelle, vue inversée / alternée,
  mode « face à face » (pièces du joueur du haut retournées), abandon, nulle.
- **Partie en ligne** (pair-à-pair, comme l'app poker) : créer une partie (code à 5 caractères) ou la rejoindre avec un
  nom d'utilisateur, mode **spectateur** avec le même code, abandon / nulle, pendule. **Si l'hôte se déconnecte, un autre
  participant prend automatiquement le relais** (les joueurs passent avant les spectateurs), la pendule est figée pendant
  la bascule, et chacun retrouve son siège. Un joueur qui revient (« Reprendre ») retrouve sa place.
- **Partie contre l'IA** (Stockfish, calibré approximativement sur l'Elo visé) : choisis ta couleur, le niveau
  de l'IA (pré-rempli avec ton Elo actuel si ton nom est suivi), avec ou sans pendule. L'IA ne compte jamais pour
  le classement : ta note sert à régler sa force, dans un seul sens. Le niveau est modifiable **en cours de
  partie** (menu « Niveau de l'IA », s'applique au coup suivant).
- **Classement Elo** (onglet dédié) : chaque partie locale ou en ligne terminée entre deux joueurs nommés
  différemment (pas juste « Blancs »/« Noirs ») met à jour leur note (1200 au départ, K décroissant avec
  l'expérience). Case à cocher pour désactiver au cas par cas. **Classement propre à l'appareil** (stocké dans le
  navigateur, comme l'historique des parties) : en ligne, chaque participant calcule sa propre copie à partir du
  même résultat, ce n'est pas un classement central partagé. Touche un joueur pour voir sa **courbe** de progression
  (survol/glisser pour le détail de chaque partie). Le bouton **« Calculer une partie »** permet d'enregistrer un
  résultat obtenu ailleurs (échiquier physique, autre appli) : deux noms, qui a gagné (ou nulle), et les nouvelles
  notes s'affichent — c'est un raccourci vers le même calcul, sans passer par une partie jouée dans l'app.
  Quand un nom est nouveau, un champ facultatif **« Elo de départ »** apparaît (partie locale, en ligne, calcul
  manuel) pour partir d'une note connue plutôt que de 1200 ; il est ignoré si ce joueur existe déjà.
- **Enregistrement et revue** : proposition d'enregistrer en fin de partie ; bouton « Enreg. » pour enregistrer
  le plateau actuel + les coups suivants jusqu'à l'arrêt. Revue pas à pas / lecture auto, export PGN (ligne
  principale). Les parties sont stockées dans le navigateur (`localStorage`).
- **Branches dans les parties enregistrées** : depuis la revue, « + Nouvelle branche depuis ce coup » pour jouer
  une variante à partir d'une position de la ligne principale (coups manuels sur l'échiquier) ; « Continuer cette
  branche » pour reprendre l'édition d'une branche existante. Case **« Laisser l'IA jouer »** : l'IA enchaîne les
  coups des deux camps automatiquement, chacun à **sa propre note Elo suivie** (celle du nom sous ce camp dans le
  classement, sinon 1200) — jusqu'à décocher, la fin de partie, ou « Terminer ». Restriction volontaire : pas de
  branche depuis une autre branche (pas de sous-arbre).
- **Score matériel** affiché dans le bandeau du joueur en avance (ex. « +3 »), recalculé à chaque coup.
- **Problèmes** (onglet dédié) : liste **publique, partagée entre tous les visiteurs** (contrairement au reste de
  l'appli, qui est propre à chaque appareil). Résolution sur l'échiquier, indice, « Voir la solution », suivi
  « résolu » local (coche ✓). Bouton **« Proposer un problème »** : un **éditeur visuel** en deux étapes — 1) place
  les pièces sur l'échiquier (palette, position de départ ou échiquier vide, trait à qui), 2) joue directement sur
  l'échiquier le ou les coups de la solution (un seul pour un mat en 1, plusieurs en alternant avec les réponses de
  l'adversaire pour une combinaison plus longue) — puis ouvre un ticket GitHub pré-rempli ; un compte GitHub gratuit
  suffit, pas de compte sur le site (un lien permet aussi de saisir directement une FEN/solution en texte). Une
  Action GitHub revérifie la proposition avec le même moteur d'échecs que le site, puis l'ajoute automatiquement à
  la liste publique et ferme le ticket (ou commente l'erreur précise sinon). Voir « Comment marche l'ajout de
  problèmes » ci-dessous. Bouton **« Suppr. »** sur chaque problème : ouvre de la même façon un ticket de
  suppression pré-rempli, mais il faut le bon mot de passe pour qu'il aboutisse (voir « Comment marche la
  suppression de problèmes »).
- **Plein écran** pour les parties en cours et la pendule (API Fullscreen ; sur iPhone : « Sur l'écran d'accueil »).
- **Transitions** : fondu à la navigation entre écrans, fondu + léger zoom pour les boîtes de dialogue, fondu +
  glissé pour les notifications. Implémentation robuste aux clics rapprochés (jamais deux écrans visibles à la
  fois, jamais un écran bloqué à mi-fondu — voir `App.show` dans `app.js`).

## Lancer / tester

```bash
npm start            # serveur de fichiers local : http://localhost:3000
npm test             # moteur (perft) + logique de salle (sièges, pendule, bascule d'hôte)
```

## Héberger

L'app est **100 % statique** : copier le dossier `public/` sur n'importe quel hébergement de fichiers (nginx, Web Station…),
**aucun serveur Node** n'est nécessaire. Servir en **HTTPS** (verrou d'écran, presse-papiers, WebRTC sur certains navigateurs).

Aussi hébergée automatiquement par **GitHub Pages** via `.github/workflows/deploy.yml` (publie `public/` à chaque
push sur `main`) : **https://turos14.github.io/chess/**. Une deuxième copie, indépendante du NAS.

## Mises à jour et cache

Le serveur ne renvoie **aucun en-tête `Cache-Control`** pour les fichiers statiques (vérifié en production) : les
navigateurs appliquent alors leur propre heuristique, et une appli **ajoutée à l'écran d'accueil iOS** en particulier
peut rester bloquée longtemps sur une version JS/CSS ancienne sans jamais revérifier le serveur — au point qu'une
fonctionnalité entière (comme le classement Elo) peut sembler ne pas marcher alors que le code est à jour côté serveur.

- **Palliatif déjà en place dans le code** : chaque référence à un fichier de `public/` porte `?v=N`
  (voir le commentaire en tête de `public/index.html`). Après un déploiement qui touche `public/js` ou `public/css`,
  incrémenter ce `N` (dans `index.html` et dans `public/js/net.js` pour `peerjs.min.js`) force les navigateurs à
  aller chercher une version « différente », sans dépendre des en-têtes du serveur. Ça ne couvre que les fichiers
  *chargés depuis* `index.html` — si `index.html` lui-même reste en cache (typiquement l'icône iOS), rien ne le
  détecte automatiquement.
- **Vrai correctif, côté serveur (recommandé)** : faire renvoyer par nginx `Cache-Control: no-cache` sur ce dossier,
  pour forcer une revalidation (rapide, via `ETag`) à chaque visite :
  ```nginx
  location /apps/chess/ {
      add_header Cache-Control "no-cache";
  }
  ```
- **Si un appareil reste bloqué sur une ancienne version** : sur iPhone/iPad, supprimer puis réajouter l'icône
  à l'écran d'accueil (ou forcer-quitter l'appli depuis le multitâche avant de la rouvrir) ; dans un navigateur,
  un rechargement forcé (vider le cache du site) suffit.
- Par ailleurs, si le Classement Elo reste ouvert dans un onglet pendant qu'une partie se termine dans un **autre**
  onglet du même navigateur, l'écran se met maintenant à jour tout seul (écoute de l'évènement `storage`).

## Comment marche l'IA

- Moteur : **Stockfish.js 10** (vendor/, GPL-3.0, voir `stockfish-README.txt`), ~430 Ko, chargé en **Web Worker**
  (protocole UCI par `postMessage`). Choisi pour sa légèreté : les versions récentes de Stockfish nécessitent un
  réseau de neurones (NNUE) de plusieurs dizaines de Mo, disproportionné pour une appli statique. Temps de
  réflexion fixe : 2 s par coup par défaut, réglable en cours de partie (menu « Niveau de l’IA »).
- Cette version n'a **pas** les options `UCI_LimitStrength`/`UCI_Elo` des Stockfish récents. La difficulté est donc
  calibrée nous-mêmes (`public/js/engineStrength.js`, testable sous Node) à partir du réglage « Skill Level »
  (0-20) + le temps de réflexion, et étendue en dessous de ~1300 en piochant au hasard parmi plusieurs des
  meilleurs coups (Skill Level seul ne descend pas assez bas pour un vrai débutant). Approximatif par nature, et
  calé sur l'Elo **local** de l'app (voir ci-dessus), pas sur un classement FIDE.
- `public/js/engine.js` encapsule le Worker ; `public/js/ai.js` est le mode de jeu (comme `local.js`/`online.js`).

## Comment marche le mode en ligne

- Transport : **WebRTC** (canaux de données directs entre appareils) via **PeerJS** (`public/vendor/peerjs.min.js`).
  Le serveur public gratuit de PeerJS (`0.peerjs.com`) sert uniquement à mettre les appareils en relation ;
  STUN / TURN publics pour traverser les box et pare-feux. Les coups ne passent pas par lui.
- Le créateur **héberge** : son appareil arbitre la partie (règles, pendule) et diffuse l'état à tous.
  L'identifiant de la salle est `echecs-v1-<CODE>`.
- **Bascule d'hôte** : si l'hôte disparaît (fermeture, coupure, veille), chaque appareil retente d'enregistrer cet
  identifiant avec un délai aléatoire croissant ; le premier devient hôte et repart du dernier état reçu, les autres se
  reconnectent à lui. Les sièges sont liés à un identifiant client mémorisé sur l'appareil (pas à la connexion).
- Limites : la partie n'existe que tant qu'au moins un participant est connecté ; les appareils doivent gérer WebRTC
  (iOS 11+, Android 5+). Sans accès au serveur PeerJS, le mode en ligne échoue, le reste de l'app fonctionne.
- Serveur PeerJS personnel (facultatif) : définir `window.PEER_CONFIG = { host: '…', port: 443, path: '/', secure: true }`
  avant les scripts (ex. `<script>` dans `index.html`), ou tester avec `?peer=hote:9000` dans l'URL.

## Comment marche l'ajout de problèmes

L'appli reste 100 % statique côté client ; pas de backend à nous pour autant. Le flux :

1. Dans l'appli, **« Proposer un problème »** ouvre un éditeur en deux étapes : placement des pièces
   (`public/js/puzzles.js`, échiquier interactif + palette de pièces), puis les coups de la solution joués
   directement dessus (autant que voulu). Le texte libre (FEN + coups UCI) reste possible en secours. Validation
   locale (même moteur `chess.js`) avant d'ouvrir un **ticket GitHub pré-rempli**
   (`.github/ISSUE_TEMPLATE/puzzle.yml`) dans un nouvel onglet — il faut un compte GitHub gratuit pour le soumettre,
   pas de compte sur le site.
2. À l'ouverture (ou modification) d'un ticket étiqueté `puzzle`, l'Action `.github/workflows/puzzle-intake.yml`
   lance `scripts/puzzle-intake.js` (Node) : relit le corps du ticket, **revalide** la FEN et chaque coup de la
   solution avec `public/js/chess.js` (ne fait jamais confiance au client).
3. Si c'est valide : ajoute/maj le problème dans `public/data/puzzles.json` (id préfixé `gh-<numéro de ticket>`,
   pour ne jamais entrer en collision avec les problèmes de départ, en `seed-N`), commit + push sur `main`, commente
   et ferme le ticket. Un push fait avec le jeton par défaut de l'Action ne redéclenche pas les autres workflows sur
   push (anti-boucle, limitation volontaire de GitHub) : le déploiement Pages est donc **déclenché explicitement**
   (`gh workflow run deploy.yml`) après ce push. Si la FEN/solution est invalide : commente l'erreur précise et
   laisse le ticket ouvert — le corriger relance la vérification.
4. Visible par tout le monde dans l'onglet **Problèmes** à la republication (~1 min), la liste étant rechargée à
   chaque ouverture de l'écran (anti-cache par horodatage, pas seulement `?v=N` : la liste change sans déploiement).

Limites assumées : pas de modération a priori (seulement une vérification de légalité des coups) — un problème légal
mais malvenu (mauvais goût, titre offensant…) reste possible ; voir « Comment marche la suppression de problèmes »
ci-dessous pour le retirer. Le suivi « résolu » (✓) est **local à l'appareil** (`localStorage`), comme le reste de
l'appli — ce n'est que la liste des problèmes elle-même qui est partagée.

## Comment marche la suppression de problèmes

Même principe que l'ajout, mais un **mot de passe** fait foi plutôt qu'une FEN/solution (rien dans le contenu
d'une demande de suppression ne peut être validé automatiquement) : stocké comme secret du dépôt
(`PUZZLE_DELETE_PASSWORD`), jamais dans le code.

1. Chaque problème de la liste publique a un bouton **« Suppr. »** qui ouvre un ticket GitHub pré-rempli
   (`.github/ISSUE_TEMPLATE/delete-puzzle.yml`, étiquette `delete-puzzle`) avec son identifiant — visible et
   cliquable par tout le monde, mais sans effet sans le bon mot de passe (voir ci-dessous). On peut aussi y
   indiquer plusieurs identifiants à la fois (séparés par des espaces).
2. À l'ouverture (ou modification) d'un ticket étiqueté `delete-puzzle`, l'Action
   `.github/workflows/puzzle-delete.yml` lance `scripts/puzzle-delete.js` : il compare le champ « Mot de passe »
   au secret `PUZZLE_DELETE_PASSWORD`, **puis efface ce champ du ticket dans tous les cas** (succès ou échec) —
   un ticket GitHub est public, ce mot de passe ne doit donc pas être réutilisé ailleurs et n'est plus vraiment
   secret une fois utilisé une première fois (l'effacement limite l'exposition sans l'annuler complètement :
   l'historique de modification d'un ticket public reste accessible). Si le mot de passe est incorrect : commente
   l'erreur et laisse le ticket ouvert — le corriger (avec le bon mot de passe) relance la vérification.
3. Si correct : retire le(s) identifiant(s) demandé(s) de `public/data/puzzles.json`, commit + push sur `main`
   (et déclenche le déploiement Pages, comme pour l'ajout), commente le résultat (supprimés / introuvables) et
   ferme le ticket.

## Pièces

Les pièces sont des SVG dans `public/pieces/` (jeu « Cburnett », licence dans `LICENSE.txt`), branchés par **`public/css/pieces.css`**.
Chaque case contient `<div class="pc pc-XY">` (X = `w`/`b`, Y = `K Q R B N P`), qui remplit la case ;
remplacer les SVG (mêmes noms) ou ce fichier suffit à changer le jeu.

## Structure

```
server.js            serveur de fichiers de développement (npm start)
public/index.html    écrans
public/js/chess.js   moteur de règles + calcul du matériel, testable sous Node
public/js/records.js enregistrement, revue, branches (variantes, avec poursuite par l'IA)
public/js/room.js    salle de jeu côté hôte (sièges, pendule, nulle, abandon), testable sous Node
public/js/elo.js     calcul de classement Elo (module pur, testable sous Node)
public/js/engineStrength.js  calibration Elo -> réglages du moteur (module pur, testable sous Node)
public/js/engine.js  enveloppe Web Worker autour du moteur Stockfish
public/js/ai.js      mode de jeu « contre l'IA »
public/js/eloChart.js courbe Elo (SVG, sans dépendance)
public/js/eloview.js écran « Classement » et stockage du classement (navigateur)
public/js/net.js     réseau pair-à-pair, bascule d'hôte
public/js/puzzles.js écran « Problèmes » (liste publique, résolution, proposition via ticket GitHub)
public/data/puzzles.json  liste publique des problèmes (modifiée uniquement par l'Action GitHub)
public/js/           util, clock, board, gameview, pendule, local, online, app
public/vendor/       PeerJS (MIT) et Stockfish.js 10 (GPL-3.0)
public/css/          style.css, pieces.css
test/                tests du moteur, de la salle et des problèmes de départ
scripts/puzzle-intake.js  validation + intégration d'un problème proposé (lancé par l'Action GitHub)
scripts/puzzle-delete.js  suppression d'un problème, protégée par mot de passe (lancé par l'Action GitHub)
.github/workflows/   déploiement GitHub Pages, intégration et suppression des problèmes
.github/ISSUE_TEMPLATE/puzzle.yml  formulaire du ticket « Proposer un problème »
.github/ISSUE_TEMPLATE/delete-puzzle.yml  formulaire du ticket « Supprimer un problème »
```
