# Relais des problèmes

Petit service séparé de l'appli (qui reste 100 % statique sur GitHub Pages) : il reçoit les problèmes proposés,
modifiés ou supprimés **depuis l'appli, sans compte GitHub**, et crée le ticket GitHub correspondant avec une clé
gardée secrète. Les tickets ont exactement le format des formulaires `.github/ISSUE_TEMPLATE/`, donc les Actions
existantes (`scripts/puzzle-*.js`) les traitent sans changement.

- `api/submit.js` : point d'entrée `POST /api/submit` (fonction Vercel, Node 18+).
- `lib/ticket.js` : vérification de la demande et construction du ticket (testé par `test/relais.test.js`).
- Toute publication passe par une **validation manuelle dans l'admin** (seul chemin de validation ; la file contient
  aussi les tickets ouverts directement sur GitHub, y compris d'anciens tickets `puzzle` sans `puzzle-pending`) ; l'admin
  poste un commentaire d'approbation (marqueur caché), ce qui déclenche le bot (Actions GitHub) :
  - proposition → étiquette `puzzle-pending` (ou ancienne `puzzle`) ; **`puzzle-approved`** pour la publier ;
  - modification → `edit-puzzle` ; ajouter **`edit-approved`** ;
  - suppression → `delete-puzzle` ; ajouter **`delete-approved`**.
- Garde-fous : seules les requêtes venant du site sont acceptées (CORS ; un POST sans en-tête `Origin` est refusé en
  403), limite de 5 envois / 10 min par adresse **et** plafond global de 20 tickets / 24 h (voir « Limites
  partagées »), diagnostic `?check=1` limité à 3 / 10 min par adresse, champs bornés en taille. La FEN et la
  solution sont revérifiées par l'Action avant publication.
- Mentions et références croisées : dans les textes libres (titre, pseudo, catégorie, description, raison), `@nom`,
  `#12`, `GH-12`, `owner/repo#12` et les URL `github.com` sont neutralisés par un espace de largeur nulle (U+200B),
  invisible, pour qu'un ticket créé avec le jeton de Turos14 ne notifie ni ne référence personne.
  `scripts/puzzle-common.js` retire ces caractères à la lecture : `puzzles.json` reste propre.

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
   Adresse actuelle : **https://chess-relais.vercel.app** (projet Vercel `chess-relais`).

Ensuite, chaque push sur `main` met le relais à jour automatiquement (Vercel suit le dépôt).

Variables facultatives : `GITHUB_REPO` (défaut `Turos14/chess`), `ALLOWED_ORIGINS` (défaut
`https://turos14.github.io`, plusieurs séparées par des virgules — ajouter `http://localhost:3000` pour tester
en local).

## Limites partagées (Upstash Redis, recommandé)

Sans stockage partagé, les limites sont comptées en mémoire de chaque instance Vercel (remises à zéro à chaque
démarrage à froid) : le relais fonctionne, mais la protection est approximative. Pour des compteurs partagés :

1. Vercel → le projet du relais → **Storage** (ou *Marketplace*) → **Upstash** → *Redis* → créer une base
   (offre gratuite, région proche de celle des fonctions) et la **connecter au projet**.
2. Vercel y ajoute seule les variables **`KV_REST_API_URL`** et **`KV_REST_API_TOKEN`** (les noms
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` sont aussi compris). Puis *Redeploy*.
3. Vérification : si Redis est injoignable ou mal configuré, le journal de la fonction affiche
   « Limite : Redis indisponible, repli sur la mémoire » et le relais continue avec la limite en mémoire.

Variable facultative : **`MAX_PER_DAY`** (défaut `20`) = plafond global de tickets créés par 24 h, toutes adresses
confondues (dépassé : réponse 429 « réessaie demain »). Compteurs : par adresse (première valeur de
`x-forwarded-for`, posée par Vercel) 5 envois / 10 min, diagnostic 3 / 10 min.

**Renouveler la clé** : quand le jeton expire, l'envoi depuis l'appli affiche « GitHub a refusé la demande
(HTTP 401) » et propose de passer par GitHub. Créer un nouveau jeton (étape 1), le coller dans Vercel → Settings →
Environment Variables → `GITHUB_TOKEN`, puis *Redeploy*.

## Statistiques anonymes (`api/stats.js`)

L'appli envoie des compteurs d'usage à `POST /api/stats` (JSON en `text/plain`, origine obligatoire et dans
`ALLOWED_ORIGINS`, réponse `204`). Elles sont activées par défaut et le joueur peut les couper.

- **Stocké** : seulement des compteurs agrégés **par jour UTC**, dans Redis (hash `stats:d:AAAA-MM-JJ`, champs du
  type `e=game_start|m=local`, et `req` = nombre de requêtes ; ensemble `stats:days`). Événements : ouverture de
  l'appli (avec navigateur, système, version, appli installée ou non), parties lancées / terminées (mode, variante,
  issue), problèmes ouverts / résolus, connexions en ligne réussies ou en erreur, nombre de messages de chat.
- **Jamais stocké** : nom ou pseudo, texte des messages de chat, coups, contenu de partie, identifiant d'appareil,
  adresse IP. L'IP ne sert qu'aux limites d'envoi (clés Redis éphémères). Tout événement ou valeur hors liste est
  ignoré (`lib/stats.js`).
- **Conservation illimitée** : aucune expiration sur les compteurs.
- **Limites** : 30 requêtes / 10 min par adresse, et plafond global **`STATS_MAX_PER_DAY`** (défaut `50000`
  requêtes par jour) ; dépassé : `429`, rien compté. Sans Redis configuré : `204`, rien n'est enregistré.

## Parties en direct (`api/live.js`)

Les joueurs qui ont **accepté** (choix demandé au premier lancement, modifiable dans « Règles ») envoient leurs parties
à `POST /api/live` (JSON en `text/plain`, origine obligatoire et dans `ALLOWED_ORIGINS`, réponse `204`) ; l'admin les
voit en direct dans l'onglet « En direct » (`GET /api/admin?a=live`).

- **Reçu et stocké** (`lib/live.js`) : identifiant aléatoire de partie (`gid`), mode (`local`, `ai`, `online`,
  `multi_local`, `multi_online`), variante, position de départ 960, équipes, liste des coups (UCI, ou « de-vers » en
  parties à plusieurs, 700 maximum), pendule, fin de partie (raison et gagnant) et instants de début / dernière mise à jour.
- **Jamais reçu ni stocké** : nom, pseudo, message de chat, code de salle, identifiant d'appareil, adresse IP (l'IP ne sert
  qu'aux limites d'envoi, clés Redis éphémères). Tout champ inconnu est ignoré ; un corps invalide donne `400`.
- **Durées** : clé Redis `live:<gid>` avec expiration de **15 min** sans mise à jour (partie en cours) ou **1 h** (partie
  terminée) ; `live:st:<gid>` (début, 24 h) ; index `live:idx` nettoyé à chaque lecture. Un envoi `{ v:1, gid, stop:true }`
  (partage retiré) supprime tout de suite la partie. Rien n'est gardé au-delà.
- **Limites** : 120 requêtes / 10 min par adresse, et plafond global **`LIVE_MAX_PER_DAY`** (défaut `50000` requêtes par
  jour) ; dépassé : `429`. Sans Redis configuré : `204`, rien n'est enregistré.
- **Lecture admin** : les 200 parties les plus récentes (tri par dernière mise à jour décroissante) ; l'action `live_view`
  est écrite dans le journal au plus une fois par minute.

## Admin (`/admin/`, `api/admin.js`)

Page de modération à `https://<projet>.vercel.app/admin/` (fichiers statiques de `admin/`, en-têtes de sécurité et CSP
posés par `vercel.json`). Elle appelle `/api/admin?a=<action>` (même origine, pas de CORS).

**Installer l'admin comme une appli** : dans Chrome / Edge, bouton « Installer » de l'en-tête (ou menu → Applications →
Installer ce site en tant qu'application) ; sur iPhone / iPad, Partager → « Sur l'écran d'accueil ». Manifeste
`admin/manifest.webmanifest` et icônes `admin/icons/` (logo : cavalier sur disque en damier). Volontairement **sans
service worker** : la page affiche des données de modération, rien n'est gardé en cache hors ligne. Test : `test/adminpwa.test.js`.

Variables d'environnement :

- **`ADMIN_PASSWORD`** : **obligatoire pour activer l'admin** (sans elle, l'API répond 503). C'est le mot de passe du
  compte **`admin`**. Mot de passe long et unique, jamais réutilisé ailleurs. Changer le mot de passe déconnecte toutes
  les sessions (tous comptes, si `ADMIN_SESSION_SECRET` n'est pas défini).
- `ADMIN_SESSION_SECRET` (facultatif) : clé de signature des sessions ; sinon dérivée du mot de passe.
- `STATS_MAX_PER_DAY` et `LIVE_MAX_PER_DAY` (voir plus haut), `GITHUB_TOKEN` et `GITHUB_REPO` comme pour `/api/submit`.

**Comptes** (`lib/accounts.js`) : le compte `admin` (mot de passe `ADMIN_PASSWORD`) a tous les droits et est **le seul
à pouvoir créer, modifier et supprimer les autres comptes** (onglet « Comptes »). Chaque autre compte a un identifiant
(2 à 32 caractères `a-z 0-9 _ . -`), un mot de passe (10 caractères minimum, haché scrypt + sel, jamais renvoyé) et des
droits, un par onglet : `mod` (Modération : file, approuver, refuser), `live` (En direct), `stats` (Statistiques),
`log` (Journal). Stockage : hash Redis `admin:users` (**Redis obligatoire** pour les comptes ; sans lui, seul `admin`
existe). Les droits sont relus à chaque requête : une modification s'applique tout de suite ; un nouveau mot de passe ou
une suppression invalide les sessions ouvertes du compte. Connexion avec un identifiant vide = `admin`. Le journal
indique l'auteur de chaque action (`by`).

Session : cookie `admin_session` signé (HMAC-SHA256), `HttpOnly; Secure; SameSite=Strict`, valable 2 h. Connexion
limitée à 5 essais / 15 min par adresse. Tout `POST` exige l'en-tête `X-Admin: 1` et, si `Origin` est présent, qu'elle
soit celle du site (protection CSRF). Réponses JSON `{ ok: true, … }` ou `{ error }`.

| Méthode | `a=` | Rôle |
|---|---|---|
| POST | `login` | `{ user, password }` : ouvre la session et renvoie `{ user, root, perms }` (401 faux, 429 trop d'essais, 503 admin non configuré) |
| POST | `logout` | ferme la session |
| GET | `me` | vérifie la session : `{ user, root, perms }` |
| GET | `users` | *admin seul* : comptes `{ name, perms, createdAt, updatedAt }` |
| POST | `user_save` | *admin seul* : `{ create: true, name, password, perms }` crée (409 s'il existe) ; `{ name, perms, password? }` modifie |
| POST | `user_delete` | *admin seul* : `{ name }` supprime (`admin` ne se supprime pas) |
| GET | `queue` | tickets ouverts en attente (`puzzle-pending` ou ancienne `puzzle`, `edit-puzzle`, `delete-puzzle` sans l'étiquette d'approbation, ou sans étiquette mais titré `[Problème]` / `[Modification]` / `[Suppression]`), découpés en champs ; les PR sont exclues |
| POST | `approve` | `{ number }` : commente le ticket avec le marqueur caché `<!-- admin-approve:propose|edit|delete -->` ; les workflows des problèmes s'en déclenchent (événement `issue_comment`), seulement si le commentaire vient de Turos14 (`OWNER`). Pas d'étiquette : la clé fine-grained du relais ne peut pas en poser (GitHub les ignore). Les étiquettes `*-approved` posées à la main sur GitHub marchent toujours. |
| POST | `refuse` | `{ number, reason }` : commente « Refusé par la modération : … » puis ferme le ticket (non planifié) |
| GET | `stats` | `from`, `to` (AAAA-MM-JJ, 400 jours maximum, défaut 30 derniers jours) : compteurs par jour |
| GET | `live` | parties en direct : `{ now, games: [{ gid, m, var, sf?, teams?, mv, tc?, end?, startedAt, updatedAt }] }` (200 plus récentes ; en cours < 15 min, terminées < 1 h) |
| GET | `log` | 100 dernières actions du journal (avec l'auteur `by`) (`admin:log`, Redis, 500 conservées, **sans adresse IP**) |

**L'admin ne fait que poser des étiquettes** (ou refuser et fermer) : la publication d'un problème reste faite par les
Actions GitHub existantes, comme avec une étiquette posée à la main. Aucun accès au code ni aux fichiers du dépôt.
