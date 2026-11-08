# Déploiement

Production : **`https://wow.ekreativ.be`**, pile Komodo `wow-altboard` sur Proxmox. Première mise en
ligne le 2026-10-04 sur l'hôte `contabo`, déplacée sur Proxmox le 2026-10-05. L'ancien hôte a été
désinstallé le même jour : voir [Ancien hôte : contabo](#ancien-hôte--contabo).

## Ce qui existe en production

| Élément | Valeur |
|---|---|
| Pile | `wow-altboard` dans **komodoprox** (`https://komodo.example.com`), serveur `komodoprox` : le conteneur LXC 102 « docker », `10.0.0.15` |
| Définition | `deploy/proxmox/compose.yaml` ; pile décrite par `deploy/proxmox/komodo.toml` |
| Sources | `/etc/komodo/stacks/wow-altboard/`, clonées par Komodo (branche `main`) |
| Conteneurs | `wow-altboard-web`, `wow-altboard-db` (PostgreSQL 17), `migrate` (s'arrête après les migrations) |
| Base | `wow_altboard` dans la pile, volume `wow-altboard_db-data`, jamais publiée hors de la pile |
| Configuration | environnement de la pile, écrit par Komodo dans `deploy/proxmox/.env` (droits `600`) |
| Secret | variable Komodo `WOW_ALTBOARD_DB_PASSWORD`, injectée dans `WOW_DB_PASSWORD` |
| Port | `10.0.0.15:3016`, joignable du réseau local seulement |
| Accès public | tunnel Cloudflare « proxmox » (cloudflared, LXC 101) ; DNS `wow.ekreativ.be` en CNAME proxifié vers le tunnel |
| Cloudflare Access | `/api/sync` ouvert par l'application « wow-sync-bypass » ; tout le reste derrière « HomeTunnelGuard » |

## Conventions suivies

- **Komodo fait tout** : il clone le dépôt, écrit le `.env`, puis lance `docker compose up -d`. Le
  fichier compose reconstruit l'image (`pull_policy: build`) et applique les migrations par un
  service dédié, dont dépend le démarrage de `web`. Aucune option de construction sur la pile.
- **Base dans la pile** : pas de PgBouncer, l'application se connecte directement. L'instance est
  initialisée avec la locale ICU `fr`, pour que les listes triées en SQL suivent l'ordre
  alphabétique (sur contabo, `C.UTF-8` triait par octets).
- **Cloudflare** termine TLS et compresse : la compression reste désactivée dans l'application.
  Les en-têtes de sécurité de l'application arrivent tels quels au navigateur.
- **Cloudflare Access** : le tableau de bord exige une adresse autorisée par « HomeTunnelGuard »,
  puis son propre mot de passe. `/api/sync` y échappe, l'agent ne sachant pas s'y authentifier :
  seul son jeton le protège.
- **Adresse du client** : l'en-tête de confiance est `cf-connecting-ip`, posé par Cloudflare. Le
  port restant joignable du réseau local, un poste de ce réseau pourrait le falsifier et contourner
  la limitation de débit ; pas un client d'Internet.
- **autoheal** redémarre tout conteneur en mauvaise santé sur cet hôte, sans étiquette : les
  services `migrate` et `tools` désactivent leur sonde.

## Mettre à jour

Pousser sur `main` suffit. L'action Komodo `wow-altboard-auto-deploy` interroge le dépôt toutes
les cinq minutes et lance **Deploy** quand le dernier commit de la branche n'est pas celui en place
et que sa CI est passée.
L'image est reconstruite à chaque déploiement, ce qui recrée `web` si elle a changé ; les migrations
s'appliquent avant son démarrage.

- Un déploiement en échec est retenté aux passages suivants, trois tentatives au plus par commit :
  une panne passagère (Docker Hub injoignable pendant la construction, le 2026-10-13) se rattrape
  seule. Après la troisième, pousser un correctif ou lancer **Deploy** à la main sur la pile. La
  variable `WOW_ALTBOARD_AUTO_DEPLOY_ATTEMPTED` garde `<commit>:<tentatives>`.
- Chaque tentative en échec envoie une notification ntfy : l'alerter Komodo `ntfy` relaie les
  alertes `ActionFailed` vers un topic de `ntfy.sh`, noté dans Vaultwarden (« ntfy — alertes Komodo
  komodoprox ») et pas dans le dépôt. S'y abonner dans l'application ntfy. **Test Alerter** sur
  l'alerter, dans Komodo, vérifie la chaîne.
- Seul un commit dont la CI est passée est déployé. L'action lit, sur l'API publique de GitHub,
  l'exécution de `.github/workflows/ci.yml` lancée par le push du commit sur `main`. CI en cours,
  absente, en échec, ou GitHub injoignable : le commit attend, sans tentative comptée, et le
  journal de l'action en donne la raison. Un échec se corrige par un nouveau commit ; **Deploy** à
  la main sur la pile passe outre. Le délai de mise en ligne devient donc celui de la CI (environ
  5 minutes) plus un passage de l'action.
- Pour suspendre le déploiement automatique, désactiver le planning de l'action. Sa définition est
  dans `deploy/proxmox/komodo.toml`.

Une migration doit rester compatible avec la version précédente de l'application le temps du
redémarrage (ajouts d'abord, suppressions dans une version ultérieure).

### Vérifier la version en service

Le pied de page du tableau de bord affiche ce qui tourne : version du site (`web/package.json`),
commit construit, date de construction, et version de l'agent (`agent/Directory.Build.props`). Un
commit poussé est en ligne quand le pied de page le montre. Sans session, depuis le réseau local,
`/api/health` donne la même version et le même commit :

```bash
curl -s http://10.0.0.15:3016/api/health     # {"status":"ok","version":"…","commit":"…"}
```

Ces valeurs sont figées à la construction (`web/next.config.ts`). L'image ne recevant que `web/`,
`compose.yaml` fournit le dépôt cloné comme contexte nommé `repo`, que le `.dockerignore` de la
racine réduit à `.git/HEAD`, aux références, à `agent/Directory.Build.props` et aux sources de
l'agent (`agent/src`). Sans ce contexte (`docker build web`), le commit et la version de l'agent ne
sont simplement pas affichés, et la page **Machines** n'offre pas l'agent au téléchargement.

### Agent offert au téléchargement

L'image publie l'agent depuis ces sources (étape `agent` de `web/Dockerfile`, image
`mcr.microsoft.com/dotnet/sdk:10.0`) et le range dans `/app/agent/AltBoardSync.exe` : la page
**Machines** le propose, en archive ZIP avec ses instructions ou en exécutable seul, avec sa taille
et son empreinte SHA-256, à la version de l'agent affichée en pied de page. L'archive est
construite par le site au premier téléchargement ou au premier affichage de la page (environ
0,3 s), puis gardée en mémoire. Publié sous Linux, il porte icône, manifeste et version comme celui de la release
GitHub (comparé le 2026-10-29), sans être identique à l'octet près : son empreinte est celle de la
page, pas celle de la release.

L'étape reste en cache tant que `agent/` ne change pas. Après une modification de l'agent, la
construction prend une à deux minutes de plus ; la première sur un hôte télécharge aussi l'image du
SDK (environ 1,3 Go).

## Revenir en arrière

Fixer le champ **Commit** de la pile sur le commit précédent, puis **Deploy**. Les migrations ne
sont pas annulées automatiquement : une migration destructive exige une sauvegarde préalable.

## Comptes et jetons

```bash
# Compte d'accès au tableau de bord : mot de passe saisi sur le serveur, sans écho
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox
docker compose run --rm -it tools node create-admin.mjs vous@exemple.test
```

Relancer la même commande change le mot de passe. Les jetons d'agent se créent et se révoquent
dans l'interface, page **Machines**.

Les commandes ponctuelles passent par le service `tools`, jamais par `web` : lancée depuis `web`,
une commande hériterait de la sonde de santé, serait jugée en mauvaise santé (aucun serveur
n'écoute) et redémarrée par autoheal au milieu de la saisie.

## Sauvegarde

Les données sont reconstructibles par une nouvelle synchronisation, **sauf l'historique**
(`character_snapshots`), qui n'existe nulle part ailleurs. Trois niveaux le couvrent :

| Niveau | Fréquence | Où | Conservation |
|---|---|---|---|
| `pg_dump` | chaque nuit, 03:45 | `/opt/wow-altboard/backups/` sur le conteneur LXC 102 | 14 jours |
| restic | à la suite du dump | dépôt `backup-gateway` de l'hôte, hors du conteneur ; injoignable, et abandonné le 2026-11-08 | celle du dépôt, non gérée ici |
| Conteneur entier | lundi et jeudi | Proxmox Backup Server (`pbs-hdd`) | deux dernières (constaté le 2026-10-05) |

Le dump et l'envoi restic sont faits par `deploy/proxmox/backup/wow-altboard-backup.sh`, que
`wow-altboard-backup.timer` lance sur le conteneur. Le script est lu dans les sources clonées par
Komodo : un déploiement le met à jour. Seules les deux unités s'installent, une fois :

```bash
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox/backup
cp wow-altboard-backup.service wow-altboard-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now wow-altboard-backup.timer
systemctl start wow-altboard-backup.service        # premier passage, sans attendre la nuit
journalctl -u wow-altboard-backup.service -n 20    # résultat du dernier passage
```

`backup-gateway` tourne sur un hôte qui n'est pas toujours allumé : s'il ne répond pas, le dump
local est fait quand même et l'envoi est reporté au passage suivant, qui emporte tout le dossier.
Un dump que `pg_restore --list` ne sait pas lire fait échouer le service et n'est pas conservé.
Dépôt et mot de passe restic restent dans `/root/backups/restic/backup-gateway.env`, sur l'hôte.

Pour une copie à part, à la demande :

```bash
docker exec wow-altboard-db pg_dump -U wow_altboard -Fc --no-owner --no-acl wow_altboard > wow_altboard.dump
```

Une copie à part rangée dans `/opt/wow-altboard/backups/` sous un nom qui ne commence pas par
`wow_altboard-` échappe à la rotation et part avec le dossier dans restic. Ainsi la base de la fin
de la bêta, avant la réinitialisation des personnages du 2026-10-29 :
`beta-final-wow_altboard-2026-10-29-195255.dump` (SHA-256 `b25de252…37c27f23`), restaurée à
l'essai dans une base jetable (mêmes nombres de lignes dans les 23 tables), copiée aussi sur l'hôte
Proxmox dans `/root/backups/wow-altboard/`.

Restaurer un dump remplace tout le contenu de la base, en une transaction : en cas d'erreur, rien
n'est modifié.

```bash
cd /etc/komodo/stacks/wow-altboard/deploy/proxmox
docker compose stop web
docker exec -i wow-altboard-db pg_restore -U wow_altboard -d wow_altboard \
  --clean --if-exists --no-owner --no-acl --single-transaction < wow_altboard.dump
docker compose start web
```

## Surveillance

Le site est suivi par le Prometheus du conteneur LXC 107 « observability » (`10.0.0.25`), avec
les autres applications de l'hôte. Rien de propre à ce projet ne route les alertes : elles suivent
Alertmanager, comme les autres.

| Quoi | Comment | Alerte |
|---|---|---|
| Site joignable | sonde `http://10.0.0.15:3016/api/health`, job `blackbox-internal` de `prometheus.yml` | `BlackboxProbeFailed`, règle générale : 5 min sans réponse |
| Sauvegarde | métriques écrites par `wow-altboard-backup.sh`, lues par node_exporter (collecteur textfile) | jamais lancée, en échec, ou silencieuse depuis 48 h |
| Copie hors de l'hôte | idem, à partir de la première copie restic réussie | aucune depuis 14 jours |
| Synchronisations | idem : fin du dernier envoi reçu, tous PC confondus, relevée chaque nuit | aucune depuis 14 jours |

Les règles propres au projet sont dans `deploy/proxmox/monitoring/rules/wow-altboard.yml`, copie
de référence de `/opt/observability/prometheus/rules/wow-altboard.yml`, et leurs essais dans
`rules/tests/`. La CI rejoue ces essais. Après une modification :

```bash
# Sur le conteneur LXC 107, une fois les deux fichiers copiés sous /opt/observability/prometheus/rules
docker exec prometheus promtool test rules /etc/prometheus/rules/tests/wow-altboard.test.yml
docker exec prometheus promtool check config /etc/prometheus/prometheus.yml
curl -X POST http://127.0.0.1:9090/-/reload
```

Ce que la surveillance ne voit pas :

- **Le chemin public de l'agent.** La sonde vise l'origine. Une entrée de tunnel ou un contournement
  Access de `/api/sync` cassés n'apparaissent que dans la fenêtre de l'agent, puis, quatorze jours
  plus tard, dans l'alerte de synchronisation.
- **Un PC parmi d'autres.** L'alerte de synchronisation regarde l'envoi le plus récent, tous PC
  confondus : la page **Machines** donne le détail par PC. Après une pause de jeu, elle se déclenche
  sans qu'il y ait de panne.

## État des serveurs de jeu

La page **Serveurs** n'affiche que « Inconnu » tant qu'aucune adresse n'est configurée. Depuis le
2026-10-09, l'environnement de la pile porte les adresses de la bêta. Depuis le 2026-10-29, la page
**Paramètres** les remplace : serveur de connexion européen, aucun serveur de jeu vérifié pour
l'instant (voir [SERVER-STATUS § Adresses en service](SERVER-STATUS.md#adresses-en-service)).
**Revenir aux adresses de l'environnement** remettrait donc celles de la bêta. Le plus simple pour
changer les adresses : la page **Paramètres** du tableau de bord, sans redéploiement ; une adresse
enregistrée là l'emporte sur l'environnement. Sinon, modifier l'environnement de la pile,
dans Komodo, puis **Deploy** :

```text
WOW_STATUS_AUTH_TARGETS = <hôte>:<port>
WOW_STATUS_GAME_TARGETS = <hôte>:<port>,<hôte>:<port>
```

Le conteneur `web` sonde alors ces adresses toutes les cinq minutes, en TCP sortant ; aucun port
n'est à ouvrir. La table `server_status_checks` est créée par la migration `0003_server_status`.
Cette surveillance est celle des serveurs de Blizzard, vue depuis ce conteneur : elle ne remplace
pas la surveillance du site ci-dessus, et n'envoie aucune alerte.

## Économie

Les pages **Opportunités**, **Marché**, **Craft**, **Farm** et **Audit** n'ont besoin d'aucune
configuration. Elles se remplissent dès qu'un agent 0.5.0 ou plus récent envoie un
`Auctionator.lua` (prix) et un `NaowhForever.lua` (recettes). Les migrations `0005_economy` et
`0006_farm_open_session` créent leurs tables ([DATABASE](DATABASE.md)).

- **Début de l'historique** (page **Paramètres**, section « Moteur économique ») : sans réglage,
  le moteur part de la date limite de la réinitialisation des personnages. Les jours antérieurs au
  2026-11-04, date de la sortie officielle, viennent de la bêta : régler le 2026-11-04 les écarte.
- **Commission de l'hôtel des ventes** : 5 % par défaut, même section.
- **Assistant** de la page Opportunités, facultatif : dans l'environnement de la pile, puis
  **Deploy**. Vides, il est désactivé ; rien d'autre ne change.

Avec Claude, il faut une clé d'API Anthropic, créée sur
[platform.claude.com](https://platform.claude.com) et facturée à l'usage. Un abonnement claude.ai
ne donne pas de clé d'API.

```text
WOW_AI_PROVIDER = anthropic
WOW_AI_API_KEY = <clé d'API Anthropic>     # secret Komodo
WOW_AI_MODEL = claude-opus-5-5             # facultatif : c'est le modèle par défaut
```

Avec une API « chat completions » compatible OpenAI, par exemple un Ollama local :

```text
WOW_AI_URL = http://<hôte>:<port>/v1
WOW_AI_MODEL = <nom du modèle>
WOW_AI_API_KEY = <clé>                     # facultatif ; secret Komodo si renseigné
WOW_AI_REASONING_EFFORT = none             # facultatif : none, minimal, low, medium ou high
```

Modèle local essayé le 2026-11-07 sur Ollama, aux faits d'un historique de plusieurs jours :
`qwen3.5:9b` avec `WOW_AI_REASONING_EFFORT = none` répond en 2 à 4 s. Avec sa réflexion, il
remplit le contexte de 4 096 tokens d'Ollama, ou dépasse les 120 s accordées à une réponse.
Prévoir au moins 8 192 tokens de contexte (variable `OLLAMA_CONTEXT_LENGTH` du serveur Ollama, ou
une variante du modèle à contexte plus grand) : les faits complets peuvent dépasser 4 096 tokens,
et Ollama tronque alors le début du message sans erreur. Un modèle de cette taille peut attribuer
un vrai nombre au mauvais objet ; le contrôle des nombres ne le détecte pas.

Un serveur local n'est pas toujours allumé (PC de jeu, double démarrage). Éteint, il ne gêne rien
d'autre : la page Opportunités l'indique en quelques secondes et masque le formulaire de
l'assistant et le bouton de l'audit du jour (les audits déjà rédigés restent lisibles) ; le bouton
« Réessayer » le sonde de nouveau une fois la machine démarrée. Essai réel
du 2026-11-08 depuis le conteneur `web` : une adresse du réseau local sans machine allumée échoue
en `EHOSTUNREACH` après 3 s.

Le conteneur `web` appelle cette adresse en sortie, avec les seuls faits du moteur
([ECONOMY-ENGINE](ECONOMY-ENGINE.md#faits-et-assistant-p11)). Avec Claude, ces faits sortent du
réseau local vers l'API Anthropic : prix, crafts, noms d'objets et libellés des sessions de farm.

## Recréer la pile

1. Dans Komodo, **Settings > Variables** : créer `WOW_ALTBOARD_DB_PASSWORD`, case « secret »
   cochée. Valeur hexadécimale uniquement, elle entre telle quelle dans l'URL de connexion :
   `openssl rand -hex 24`. PostgreSQL ne la lit qu'à la création du volume.
2. Créer la pile `wow-altboard` d'après `deploy/proxmox/komodo.toml`, puis **Deploy**. Depuis le
   réseau local, `curl http://10.0.0.15:3016/api/health` répond `{"status":"ok",…}`, avec la
   version et le commit en service.
3. Tunnel Cloudflare « proxmox » : entrée `wow.ekreativ.be` vers `http://10.0.0.15:3016`, avant
   la règle finale `http_status:404`.
4. DNS : `wow.ekreativ.be` en CNAME proxifié vers `<identifiant du tunnel>.cfargotunnel.com`.
5. Cloudflare Access : application « wow-sync-bypass » sur `wow.ekreativ.be/api/sync`, politique
   de contournement pour tous. Sans elle, l'agent reçoit une redirection vers la page de connexion
   d'Access au lieu d'atteindre l'API.
6. Restaurer une sauvegarde (voir [Sauvegarde](#sauvegarde)), ou créer un compte d'accès et des
   jetons sur une base vide.
7. Installer le minuteur de sauvegarde (voir [Sauvegarde](#sauvegarde)). La sonde et les règles
   d'alerte vivent sur le conteneur 107 et survivent à la pile (voir [Surveillance](#surveillance)).

## Changer d'adresse

L'application ne contient aucune URL en dur : origine et préfixe viennent de la configuration.

| Adresse | `WOW_APP_ORIGIN` | `WOW_BASE_PATH` | Routage |
|---|---|---|---|
| `https://wow.ekreativ.be` (actuelle) | `https://wow.ekreativ.be` | vide | hôte `wow.ekreativ.be` |
| `https://ekreativ.be/wow` | `https://ekreativ.be` | `/wow` | hôte `ekreativ.be`, chemin `/wow` |

Le routage se règle dans l'entrée du tunnel et dans le domaine de l'application Access.
`WOW_BASE_PATH` est fixé à la construction de l'image. Le fonctionnement sous `/wow` a été vérifié
de bout en bout sur contabo, derrière Traefik : liens, redirections, ressources, API, export,
cookie. Après un changement d'adresse : redéployer, puis sur chaque PC
`AltBoardSync.exe config set serverUrl <nouvelle adresse>/api/sync`. Les jetons restent valables ;
les sessions du tableau de bord sont à rouvrir (le cookie est lié à l'hôte).

Sous Git Bash pour Windows, préfixer les commandes par `MSYS_NO_PATHCONV=1` : sans cela `/wow` est
réécrit en chemin Windows et la construction échoue.

## Ancien hôte : contabo

Désinstallé le 2026-10-05, après copie de la base vers Proxmox (22 tables, 893 lignes, comptes
identiques des deux côtés) : conteneur, image, sources, configuration Traefik, base et rôle y sont
supprimés. `pgdb` a gardé un dernier dump,
`/srv/backups/dumps/pgdb-drop-wow_altboard-2026-10-05-234106.dump`, et archivé le secret de la base.

`deploy/docker-compose.yml`, `deploy/.env.example` et `deploy/traefik/` décrivent ce déploiement.
Ils restent comme référence pour un hôte du même type : PostgreSQL mutualisé derrière PgBouncer,
Traefik en frontal. La suite le décrit tel qu'il fonctionnait.

| Élément | Valeur |
|---|---|
| Sources | `/etc/komodo/repos/wow-altboard/` (`web/`, `deploy/`, `REVISION` = commit déployé) |
| Conteneur | `wow-altboard-web`, image `wow-altboard-web:<commit>`, port `127.0.0.1:3016` |
| Configuration | `/etc/komodo/repos/wow-altboard/deploy/.env` (droits `600`) |
| Base | `wow_altboard` sur `pg-shared` (PostgreSQL 17), rôle `wow_altboard`, créés par `pgdb` |
| Secret de la base | `/srv/shared-db/secrets/wow_altboard.env` (droits `600`) |
| Réseau Docker | `shared-db` (externe) : `pgbouncer:6432` pour l'application, `pg-shared:5432` pour les migrations |
| Reverse proxy | `/etc/traefik/dynamic/wow-altboard.yml` (copie de référence : `deploy/traefik/wow-altboard.yml`) |
| DNS | `wow.ekreativ.be` A → adresse de l'hôte, **non proxifié** par Cloudflare |

### Conventions de l'hôte

- **Une base, un rôle** par projet, créés par l'outil `pgdb` (`pgdb create <projet>`), qui révoque
  l'accès public à la base et range les identifiants dans `/srv/shared-db/secrets/`. Le rôle
  `wow_altboard` possède sa base et n'a accès à aucune autre.
- **PgBouncer** en mode transaction, authentification par `auth_query` : aucun fichier à modifier
  pour un nouveau rôle. L'application n'utilise ni état de session ni requête préparée nommée ; son
  verrou de synchronisation est un verrou de transaction.
- **Traefik** en fichiers dynamiques surveillés : un fichier par projet, chaîne `default-chain`
  (CrowdSec + en-têtes) et `compress-br`.
- **Adresse du client** : le domaine n'étant pas proxifié, l'en-tête de confiance est `X-Real-Ip`,
  posé par Traefik. `cf-connecting-ip` serait falsifiable sur cet hôte.
- La chaîne `default-chain` remplace deux en-têtes de l'application (`X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`). L'interdiction d'encadrement reste assurée
  par `frame-ancestors 'none'` dans la CSP, que Traefik ne touche pas.

### Mettre à jour

Les sources ne sont pas clonées sur cet hôte : elles y sont copiées par archive.

```bash
git archive --format=tar.gz -o wow-altboard-src.tar.gz HEAD web deploy
scp wow-altboard-src.tar.gz root@<contabo>:/tmp/
```

Sur l'hôte :

```bash
cd /etc/komodo/repos/wow-altboard
tar -xzf /tmp/wow-altboard-src.tar.gz && rm /tmp/wow-altboard-src.tar.gz
echo <commit> > REVISION
cd deploy
sed -i 's/^WOW_IMAGE_TAG=.*/WOW_IMAGE_TAG=<commit>/' .env
docker compose build
docker compose run --rm tools node migrate.mjs     # sans effet s'il n'y a pas de nouvelle migration
docker compose up -d
docker compose ps                                # healthy attendu
```

`deploy/.env` n'est pas dans l'archive : il n'est jamais écrasé. Chaque image est étiquetée par son
commit ; pour relancer la précédente :
`sed -i 's/^WOW_IMAGE_TAG=.*/WOW_IMAGE_TAG=<commit précédent>/' .env && docker compose up -d`.

### Désinstaller

Les commandes exécutées le 2026-10-05, puis suppression de l'image et du dossier des sources :

```bash
cd /etc/komodo/repos/wow-altboard/deploy && docker compose down
rm /etc/traefik/dynamic/wow-altboard.yml         # Traefik recharge seul
pgdb drop wow_altboard --yes                     # sauvegarde la base avant de la supprimer
```
