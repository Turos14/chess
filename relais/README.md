# Relais des problèmes

Petit service séparé de l'appli (qui reste 100 % statique sur GitHub Pages) : il reçoit les problèmes proposés,
modifiés ou supprimés **depuis l'appli, sans compte GitHub**, et crée le ticket GitHub correspondant avec une clé
gardée secrète. Les tickets ont exactement le format des formulaires `.github/ISSUE_TEMPLATE/`, donc les Actions
existantes (`scripts/puzzle-*.js`) les traitent sans changement.

- `api/submit.js` : point d'entrée `POST /api/submit` (fonction Vercel, Node 18+).
- `lib/ticket.js` : vérification de la demande et construction du ticket (testé par `test/relais.test.js`).
- Toute publication passe par une **validation manuelle** de Turos14 :
  - proposition → étiquette `puzzle-pending` ; ajouter **`puzzle-approved`** pour la publier ;
  - modification → `edit-puzzle` ; ajouter **`edit-approved`** ;
  - suppression → `delete-puzzle` ; ajouter **`delete-approved`**.
- Garde-fous : seules les requêtes venant du site sont acceptées (CORS), limite de 5 envois / 10 min par adresse,
  champs bornés en taille. La FEN et la solution sont revérifiées par l'Action avant publication.

## Mise en ligne (une seule fois)

1. **Clé GitHub** — github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token :
   - Repository access : *Only select repositories* → `Turos14/chess`
   - Permissions → Repository permissions → **Issues : Read and write** (rien d'autre)
   - Expiration : au choix (à renouveler à l'échéance, voir plus bas). Copier le jeton.
2. **Vercel** — vercel.com → *Sign up / Log in with GitHub* → *Add New… → Project* → importer `Turos14/chess` :
   - **Root Directory : `relais`**
   - Framework Preset : *Other* (aucune commande de build)
   - Environment Variables : **`GITHUB_TOKEN`** = le jeton de l'étape 1
   - Deploy. L'adresse du relais est affichée (ex. `https://echecs-relais.vercel.app`).
3. **Brancher l'appli** — mettre l'adresse `https://<projet>.vercel.app/api/submit` dans `RELAY_URL`
   (en tête de `public/js/puzzles.js`). Tant que `RELAY_URL` est vide, l'appli ouvre des tickets GitHub comme avant.

Ensuite, chaque push sur `main` met le relais à jour automatiquement (Vercel suit le dépôt).

Variables facultatives : `GITHUB_REPO` (défaut `Turos14/chess`), `ALLOWED_ORIGINS` (défaut
`https://turos14.github.io`, plusieurs séparées par des virgules — ajouter `http://localhost:3000` pour tester
en local).

**Renouveler la clé** : quand le jeton expire, l'envoi depuis l'appli affiche « GitHub a refusé la demande
(HTTP 401) » et propose de passer par GitHub. Créer un nouveau jeton (étape 1), le coller dans Vercel → Settings →
Environment Variables → `GITHUB_TOKEN`, puis *Redeploy*.
