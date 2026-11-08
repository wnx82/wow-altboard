# Base de données

> Source unique du schéma : `web/src/db/schema.ts` (Drizzle). Migrations générées dans
> `web/drizzle/`. Structure des données d'origine : [ALTBOARD-DATA-MODEL](ALTBOARD-DATA-MODEL.md),
> [LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md) pour le temps de jeu,
> [AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md) pour les prix,
> [PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md) pour les recettes.

## État

| Environnement | État |
|---|---|
| PostgreSQL 17 local (Docker, `127.0.0.1:35432`) | ✅ migrations appliquées et vérifiées dans la base de test (41 tables, 9 migrations, 2026-11-08) |
| Production (PostgreSQL 17 de la pile, Proxmox) | ✅ base `wow_altboard` copiée de contabo le 2026-10-05 (22 tables), migrations jusqu'à `0004` ; `0005` et `0006` (économie) s'appliqueront au prochain déploiement de `main` |

## Isolation

- Base dédiée **`wow_altboard`** ; aucune table dans une base ou un schéma existant.
- En production, PostgreSQL appartient à la pile : une instance, une base, un rôle `wow_altboard`
  qui l'administre, sans aucun autre projet. Elle n'est jamais publiée hors du réseau de la pile.
- L'application et les migrations s'y connectent directement. Le code reste compatible avec
  PgBouncer en mode transaction, utilisé sur l'ancien hôte.
- Garde-fou applicatif (`web/src/db/env.ts`) : toute connexion vers une base dont le nom ne commence
  pas par `wow_altboard` est refusée avant même d'ouvrir une socket ; les tests n'acceptent que
  `wow_altboard*_test`.
- Variables `WOW_DATABASE_URL`, `WOW_DATABASE_URL_DIRECT`, `WOW_TEST_DATABASE_URL` : jamais de nom
  générique, qui pourrait exister dans l'environnement pour un autre projet.

## Tables (41)

Conventions : clés `bigint` générées, dates en `timestamptz`, argent en pièces de cuivre.

### Référentiel

| Table | Clé d'unicité | Contenu |
|---|---|---|
| `machines` | `machine_uuid` | Un PC : UUID généré par l'agent, nom d'hôte (informatif), nom d'affichage, version de l'agent |
| `agent_tokens` | `token_hash` | Jeton d'agent (SHA-256 seulement), libellé, machine liée, révocation |
| `wow_accounts` | `account_key` | Un compte : empreinte du nom de dossier, libellé masqué, nom d'affichage |
| `machine_accounts` | `(machine_id, account_id)` | Quel PC a vu quel compte : client, version d'addon, empreinte et date du fichier |
| `realms` | `name` | Royaume (nom normalisé). Pas de région : absente d'AltBoard |
| `items` | `item_key` | Référentiel d'objets partagé (`AltBoardDB.items`) |

### Personnages

| Table | Clé | Contenu |
|---|---|---|
| `characters` | `guid` | Identité, niveau, expérience, or, niveau d'objet, guilde, zone, emplacements de sacs et de banque, horodatages de l'addon, hash du contenu |
| `character_machines` | `(character_id, machine_id)` | Quel PC a vu quel personnage |
| `character_stats` | `character_id` | 27 statistiques typées |
| `character_professions` | `(character_id, skill_line)` | Métier, niveau, maximum, principal, ordre |
| `character_equipment` | `(character_id, slot)` | Objet par emplacement (1 à 19), qualité, niveau, ID d'enchantement |
| `character_reputations` | `(character_id, faction_id)` | Palier et valeurs |
| `character_currencies` | `(character_id, name)` | Quantité (la clé est le nom : l'addon ne fournit pas d'identifiant) |
| `character_items` | `(character_id, location, item_key)` | Contenu des sacs (`bags`) et de la banque (`bank`) |
| `character_playtime` | `character_id` | Dernier `/played` connu, date de la mesure, début du niveau en cours (addon Allemano Ledger) |
| `character_level_times` | `(character_id, level)` | Un niveau terminé : temps de jeu, temps réel, date, zone (addon Allemano Ledger) |
| `character_sessions` | `(character_id, started_at)` | Une session de jeu : fin, temps connecté, expérience gagnée, niveaux, zone, étiquette, session encore ouverte (addon Allemano Ledger) |

Colonnes volontairement absentes, faute de donnée dans AltBoard : genre, région, quêtes. Les
recettes viennent de NaowhForever (tables de l'économie).

### Historique et journal

| Table | Contenu |
|---|---|
| `character_snapshots` | Un état daté par progression : niveau, expérience et expérience du niveau (`xp_max`), or, niveau d'objet + détail en `jsonb`. Unicité `(character_id, captured_at)` |
| `sync_runs` | Une ligne par synchronisation : machine, statut, compteurs, durée, versions |
| `sync_errors` | Erreurs et avertissements de l'agent rattachés à une synchronisation |

### Économie

Voir [ECONOMY-ENGINE](ECONOMY-ENGINE.md). Ajoutées par `0005_economy`, `0006_farm_open_session` et `0008_economy_audits`.

| Table | Clé | Contenu |
|---|---|---|
| `markets` | `(flavor, auction_key)` | Un hôtel des ventes : client (`_forever_`…) et clé Auctionator (« PvE ») |
| `market_imports` | `(market_id, account_id, content_hash)` | Un relevé Auctionator reçu : compte, machine, synchronisation, date du fichier, objets, premier et dernier jour. Un même contenu n'est importé qu'une fois |
| `market_item_days` | `(market_id, item_key, day)` | Un objet, un jour : plus bas et plus haut des prix minimums, plus grande quantité. Fusion de plusieurs relevés (plus bas des plus bas, plus haut des plus hauts) |
| `market_item_latest` | `(market_id, item_key)` | Dernier prix minimum vu et son jour |
| `vendor_prices` | `item_key` | Prix chez un marchand (`AUCTIONATOR_VENDOR_PRICE_CACHE`) |
| `recipes` | `spell_id` | Recette : métier, objet produit, quantité, temps de recharge |
| `recipe_reagents` | `(spell_id, item_id)` | Composants d'une recette |
| `character_recipes` | `(character_id, spell_id)` | Recettes connues d'un personnage, remplacées à chaque fichier plus récent |
| `character_recipe_sources` | `character_id` | Date et empreinte du dernier fichier NaowhForever appliqué |
| `farm_sessions` | `id` | Session de farm : personnage, libellé, relevés des sacs de début et de fin (`start_source_at`, `end_source_at`), argent. Index unique partiel : une seule session ouverte par personnage |
| `farm_session_items` | `(session_id, phase, location, item_key)` | Inventaire au début (`start`) et à la fin (`end`), sacs et banque |
| `opportunity_runs` | `id` | Un calcul d'opportunités : marché, date, version du moteur, paramètres et base (`jsonb`), dernier import, jour des données |
| `opportunities` | `(run_id, rank)` | Une recommandation : type, objet ou recette, valeur, confiance, horizon, raisons, entrées (`jsonb`) |
| `economy_audits` | `(market_id, day)` | Audit du jour rédigé par l'assistant : jour (Europe/Brussels), calcul dont viennent ses faits (`run_id`, vidé si ce calcul disparaît), jour des données, modèle, texte, date de rédaction. Réécrit le même jour, il remplace le précédent |

### Objectifs par personnage

Sortes et règle d'atteinte : `web/src/lib/goals/evaluate.ts`. Un objectif automatique (niveau,
métier, réputation, objet possédé, or, niveau d'objet moyen, monnaie) est daté par la
synchronisation qui le fait atteindre, ou à son ajout s'il l'est déjà ; atteint une fois, il le
reste. Un objectif `manual` se coche sur la fiche.

| Table | Clé | Contenu |
|---|---|---|
| `character_goals` | `id` | Un objectif : personnage, position, libellé, sorte, paramètres (`jsonb` : `target`, `subject`), date d'atteinte. Supprimé en cascade avec le personnage |
| `goal_templates` | `id` | Un modèle, par son nom (unique). Indépendant des personnages : survit à leur réinitialisation |
| `goal_template_items` | `id` | Objectif d'un modèle, sans date : position, libellé, sorte, paramètres |

### Surveillance des serveurs de jeu

| Table | Contenu |
|---|---|
| `server_status_checks` | Un contrôle d'un service (`auth`, `game`) par le serveur web : date, statut, constat, latence, adresses jointes sur adresses sondées, source, code d'erreur. Sans lien avec les autres tables ; lignes de plus de 8 jours purgées par l'application ([SERVER-STATUS](SERVER-STATUS.md)) |

### Réglages du site

| Table | Contenu |
|---|---|
| `app_settings` | Réglages de la page **Paramètres**, sur une seule ligne (`id = 1`), créée à la première écriture. Adresses surveillées par service (vide : rien n'est surveillé ; absente : l'environnement du serveur s'applique) et libellé d'environnement ([SERVER-STATUS](SERVER-STATUS.md)) ; date limite et date de la dernière réinitialisation des personnages ; début de l'historique des prix et commission de l'hôtel des ventes |

### Accès au tableau de bord

| Table | Contenu |
|---|---|
| `admin_users` | Adresse, hash scrypt du mot de passe |
| `sessions` | Empreinte de l'identifiant de session, expiration |

## Contraintes

37 clés primaires, 38 clés étrangères, 10 contraintes d'unicité, 22 contraintes de validation
(`slot` entre 1 et 19, `location` ∈ `bags`/`bank`, quantités, or et durées positifs, statut de
synchronisation ; service, statut et nombre d'adresses jointes d'un contrôle de serveur ; ligne
unique des réglages ; plus bas ≤ plus haut, prix et quantités positifs, type d'opportunité, phase
et fin d'une session de farm), plus l'index unique partiel des sessions de farm ouvertes. Comptés
dans `pg_constraint` de la base de test le 2026-11-06.

Suppression d'un personnage : ses tables filles et ses snapshots suivent (`ON DELETE CASCADE`).
Un compte, un royaume ou une machine référencé ne peut pas être supprimé.

## Réinitialisation des personnages

Prévue pour la sortie officielle du jeu : les personnages de la bêta n'existent plus chez Blizzard,
mais leurs fichiers restent sur les PC. Elle se lance dans **Paramètres**, mot de passe à l'appui,
avec une **date limite** (par défaut : l'instant de la demande).

| Étape | Effet |
|---|---|
| Suppression | tout personnage dont `source_last_seen_at` est antérieur à la date limite, avec ses tables filles et ses snapshots |
| Royaumes | un royaume resté sans personnage est supprimé |
| Date limite | retenue dans `app_settings.characters_cutoff_at` ; la date de la demande dans `characters_reset_at` |
| Conservés | comptes, machines, jetons, journal des synchronisations, référentiel d'objets, historique des serveurs, modèles d'objectifs (les objectifs des personnages supprimés partent avec eux) |

Une transaction, sous le verrou des synchronisations : aucune ne s'intercale. La suppression est
définitive ; seule une sauvegarde de la base permet de revenir en arrière
(voir [DEPLOYMENT](DEPLOYMENT.md)). Relancer avec une date plus ancienne n'efface rien de plus et
réadmet les personnages vus en jeu depuis cette date.

## Règles d'écriture

Une synchronisation = **une transaction**, sérialisée par un verrou consultatif de transaction.
En cas d'erreur, tout est annulé, puis l'échec est journalisé à part (`sync_runs` en `failed`).

| Situation | Effet |
|---|---|
| GUID inconnu | Personnage créé, premier snapshot |
| GUID inconnu, `lastSeen` antérieur à la date limite de la dernière réinitialisation | Rien n'est créé (`characters_stale`) : un PC qui garde le fichier de la bêta le renvoie à chaque envoi. Un personnage déjà connu n'est pas concerné |
| `lastSeen` reçu **plus ancien** que celui stocké | Rien n'est modifié (`characters_stale`) : un PC en retard n'écrase pas un état plus récent |
| Contenu identique (hash canonique) | Rien n'est modifié (`characters_unchanged`) |
| Contenu différent | Personnage mis à jour ; tables filles remplacées |
| Bloc daté (`bank`, `bags`, `stats`) absent ou plus ancien que celui stocké | Bloc conservé : un PC qui n'a jamais ouvert la banque n'efface pas celle relevée ailleurs |
| Personnage absent du fichier | Jamais supprimé : l'absence ne prouve pas la suppression en jeu |
| Même compte depuis deux PC | Un seul `wow_accounts`, deux `machine_accounts` |
| Niveau terminé (`playtime.levels`) | Ajouté, jamais retiré ; une valeur connue n'est jamais remplacée par une absence. Appliqué même quand `lastSeen` est plus ancien : chaque PC ne connaît que les niveaux gagnés chez lui |
| Total `/played` et niveau en cours | Remplacés seulement par une mesure au moins aussi récente (`measured_at`) |
| Session de jeu (`sessions`) | Ajoutée, jamais retirée, même quand `lastSeen` est plus ancien. Une session close remplace sa version ouverte ; une version ouverte n'en remplace une autre que si elle est au moins aussi récente, et jamais une session close |

Tous les hash sont calculés sur un JSON **canonique** (clés triées) : le client WoW réécrit ses
tables dans un ordre différent à chaque sauvegarde.

## Snapshots

Un snapshot est créé quand le **hash de progression** diffère de celui du dernier snapshot du
personnage. Entrent dans ce hash : niveau, expérience, or, niveau d'objet, guilde, métiers (niveau,
maximum), équipement (objet, enchantement), réputations (palier, valeur), monnaies.

N'y entrent pas : zone, expérience reposée, statistiques, horodatages, contenu des sacs, temps de jeu,
sessions. Une
connexion sans progression met donc le personnage à jour sans créer d'historique.

La comparaison se fait avec le **dernier** snapshot seulement : un retour à un état antérieur
(100 po → 200 po → 100 po) est bien historisé. L'unicité `(character_id, captured_at)` rend le
rejeu d'une synchronisation sans effet.

## Index

Seuls existent les index des contraintes, plus `characters(account_id)`, `characters(realm_id)`,
`sync_runs(machine_id, started_at)`, `sessions(expires_at)` et
`server_status_checks(service, checked_at)`. Les pages lisent leurs données en
un nombre fixe de requêtes (3 pour la liste, vérifié par test avec 1, 5 et 50 personnages) ; aucun
autre index ne se justifie à ce volume. À réévaluer avec `EXPLAIN` si l'historique grossit.

## Migrations

```bash
cd web
npm run db:generate          # après modification de src/db/schema.ts
npm run db:migrate           # applique sur WOW_DATABASE_URL_DIRECT, sinon WOW_DATABASE_URL
npm run db:migrate:test      # applique sur la base de test
```

En production, le service `migrate` de la pile les applique à chaque déploiement, avant le
démarrage de l'application.
Ne jamais passer de `statement_timeout` (ni aucun autre paramètre de session) dans les options du
pool : PgBouncer refuse les paramètres de démarrage hors de sa liste. Un test le vérifie.
Derrière PgBouncer, les migrations passent en connexion directe. Le suivi est tenu dans
`drizzle.__drizzle_migrations`.

| Migration | Contenu |
|---|---|
| `0000_init` | les 19 tables d'origine |
| `0001_playtime` | `character_playtime`, `character_level_times` (ajouts seuls) |
| `0002_sessions` | `character_sessions`, colonne `character_snapshots.xp_max` (ajouts seuls). Les relevés antérieurs reçoivent le `xp_max` de leur personnage quand il est encore au même niveau ; les autres restent sans valeur |
| `0003_server_status` | `server_status_checks` et son index (ajout seul) |
| `0004_app_settings` | `app_settings` (ajout seul) |
| `0005_economy` | 13 tables de l'économie, colonnes `app_settings.market_history_from` et `auction_cut_percent` (ajouts seuls) |
| `0006_farm_open_session` | index unique partiel `farm_sessions_open_character_idx` (ajout seul) |
| `0007_goals` | `character_goals`, `goal_templates`, `goal_template_items` et leurs index (ajouts seuls) |
| `0008_economy_audits` | `economy_audits` (ajout seul) |

## Checkpoint B

Vérifié dans les instances, pas seulement dans les fichiers SQL :

| Contrôle | Local | Production |
|---|---|---|
| Tables présentes | 19 / 19 | 19 / 19 |
| Contraintes (`pg_constraint`) | 19 PK, 19 FK, 8 UNIQUE, 5 CHECK | identique |
| Suivi des migrations | 1 migration | 1 migration |
| Unicité, clés étrangères, validations, cascade, rollback | tests d'intégration | — |
| Migration depuis l'image Docker | base vierge → 19 tables | base vierge → 19 tables |
| Le rôle ne peut pas ouvrir les bases d'autres projets | — | refusé (`ekreativ`, `sysaudit`) |
| Le rôle ne peut pas créer de base | — | refusé |
| Bases et rôles préexistants inchangés | — | 27 bases et 31 rôles identiques avant et après |
