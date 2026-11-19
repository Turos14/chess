# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Appli web d'échecs (pendule, parties locales / en ligne / contre l'IA, Elo, enregistrement, problèmes).
Interface, commentaires et messages de commit **en français**. Le `README.md` détaille chaque fonctionnalité.

## Commandes

```bash
npm start                     # serveur de fichiers statiques de dev : http://localhost:3000 (PORT=… pour changer)
npm test                      # tous les tests (liste explicite dans package.json : y ajouter tout nouveau fichier)
node test/chess.test.js       # un seul fichier de test
```

Pas de build, pas de dépendances npm, pas de linter. Les tests sont de simples scripts Node avec `assert`
(pas de framework) : un fichier échoue = exception non rattrapée.

## Contraintes fortes

- **ES5 uniquement** dans `public/js/` (anciens iOS / Android) : `var`, `function`, pas de `let/const`,
  flèches, classes, template strings, `Promise`/`fetch` non garantis. Aucun framework, aucune étape de build.
- L'appli est **100 % statique** : `server.js` ne sert qu'au dev local. Production = **GitHub Pages**
  (https://turos14.github.io/chess/), publiée automatiquement depuis `public/` par
  `.github/workflows/deploy.yml` à **chaque push sur `main`**. Un push sur `main` est donc une mise en
  production. L'utilisateur teste sur le site en ligne : une fois un changement terminé et `npm test` vert,
  fusionner `origin/main` dans la branche de travail puis pousser sur `main` sans attendre de confirmation.
- **Cache-busting manuel** : toute modification de `public/js` ou `public/css` doit incrémenter le `?v=N`
  partout dans `public/index.html` **et** dans `public/js/net.js` (chargement de `peerjs.min.js`).
- Toutes les données utilisateur (parties, classement Elo, problèmes résolus, aide-mémoire) sont en `localStorage`, propres
  à l'appareil. Seule exception partagée : `public/data/puzzles.json`.

## Architecture

- **Modules purs vs modules navigateur.** `chess.js`, `room.js`, `elo.js`, `engineStrength.js`, `memo.js`, `analysis.js`, `multichess.js`, `multiroom.js`, `chat.js`, `statsdata.js`, `livedata.js` utilisent un
  wrapper UMD `(function (root, factory) {…})` : sans DOM, chargeables sous Node (`require`) et testés dans
  `test/`. Tous les autres fichiers de `public/js/` sont des IIFE qui posent un global sur `window`
  (`U`, `Board`, `GameView`, `Local`, `Online`, `AI`, `Rec`, `EloView`, `Puzzles`, `App`…) et dépendent de
  l'**ordre des `<script>` dans `index.html`** — en ajoutant un fichier, l'insérer après ses dépendances.
  Garder la logique testable dans les modules purs.
- **Moteur de règles** : `chess.js` (cases 0..63, 0 = a8 ; pièces `'wK'`, `'bP'`…). Utilisé partout,
  y compris par les scripts d'Action GitHub. Fischer 960 : détecté uniquement par la notation des droits de roque
  dans la FEN (colonnes de tour, « Shredder-FEN » `HAha`) — une FEN `KQkq` garde les règles classiques à
  l'identique. En 960 un coup de roque a `to` = case de la tour (convention UCI) ; `Game.move` accepte aussi la case
  d'arrivée du roi. Les parties Fischer de l'appli (`Chess.start960`) sont volontairement **sans roque**
  (droits « - », placement différent par camp) ; elles se rejouent depuis leur `startFen` (jamais `Chess.START`).
- **Écran de partie partagé** : `gameview.js` est piloté par un objet contrôleur (`ctrl`, interface documentée
  en tête du fichier) que fournissent `local.js`, `online.js` et `ai.js` (l'éditeur de branches de `records.js`
  a son propre rendu).
  Un nouveau mode de jeu = un nouveau contrôleur, pas une nouvelle vue.
- **En ligne** : pair-à-pair WebRTC via PeerJS (`net.js`, salle `echecs-v1-<CODE>`). L'appareil hôte fait
  tourner `room.js` (arbitre : règles, pendule, sièges liés à un identifiant client persistant) et diffuse
  l'état ; en cas de départ de l'hôte, un autre participant reprend l'identifiant (bascule d'hôte).
  Le chat écrit (`chat.js`, utilisé par `room.js` et `multiroom.js` ; fenêtre `chatview.js`, branchée via `ctrl.chat`)
  voyage dans ce même état : ne jamais y exposer le `cid` d'un auteur (il donne droit au siège) ; masquage et
  « ignorer » se font donc par nom, côté appareil récepteur. `rules.js` porte tous les textes de règles de l'appli
  (écran `rules` + `Rules.dialog(id)` depuis les menus de partie) : y mettre à jour toute règle modifiée dans les moteurs.
- **IA** : Stockfish.js 10 vendu dans `public/vendor/` (choisi exprès : pas de fichier NNUE), lancé en Web Worker
  par `engine.js`. Cette version n'a pas `UCI_Elo` : la force est calibrée par `engineStrength.js`
  (Skill Level + coup aléatoire parmi les meilleurs sous ~1300) ; temps de réflexion tiré entre 1 et 2 s par coup. Les parties contre l'IA ne modifient
  jamais le classement Elo.
- **Analyse « Hulotte »** : `coach.js` (navigateur) fait évaluer chaque position de la ligne principale d'une partie
  enregistrée par `Engine` (`Handle.analyse`, pleine force) et stocke les évaluations brutes dans `rec.analysis`
  (`{v:1, evals[]}`, une par position) ; classement, précision et textes sont dérivés à l'affichage par `analysis.js`
  (pur, testé). `records.js` l'appelle via `Coach.open/show/decorate/stop`.
- **Échecs à plusieurs** : moteur séparé `multichess.js` (pur, testé ; ne passe pas par `chess.js`) où l'échiquier est
  un graphe de cases (`variant.step(case, direction)`, directions dans le repère local du camp pour Yalta, où une
  diagonale par le centre a deux suites). Écran propre `multi.js` piloté par un contrôleur (interface en tête du
  fichier, même principe que `gameview.js`), rendu SVG `multiboard.js`. Pièces de couleur r/u/y/g = pièces blanches
  recolorées (`public/pieces/`).
  En ligne : `multionline.js` réutilise `Net.Session` avec `prefix` (`echecs-multi-v1-`) et `makeRoom` → `MultiRoom`
  (`multiroom.js`, pur, testé). Dans `net.js` un siège peut valoir 0 : tester `!= null`, jamais la vérité.
- **Statistiques anonymes** : `stats.js` (global `Stats.track(e, props)`) met en file des événements filtrés par `statsdata.js` (liste
  autorisée, identique à celle du serveur) et les poste au relais (`window.STATS_URL`, rien en local) ; désactivable par
  `U.store` `stats-off`. Ne jamais y mettre de nom, message, coup ni identifiant.
- **Parties en direct (admin)** : `livedata.js` (pur, testé) construit le corps envoyé par `live.js` (global `Live`) à `window.LIVE_URL`
  (`/api/live` du relais), après chaque coup (regroupé, 2 s), à la fin (`end`) et à la sortie (`quit`). **Jamais de nom, de pseudo, de
  chat ni de code de salle dans ce corps** (test dédié). Envoi seulement si l'utilisateur a accepté (`live-share`, question posée une
  fois au premier lancement par `app.js`, case dans « Règles »). En ligne : chaque client envoie `share` dans son `hello`, les salles
  (`room.js`, `multiroom.js`) exposent `gid` (stable à la bascule d'hôte) et `live` (tous les sièges ont accepté), et seul l'hôte
  envoie (`ctrl.liveGid`). Écrans de partie : `GameView.refresh/close`, `Multi.refresh/close` appellent `Live.sync/closed`.
- **Elo** : calcul pur dans `elo.js`, stockage/écrans dans `eloview.js` ; appelé par `gameview.js` en fin de partie.
- **Navigation** : `app.js` (`App.show`) gère les écrans et transitions ; robuste aux clics rapides, ne pas
  contourner.
- **Problèmes (puzzles)** : la liste publique `public/data/puzzles.json` est modifiée par les Actions GitHub
  (et parfois à la main par l'utilisateur). Proposition / modification / suppression via tickets pré-remplis
  (`.github/ISSUE_TEMPLATE/`), traités par `scripts/puzzle-intake.js`, `puzzle-edit.js`, `puzzle-delete.js`
  (lecture des champs, revalidation avec `chess.js` et publication partagées dans `scripts/puzzle-common.js` ;
  commit sur `main` puis déclenchement explicite de `deploy.yml`, car un push fait par `GITHUB_TOKEN` ne relance
  pas les workflows). Modification et suppression exigent une étiquette posée à la main par Turos14
  (`edit-approved` / `delete-approved`). Les libellés des champs des templates (`### <Label>` dans le corps du
  ticket) et les paramètres d'URL de pré-remplissage (`id` des champs) doivent rester synchronisés avec
  `puzzle-common.js` et `openGithubIssue` dans `puzzles.js`. `category` est un texte ou une liste de textes.
- **Relais (`relais/`)** : 2e projet, fonction Vercel qui crée les tickets à la place des visiteurs sans compte
  GitHub (`lib/ticket.js` produit le même corps de ticket que les templates — `test/relais.test.js` vérifie qu'il
  est relu par `puzzle-common.js`). Ses propositions portent `puzzle-pending` et ne sont publiées qu'à l'ajout de
  `puzzle-approved`. Limites d'envois dans `lib/limit.js` (Upstash Redis via son API REST, repli en mémoire ;
  `fetch`, horloge et mémoire injectables pour `test/relaislimit.test.js`). Le relais porte aussi `api/stats.js`,
  `api/live.js` et `api/admin.js` (une seule fonction, `?a=<action>`, session par cookie HMAC, mot de passe
  `ADMIN_PASSWORD`) servant la page admin PWA `relais/admin/` ; Redis est partagé via `lib/redis.js`. Les listes
  autorisées côté client et serveur (`statsdata.js` ↔ `lib/stats.js`, `livedata.js` ↔ `lib/live.js`) doivent rester
  identiques : `test/statscross.test.js` et `test/livecross.test.js` le vérifient. Node 18+ (pas la contrainte ES5),
  toujours sans dépendance npm. Côté appli, `RELAY_URL` en tête de `puzzles.js` (surchargeable par
  `window.PUZZLE_RELAY` ; vide = tickets GitHub comme avant). Le relais n'est pas publié par `deploy.yml` mais
  Vercel suit `main` : un push sur `main` le met aussi en production ; c'est le seul code hors `public/` exécuté
  en production. Configuration Vercel (variables, Redis) : `relais/README.md`. Les ids sont
  `gh-<n° de ticket>` (et `seed-N` pour les problèmes de départ). `test/puzzles.test.js` valide ce fichier :
  si l'Action change le format d'un champ, le test doit suivre.
- **Pièces** : SVG Cburnett dans `public/pieces/`, branchés par `public/css/pieces.css`
  (`<div class="pc pc-wK">`).
