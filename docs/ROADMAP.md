# Roadmap

Statuts : ⬜ À faire · 🟡 En cours · ✅ Validé · 🔴 Bloqué

Une étape n'est ✅ que si elle est implémentée, testée et vérifiée sur un résultat réel.

Dernière mise à jour : 2026-11-08.

## Synthèse

| | |
|---|---|
| En production sur `https://wow.ekreativ.be` | ✅ depuis le 2026-10-04 |
| Chaîne complète PC → agent → HTTPS → PostgreSQL → tableau de bord | ✅ sur les fichiers réels (2 comptes, 6 personnages) |
| Recette après une vraie modification en jeu | ⬜ à faire par le joueur : jouer, `/reload`, `AltBoardSync.exe sync` |
| Compte personnel d'accès au tableau de bord | ⬜ à créer par le joueur (mot de passe saisi sur le serveur) |
| Tests automatisés | agent et web, tous verts ; la CI les relance à chaque envoi et les compte |

Le critère de réussite de la V1 est rempli jusqu'à l'étape 5 (personnage vérifié dans le fichier, la
base et la page). Les étapes 6 à 10 — modifier une donnée en jeu, resynchroniser, constater la mise
à jour sans doublon — demandent une action en jeu et restent à faire.

## P0 — Analyse

| Étape | Statut | Preuve |
|---|---|---|
| Dépôt | ✅ | audit initial du 2026-10-04 (document retiré à la publication du dépôt) |
| Environnement | ✅ | idem |
| `AltBoard.lua` | ✅ | 2 fichiers réels, 6 personnages |
| `AltBoardDB` | ✅ | [ALTBOARD-DATA-MODEL](ALTBOARD-DATA-MODEL.md), source de l'addon lu |
| PostgreSQL | ✅ | inventaire de l'instance de production : 27 bases, PostgreSQL 17.10, PgBouncer en mode transaction |

**Checkpoint A** ✅ — machine, compte, royaume et personnage identifiables sans ambiguïté.

## P1 — Modèle de données

| Étape | Statut |
|---|---|
| Modèle AltBoard réel | ✅ |
| Schéma relationnel | ✅ |
| Stratégie d'identifiants (GUID, empreinte de compte, UUID de machine) | ✅ |
| Snapshots | ✅ |
| Synchronisations | ✅ |

## P2 — PostgreSQL

| Étape | Statut | Note |
|---|---|---|
| Base dédiée | ✅ | `wow_altboard`, créée par l'outil de l'hôte (`pgdb`) |
| Migrations | ✅ | appliquées depuis l'image, en local et en production |
| Contraintes | ✅ | vérifiées dans les deux instances |
| Index essentiels | ✅ | |
| Validation dans l'instance de production | ✅ | |

**Checkpoint B** ✅ — en production : 19 tables, 19 PK, 19 FK, 8 UNIQUE, 5 CHECK, 1 migration ; le
rôle ne peut ni ouvrir une base d'un autre projet ni créer de base ; les 27 bases et 31 rôles
préexistants sont identiques avant et après.

## P3 — Parser

| Étape | Statut |
|---|---|
| Lecture Lua | ✅ |
| Normalisation | ✅ |
| Fixtures (réelles anonymisées + cas limites) | ✅ |
| Tests | ✅ |

**Checkpoint C** ✅ — fichiers réels comparés à l'objet produit par l'agent, au moyen d'un second
parser indépendant : 6 personnages, 3 144 comparaisons, 0 écart.

## P4 — Agent Windows manuel

| Étape | Statut |
|---|---|
| Détection de WoW | ✅ |
| Détection des comptes | ✅ |
| Parsing | ✅ |
| UUID de machine | ✅ |
| Configuration | ✅ |
| `sync` | ✅ contre la production, en HTTPS |

## P5 — API

| Étape | Statut |
|---|---|
| Point d'entrée | ✅ |
| Authentification | ✅ |
| Validation | ✅ |
| Transactions | ✅ |
| Upsert | ✅ |
| Idempotence | ✅ |

**Checkpoint D** ✅ — même document envoyé dix fois (test) ; en production, fichiers réels
synchronisés deux fois de suite : 6 créés puis 6 inchangés, 6 GUID distincts pour 6 personnages.

## P6 — Tableau de bord

| Étape | Statut |
|---|---|
| Accueil | ✅ |
| Statistiques | ✅ |
| Cartes personnages | ✅ |
| Recherche | ✅ |
| Filtres | ✅ |
| Tri | ✅ |
| Vue cartes / tableau mémorisée | ✅ |
| Adaptation aux écrans (390 à 1920 px) | ✅ |
| Icônes de classe et de métier (CDN de Blizzard, servies par ce site) | ✅ |

Essais d'interface faits en local sur une base de test : 0, 1, 5, 20 et 50 personnages ; noms court,
très long, accentué, à apostrophes, hors alphabet latin ; base injoignable.

## P7 — Personnage

| Étape | Statut | Note |
|---|---|---|
| Vue générale | ✅ | |
| Métiers | ✅ | |
| Équipement | ✅ | enchantement : identifiant seulement (le nom n'existe pas dans AltBoard) |
| Monnaies | ✅ | |
| Réputations | ✅ | |
| Inventaire (sacs, banque, recherche) | ✅ | |
| Historique | 🟡 | courbes et changements vérifiés sur un personnage de démonstration en local ; en production chaque personnage n'a encore qu'un relevé |
| Courbe « Niveau et expérience » | 🟡 | niveau et part d'expérience acquise sur une même échelle, depuis les relevés. Vérifiée en local ; un relevé antérieur sans `xp_max` reste au niveau entier |
| Sessions de jeu (expérience par session, par heure, tableau) | 🟡 | source : addon Allemano Ledger. Session ouverte vérifiée en local sur le fichier réel du 2026-10-04 : fichier ↔ agent ↔ base ↔ page, 0 écart. Sessions closes : vérifiées sur fixture seulement, aucune n'existe encore |
| Temps par niveau (graphique, tableau, temps de jeu total) | 🟡 | source : addon Allemano Ledger ([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)). Vérifié en local sur le fichier réel du 2026-10-04 : fichier ↔ agent ↔ base ↔ page, 0 écart (1 personnage, 1 niveau terminé). Reste la mise en production |

**Checkpoint E** ✅ — en production : `AltBoard.lua` ↔ base (138 comparaisons) ↔ pages servies par
`wow.ekreativ.be` (122 comparaisons), 0 écart sur les 6 personnages réels.

## P8 — Comptes et machines

| Étape | Statut |
|---|---|
| Comptes (noms d'affichage) | ✅ |
| Machines (noms d'affichage, jetons) | ✅ |
| Dernière synchronisation, journal | ✅ |
| Agent téléchargeable depuis la page **Machines**, publié dans l'image du site, en archive ZIP ou exécutable seul | ✅ |

## P9 — Excel

| Étape | Statut |
|---|---|
| Génération XLSX | ✅ |
| Multi-feuilles (8) | ✅ |
| Téléchargement | ✅ |

## P10 — Sécurité

| Étape | Statut | Note |
|---|---|---|
| Authentification web | ✅ | |
| Jeton d'agent | ✅ | |
| Validation | ✅ | |
| Limitation de débit | ✅ | en mémoire : valable pour une instance unique |
| Secrets | ✅ | aucun dans le dépôt ; en production, fichiers en `600` |
| En-têtes | ✅ | CSP à nonce vérifiée en production, sans violation |

## P11 — Recette réelle

| Étape | Statut | Note |
|---|---|---|
| PC réel | ✅ | ce poste, agent installé |
| Plusieurs comptes | ✅ | 2 |
| Plusieurs personnages | ✅ | 6 |
| Modifications réelles | ⬜ | aucune modification en jeu depuis la première synchronisation |
| Nouvelle synchronisation | ✅ | sans changement : tout « inchangé » |
| Contrôle de la base | ✅ | production |
| Contrôle de l'interface | ✅ | production |

## P12 — Préparation de l'automatisation

| Étape | Statut |
|---|---|
| Surveillance conçue | ✅ documentée dans [AGENT](AGENT.md) |
| Anti-rebond conçu | ✅ |
| Empreinte conçue | ✅ (déjà calculée et stockée à chaque synchronisation) |
| Service futur documenté | ✅ |

Implémenté depuis l'agent 0.2.0 : `watch`, `autostart`, icône de la zone de notification.
Depuis l'agent 0.3.0 : fenêtre (démarrage avec Windows, journal des envois et de ce qui a changé).
Depuis l'agent 0.4.0 : saisie du jeton dans la fenêtre, sans ligne de commande.

## P13 — `wow.ekreativ.be`

| Étape | Statut | Note |
|---|---|---|
| Configuration du domaine | ✅ | DNS proxifié, tunnel Cloudflare, Cloudflare Access (Traefik sur contabo jusqu'au 2026-10-05) |
| Pile Komodo sur Proxmox | ✅ | base copiée de contabo, bascule vérifiée par une synchronisation réelle le 2026-10-05 |
| URLs configurables | ✅ | vérifié à la racine et sous `/wow` |
| Authentification compatible | ✅ | cookie lié à l'hôte, aucun domaine en dur |
| Documentation | ✅ | [DEPLOYMENT](DEPLOYMENT.md) |

## P14 — État des serveurs WoW Forever EU

| Étape | Statut | Note |
|---|---|---|
| Sources de statut étudiées | ✅ | aucune API documentée pour WoW Forever ; voir [SERVER-STATUS](SERVER-STATUS.md) |
| Sonde TCP, moniteur, historique, page **Serveurs** | ✅ | implémentés et testés (58 tests) ; en production depuis le 2026-10-09, sur les serveurs de la bêta jusqu'au 2026-10-29 |
| Adresses des serveurs européens de production | ✅ | serveur de connexion `eu.actual.battle.net:1119` en service depuis le 2026-10-29, relevé dans le journal du client `_forever_` ; deux serveurs de jeu (royaume et monde, port 3724) relevés sur un client en jeu et sondés en production depuis le 2026-11-08 : en ligne, 2/2 ([SERVER-STATUS](SERVER-STATUS.md#adresses-en-service)) |
| Maintenances annoncées | ⬜ | aucune source officielle documentée |

## P15 — Paramètres

| Étape | Statut | Note |
|---|---|---|
| Page **Paramètres**, table `app_settings` | ✅ | réglages enregistrés en base, appliqués sans redéployer |
| Serveurs surveillés réglables sur le site | ✅ | adresses par service, libellé d'environnement, historique effaçable, retour à l'environnement du serveur ; adresses publiques seulement ([SECURITY](SECURITY.md)) |
| Réinitialisation des personnages | ✅ | pour la sortie officielle : suppression avec date limite, mot de passe redemandé ; les fichiers de la bêta renvoyés ensuite sont ignorés ([DATABASE](DATABASE.md)). Faite en production le 2026-10-29 à 19:53, après sauvegarde ([DEPLOYMENT § Sauvegarde](DEPLOYMENT.md#sauvegarde)) : 14 personnages supprimés ; un renvoi des fichiers de la bêta n'en a recréé aucun |
| Tests | ✅ | 29 tests ajoutés ; parcours de la page vérifié dans un navigateur sur la base de test |

## P16 — Économie

Roadmap dédiée, phases P0 à P15 de l'économie : statuts détaillés dans
`Roadmaps/AltBoard-WoW-Economy-Roadmaps/ROADMAP-PRINCIPALE.md`, non versionné. Règles du moteur :
[ECONOMY-ENGINE](ECONOMY-ENGINE.md).
Branche `feat/economy` (site 0.3.0, agent 0.5.0), **ni fusionnée ni déployée**.

| Étape | Statut | Note |
|---|---|---|
| Source des prix | ✅ | Auctioneer absent de tous les comptes : **Auctionator** lu à sa place ([AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md)) |
| Source des recettes | ✅ | addon NaowhForever, données du jeu ([PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md)) |
| Lecture par l'agent | ✅ | CBOR décodé, fichiers facultatifs, `watch` réagit aussi à ces deux fichiers |
| Import PostgreSQL | ✅ | scan réel chargé dans la base de test : 9 hôtels des ventes, 56 239 relevés en 3,5 s ; les 46 651 relevés journaliers fusionnés sont identiques au fichier ; second envoi sans effet |
| Moteur de prix, craft, farm, opportunités | 🟡 | déterministe, testé ; sur les données réelles, deux jours de relevés seulement depuis la sortie officielle : tout est « attendre », aucune opportunité inventée |
| Pages Opportunités, Marché, objet, Craft, Farm, Audit | ✅ | vérifiées dans un navigateur sur les données réelles, aucune erreur de console |
| Sessions de farm (po/h mesuré) | 🟡 | testées ; aucune session réelle en jeu |
| Faits structurés et assistant facultatif | 🟡 | `GET /api/economy/facts` vérifié sur les données réelles ; assistant essayé avec un modèle local réel, pas encore depuis la page en production |
| Audit du jour rédigé par l'assistant | 🟡 | conservé par marché et par jour, mêmes faits et même vérification ; essayé avec un modèle local réel sur la fixture (2026-11-08) ; en production depuis le 2026-11-08 (site 0.7.0), pas encore essayé depuis la page |
| Nombre d'enchères, prix « 24 h », prix moyen pondéré | 🔴 | absents d'Auctionator, qui ne garde qu'un relevé par jour |

## Reste à faire

| Quoi | Qui |
|---|---|
| Sortie officielle, sur chaque PC : copier les addons AltBoard et Allemano Ledger dans `_forever_\Interface\AddOns`, puis installer la dernière version de l'agent (0.5.1 depuis le 2026-11-08), téléchargeable depuis la page **Machines**, qui lit la racine `World of Warcraft` (avec l'agent 0.4.0 : `config set wowPath`, voir [AGENT § Découverte](AGENT.md#découverte)). Fait sur `MSI` le 2026-10-29 ; restent `LAPTOP-WNX` et `LAPTOP-LENOVO` | joueur |
| Créer son compte d'accès (voir [DEPLOYMENT § Comptes et jetons](DEPLOYMENT.md)) | joueur |
| Recette après une vraie modification en jeu | joueur |
| Agent sur les autres PC : copier `AltBoardSync.exe`, créer un jeton par PC | joueur |
| Économie : fusion, déploiement et agent 0.5.0 faits le 2026-11-06. Reste à régler **Début de l'historique** au 2026-11-04 dans **Paramètres**, puis scanner l'hôtel des ventes chaque jour (Auctionator) et ouvrir chaque métier une fois (NaowhForever) | joueur |
| Économie : comparer en jeu quelques prix et un craft avec les pages Marché et Craft, une fois trois jours de scans reçus ; mesurer une vraie session de farm | joueur |

## Suite

| Version | Contenu |
|---|---|
| V2 | ✅ agent 0.2.0 : `watch`, démarrage à l'ouverture de session, icône de zone de notification ; agent 0.3.0 : fenêtre et journal des modifications ; agent 0.4.0 : jeton saisi dans la fenêtre ; agent 0.4.1 : racine `World of Warcraft` par défaut, pour la sortie officielle |
| V3 | ✅ comparaison des métiers (page **Métiers**), activité des 30 derniers jours (page **Activité**) et évolution des niveaux de tous les personnages (page **Niveaux**) ; reste l'historique détaillé |
| V4 | n8n, notifications, rapports |
| V5 | installation et mise à jour automatiques de l'agent |

## Écarts par rapport au cahier des charges

| Écart | Raison |
|---|---|
| Pages à la racine (`/`, `/characters/[id]`…) et non sous `/wow` | application autonome sur son sous-domaine ; le préfixe `/wow` reste disponible par configuration |
| `.NET 10` au lieu de `.NET 8` | seul SDK installé ; exécutable autonome, donc sans effet sur les PC cibles |
| Une table `character_items` au lieu de `character_inventory` + `character_bank` | même structure, un discriminant |
| Un seul rôle PostgreSQL au lieu d'un rôle de migration et d'un rôle applicatif | convention de l'hôte : une base, un rôle par projet |
| Pas de colonnes genre, région ; pas de table quêtes | données absentes d'AltBoard ; les recettes viennent de NaowhForever |
| Pas d'icônes d'objet | AltBoard ne fournit que des identifiants de fichier du jeu |
| Prix lus dans Auctionator, pas Auctioneer | Auctioneer n'est installé sur aucun compte |
