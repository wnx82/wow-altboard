# Sécurité et confidentialité

## Ce qui n'est jamais collecté

L'agent ne lit, par compte, que les fichiers de quatre addons sous `SavedVariables` :
`AltBoard.lua` et, s'ils existent, `AllemanoLedger.lua` (temps de jeu, sessions, finances par jour),
`Auctionator.lua` (prix) et `NaowhForever.lua` (recettes). Depuis 0.7.0, il lit aussi, par client,
`Cache\ADB\<langue>\DBCache.bin`, dont il ne garde que les noms d'objets, et la seule ligne
`textLocale` de `WTF\Config.wtf`. Tout en lecture seule.
Il ne lit ni identifiants Battle.net, ni mot de passe, ni jeton de session du jeu, et n'envoie
aucun chemin de fichier.

| Donnée | Traitement |
|---|---|
| Nom du dossier de compte (`WTF\Account\<COMPTE>`, « 123456789#1 ») | transmis depuis l'agent 0.6.0, avec son empreinte SHA-256 et un libellé masqué (`12…#1`) : le serveur vérifie que le nom correspond à l'empreinte, le garde dans `wow_accounts.folder_name` et l'affiche sur la page Comptes. Absent des journaux et fichiers locaux de l'agent, et des textes envoyés au serveur d'IA |
| Nom d'hôte du PC | transmis, informatif |
| Noms de personnage, guildes, or, équipement, temps de jeu, sessions | transmis : c'est l'objet du tableau de bord |

Le nom du dossier est l'identifiant Battle.net suivi du numéro de licence WoW. Ce n'est pas un
secret de connexion, mais il identifie le joueur : depuis le 2026-11-08, à la demande du
propriétaire, il est en base et visible de toute personne connectée au tableau de bord. Les agents
antérieurs à 0.6.0 n'envoient que l'empreinte et le libellé masqué ; la page Comptes affiche alors
« masquée ». L'empreinte reste la clé du compte : stable entre PC, elle ne dépend pas de la version
de l'agent.

## Agent → API

| Mesure | Détail |
|---|---|
| Transport | HTTPS obligatoire ; l'agent refuse HTTP hors `localhost` |
| Authentification | jeton `wab_` + 256 bits aléatoires, en-tête `Authorization: Bearer` |
| Stockage serveur | SHA-256 du jeton uniquement ; le jeton en clair n'est affiché qu'à sa création |
| Stockage agent | chiffré par DPAPI pour l'utilisateur Windows courant ; jamais dans `config.json` ni dans les journaux |
| Liaison | un jeton appartient à la première machine (`machine_uuid`) qui l'utilise ; refusé ailleurs (403) |
| Révocation | immédiate, depuis la page Machines |
| Limitation de débit | 60 requêtes / 5 min par client ; 10 échecs d'authentification / 15 min |
| Taille | corps limité à 8 Mio, que `Content-Length` soit présent, absent ou faux |
| Validation | schéma Zod strict : champs inconnus, types, bornes, longueurs, octet nul |
| Version | `schemaVersion` inconnu refusé |
| Réponses et journaux | jamais de valeur reçue, jamais de jeton, jamais de détail technique. Une erreur n'est journalisée (journal, `sync_errors`) que par son type et son code PostgreSQL ou réseau (`web/src/lib/errors.ts`) : le message d'une requête Drizzle porte le SQL et ses paramètres, celui de PostgreSQL peut citer une valeur reçue |
| Horloge | un horodatage de personnage plus d'une heure après l'heure du serveur fait refuser le document (`future_timestamp`) : sinon tous les envois suivants de ce personnage seraient ignorés comme plus anciens, jusqu'à cette date |

Les données d'un fichier `AltBoard.lua` sont traitées comme **non fiables** de bout en bout : le
fichier n'est jamais exécuté, le parser borne sa profondeur et sa taille, l'agent écarte les valeurs
hors limites, le serveur revalide tout.

## Tableau de bord

| Mesure | Détail |
|---|---|
| Accès | toutes les pages exigent une session ; seuls `/login`, `/api/sync` et `/api/health` répondent sans, ainsi que le manifeste du site installable (`/app.webmanifest`), ses icônes (`/icons/*`, `/apple-icon.png`) et son service worker (`/sw.js`, qui ne met rien en cache), fichiers fixes sans donnée. L'agent (`/api/agent`, `/api/agent/zip`) n'est servi qu'avec une session |
| Double vérification | `src/proxy.ts` (présence du cookie) puis chaque page, action et route (session lue en base) ; le layout ne protège pas ses pages, un test refuse une page sans contrôle |
| Mot de passe | scrypt (N=32768, r=8, p=1), sel aléatoire, comparaison à temps constant, 12 caractères minimum |
| Session | identifiant aléatoire de 256 bits ; seule son empreinte est en base ; 30 jours ; supprimée à la déconnexion |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Secure` et préfixe `__Host-` en HTTPS (aucun `Domain`) |
| Connexion | 5 tentatives / 15 min par client et par adresse ; message identique quel que soit le motif ; un hachage est calculé même pour un compte inexistant, pour que la durée de réponse ne le révèle pas |
| Redirection après connexion | chemin interne uniquement (pas de redirection ouverte) |
| Réinitialisation des personnages | suppression définitive (**Paramètres**) : le mot de passe est redemandé, une session seule ne suffit pas ; 5 tentatives / 15 min par compte ; journalisée sans donnée de personnage (`settings.characters.reset`) |
| Suppression d'un compte | suppression définitive (**Comptes**) : confirmation en deux temps et mot de passe redemandé ; 5 tentatives / 15 min, compteur distinct ; journalisée avec le seul identifiant interne et les nombres supprimés (`account.deleted`), sans référence de compte |
| CSRF | les actions serveur de Next.js vérifient l'origine ; cookie `SameSite=Lax` ; aucune mutation par `GET` |
| XSS | échappement de React ; aucune insertion de HTML brut ; CSP à nonce |
| Injection SQL | requêtes paramétrées (Drizzle) ; identifiants d'URL validés avant usage |
| Indexation | `X-Robots-Tag: noindex, nofollow`, `robots.txt` |

### En-têtes

`Content-Security-Policy` (à nonce, par requête) :

```text
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Les pages n'utilisent aucun style en ligne : couleurs de classe et de qualité passent par des
attributs `data-*`, les jauges par l'élément `<progress>`, les graphiques par des attributs SVG.

Icônes de classe et de métier : elles viennent du CDN de Blizzard (`render.worldofwarcraft.com`),
mais c'est **le serveur** qui les récupère, par l'optimiseur d'images de Next.js (`/_next/image`).
Le navigateur ne contacte que ce site : la CSP reste à `img-src 'self'` et Blizzard ne voit ni
l'adresse ni la navigation des visiteurs. L'optimiseur n'accepte qu'un hôte et un chemin
(`remotePatterns` : `/eu/icons/56/**`) : il ne peut pas servir de relais vers une autre adresse.
Les images ne sont pas copiées dans le dépôt ; le cache est en mémoire (`tmpfs`), perdu au redémarrage.

Aussi : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
`Strict-Transport-Security`, `Cache-Control: private, no-store, no-transform` sur les pages
(`no-transform` : Cloudflare ne réécrit pas le HTML, voir `src/proxy.ts`). Pas de CORS : l'API
n'est pas appelée depuis un navigateur tiers.

## Import des noms des objets

Le serveur télécharge la table des objets du jeu chez wago.tools une minute après son démarrage,
puis chaque jour quand une nouvelle version du jeu est publiée ; **Paramètres → Noms des objets**
force un import ([ECONOMY-ENGINE](ECONOMY-ENGINE.md#noms-des-objets-item-namests)).

| Mesure | Détail |
|---|---|
| Adresses | fixes, dans le code : `https://wago.tools/api/builds/wowf/latest`, puis le CSV de la version lue. La version doit avoir la forme `1.60.1.70862` ; aucune adresse ne vient d'une saisie. Redirections refusées |
| Taille et durée | lecture arrêtée au-delà de 40 Mo ; 60 s au plus pour la version, 5 min pour le fichier ; un seul import à la fois par processus |
| Contenu | trois colonnes lues (identifiant, nom, qualité) ; nom de 200 caractères au plus, caractères de contrôle retirés ; écrit en une transaction, tout ou rien. Affiché comme du texte par React, jamais comme du HTML |
| Accès et débit | import automatique sans entrée extérieure ; le bouton exige une session, 3 imports par quart d'heure et par utilisateur, et rend la main après 45 s |

## Sondes vers les serveurs de jeu

La page **Serveurs** fait ouvrir au serveur web des connexions TCP sortantes
([SERVER-STATUS](SERVER-STATUS.md)).

| Mesure | Détail |
|---|---|
| Cibles | celles de l'environnement du serveur (`WOW_STATUS_*_TARGETS`), choisies par l'exploitant, ou celles qu'un utilisateur connecté enregistre dans **Paramètres** ; validées, huit au plus par service |
| Cibles saisies sur le site | **publiques seulement**. Une adresse IP de boucle locale, privée, de lien local, partagée par l'opérateur ou réservée est refusée à la saisie, y compris écrite en IPv6. Un nom d'hôte est résolu par la sonde elle-même, qui refuse de se connecter si une seule des adresses obtenues n'est pas publique (`EBLOCKED`) : la règle porte sur l'adresse jointe, pas sur le texte saisi. Sans elle, la sonde dirait à qui tient une session quels ports sont ouverts sur le réseau interne du serveur |
| Aucune cible jointe à une demande | l'action du bouton **Actualiser** ne reçoit aucun paramètre ; aucune route n'accepte d'adresse à sonder sur-le-champ |
| Accès | pages et actions exigent une session, comme le reste du tableau de bord |
| Débit | un tour à la fois ; deux demandes manuelles à moins de 10 s ne valent qu'un contrôle ; afficher la page ne sonde rien |
| Contenu | aucun octet n'est envoyé aux serveurs sondés : la connexion est refermée dès qu'elle est acceptée |
| Journal et base | code d'erreur seulement (`ECONNREFUSED`), jamais le message, qui contient l'adresse |
| Navigateur | n'ouvre aucune connexion vers les serveurs de jeu : la CSP reste à `connect-src 'self'` |

## Base de données

- Base et rôle dédiés ; le rôle n'a accès à aucune base d'un autre projet (vérifié en production).
- Le code refuse toute connexion vers une base étrangère au projet (`web/src/db/env.ts`).
- Les tests ne tournent que sur `wow_altboard*_test`.

## Secrets

| Secret | Où |
|---|---|
| Chaînes de connexion | `deploy/.env` sur le serveur, `web/.env.local` en développement — jamais versionnés |
| Jeton d'agent | `token.dat` (DPAPI) sur le PC ; empreinte en base |
| Mot de passe du tableau de bord | hash scrypt en base |

Le dépôt ne contient que des identifiants de développement locaux (`dev-only-password`, base Docker
liée à `127.0.0.1`) et des fixtures anonymisées. Le source de l'addon, sous droits réservés, n'est
pas versionné.

## Conteneur

Utilisateur non privilégié, système de fichiers en lecture seule, toutes capacités retirées,
`no-new-privileges`. Le port n'est publié que sur l'adresse du réseau local de l'hôte : le tunnel
Cloudflare, dans un autre conteneur LXC, est le seul chemin depuis Internet. Connexions sortantes
hors base : le CDN d'icônes de Blizzard, wago.tools pour la table des noms des objets (chaque jour)
et, si des adresses sont configurées, les sondes vers les serveurs de jeu.

## Limites assumées

| Limite | Conséquence | Évolution |
|---|---|---|
| Limitation de débit en mémoire | remise à zéro au redémarrage ; non partagée entre instances | Redis partagé si l'application passe à plusieurs instances |
| Un seul niveau d'accès | tout compte du tableau de bord voit tout et gère les jetons | rôles, si d'autres personnes y accèdent |
| Pas de second facteur dans l'application | le tableau de bord est derrière Cloudflare Access (adresses autorisées) puis le mot de passe ; `/api/sync`, exclu d'Access, n'est protégé que par le jeton d'agent | TOTP si Access est retiré |
| Identité du client derrière le proxy | `cf-connecting-ip`, posé par Cloudflare ; le port de l'origine restant joignable du réseau local, un poste de ce réseau peut falsifier l'en-tête | fermer l'origine au réseau local (cloudflared dans la pile) |
| Un seul rôle de base | le rôle applicatif administre l'instance PostgreSQL de la pile, dédiée à l'application | séparer migration et application si le besoin apparaît |
