# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Appli web d'échecs (pendule, parties locales / en ligne / contre l'IA, Elo, enregistrement, problèmes).
Interface, commentaires et messages de commit **en français**. Le `README.md` détaille chaque fonctionnalité.

## Commandes

```bash
npm start                     # serveur de fichiers statiques de dev : http://localhost:3000 (PORT=… pour changer)
npm test                      # tous les tests (enchaîne les fichiers test/*.test.js)
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
  production : ne jamais pousser sur `main` sans demande explicite.
- **Cache-busting manuel** : toute modification de `public/js` ou `public/css` doit incrémenter le `?v=N`
  partout dans `public/index.html` **et** dans `public/js/net.js` (chargement de `peerjs.min.js`).
- Toutes les données utilisateur (parties, classement Elo, problèmes résolus) sont en `localStorage`, propres
  à l'appareil. Seule exception partagée : `public/data/puzzles.json`.

## Architecture

- **Modules purs vs modules navigateur.** `chess.js`, `room.js`, `elo.js`, `engineStrength.js` utilisent un
  wrapper UMD `(function (root, factory) {…})` : sans DOM, chargeables sous Node (`require`) et testés dans
  `test/`. Tous les autres fichiers de `public/js/` sont des IIFE qui posent un global sur `window`
  (`U`, `Board`, `GameView`, `Local`, `Online`, `AI`, `Rec`, `EloView`, `Puzzles`, `App`…) et dépendent de
  l'**ordre des `<script>` dans `index.html`** — en ajoutant un fichier, l'insérer après ses dépendances.
  Garder la logique testable dans les modules purs.
- **Moteur de règles** : `chess.js` (cases 0..63, 0 = a8 ; pièces `'wK'`, `'bP'`…). Utilisé partout,
  y compris par les scripts d'Action GitHub.
- **Écran de partie partagé** : `gameview.js` est piloté par un objet contrôleur (`ctrl`, interface documentée
  en tête du fichier) que fournissent `local.js`, `online.js` et `ai.js` (l'éditeur de branches de `records.js`
  a son propre rendu).
  Un nouveau mode de jeu = un nouveau contrôleur, pas une nouvelle vue.
- **En ligne** : pair-à-pair WebRTC via PeerJS (`net.js`, salle `echecs-v1-<CODE>`). L'appareil hôte fait
  tourner `room.js` (arbitre : règles, pendule, sièges liés à un identifiant client persistant) et diffuse
  l'état ; en cas de départ de l'hôte, un autre participant reprend l'identifiant (bascule d'hôte).
- **IA** : Stockfish.js 10 vendu dans `public/vendor/` (choisi exprès : pas de fichier NNUE), lancé en Web Worker
  par `engine.js`. Cette version n'a pas `UCI_Elo` : la force est calibrée par `engineStrength.js`
  (Skill Level + temps + coup aléatoire parmi les meilleurs sous ~1300). Les parties contre l'IA ne modifient
  jamais le classement Elo.
- **Elo** : calcul pur dans `elo.js`, stockage/écrans dans `eloview.js` ; appelé par `gameview.js` en fin de partie.
- **Navigation** : `app.js` (`App.show`) gère les écrans et transitions ; robuste aux clics rapides, ne pas
  contourner.
- **Problèmes (puzzles)** : la liste publique `public/data/puzzles.json` n'est modifiée que par les Actions
  GitHub. Proposition/suppression via tickets pré-remplis (`.github/ISSUE_TEMPLATE/`), traités par
  `scripts/puzzle-intake.js` / `scripts/puzzle-delete.js` (revalidation avec `chess.js`, commit sur `main`,
  puis déclenchement explicite de `deploy.yml` car un push fait par `GITHUB_TOKEN` ne relance pas les
  workflows). La suppression exige l'étiquette `delete-approved` posée à la main par Turos14. Les ids sont
  `gh-<n° de ticket>` (et `seed-N` pour les problèmes de départ). `test/puzzles.test.js` valide ce fichier :
  si l'Action change le format d'un champ, le test doit suivre.
- **Pièces** : SVG Cburnett dans `public/pieces/`, branchés par `public/css/pieces.css`
  (`<div class="pc pc-wK">`).
