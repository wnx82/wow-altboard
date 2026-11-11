# Architecture

## Vue d'ensemble

```text
┌────────────────────────────── PC Windows (1 à n) ──────────────────────────────┐
│  WTF\Account\<COMPTE>\SavedVariables\AltBoard.lua   (lecture seule)             │
│    + AllemanoLedger.lua, Auctionator.lua, NaowhForever.lua (facultatifs)        │
│                         │                                                       │
│  AltBoardSync.exe  ─ découverte ─ lecture stable ─ parser ─ normalisation       │
└─────────────────────────┬──────────────────────────────────────────────────────┘
                          │  HTTPS, JSON versionné, jeton d'agent
                          ▼
┌───────────────────────── Application web (Next.js) ────────────────────────────┐
│  POST /api/sync : jeton → limites → schéma strict → transaction d'upsert        │
│  Pages : / · /characters/[id] · /accounts · /machines   (session requise)       │
│  Économie : /opportunities · /market · /crafting · /farming · /audit            │
│  GET /api/export/xlsx · GET /api/economy/facts · GET /api/health                │
└─────────────────────────┬──────────────────────────────────────────────────────┘
                          ▼
                PostgreSQL — base dédiée wow_altboard
```

À part de ce flux, le serveur web sonde lui-même les serveurs de jeu pour la page `/servers` :
voir [SERVER-STATUS](SERVER-STATUS.md).

Trois notions sont strictement séparées, du fichier jusqu'à la base : **machine** (un PC),
**compte** (un dossier `WTF\Account`), **personnage** (un GUID).

## Agent (`agent/`)

| Module | Rôle |
|---|---|
| `Lua/SavedVariablesParser` | Lit les littéraux Lua (nil, booléen, nombre, chaîne, table). N'exécute rien ; profondeur bornée ; erreurs localisées (ligne, colonne) |
| `AltBoard/AltBoardReader` | Convertit `AltBoardDB` vers le modèle de synchronisation. Tolérant : champ absent, mal typé ou inconnu = avertissement |
| `AltBoard/LedgerReader` | Temps de jeu et sessions d'Allemano Ledger ([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)) |
| `Economy/AuctionatorReader`, `Lua/CborDecoder` | Prix d'Auctionator, sérialisés en CBOR dans une chaîne Lua ; décodage borné ([AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md)) |
| `Economy/RecipeReader` | Recettes connues par personnage, relevées par NaowhForever ([PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md)) |
| `Discovery/AccountScanner` | Trouve chaque `SavedVariables\AltBoard.lua` ; aucun nombre de comptes codé en dur |
| `IO/StableFileReader` | Ne lit que si taille et date sont stables avant et après ; partage total, jamais d'écriture |
| `Sync/PayloadBuilder`, `SyncClient` | Construit le document v1 et l'envoie ; HTTPS obligatoire hors localhost |
| `Config/*` | `machine_uuid` persistant, jeton chiffré par DPAPI |
| `App/AgentApp` | Ligne de commande ; entièrement testable (sorties, HTTP et horloge injectés) |

L'agent n'interprète pas les données : il transmet ce qu'AltBoard a écrit, borné aux mêmes limites
que le schéma du serveur. Toute décision métier (fraîcheur, historique) est prise côté serveur.

## Application web (`web/`)

| Dossier | Rôle |
|---|---|
| `src/db` | Schéma Drizzle (source unique), migrations SQL générées, garde-fou de cible |
| `src/lib/sync` | Schéma Zod du document, traitement transactionnel, gestionnaire HTTP |
| `src/lib/dashboard` | Lectures en nombre fixe de requêtes, historique, export, suppression d'un compte, actions serveur ; calculs purs testés sans base : bloc « À surveiller », or cumulé, temps de jeu, réputations comparées |
| `src/lib/goals` | Objectifs par personnage : évaluation, modèles, tableau d'un modèle par personnage |
| `src/lib/auth` | Mots de passe scrypt, sessions en base, cookie, mot de passe redemandé avant une suppression définitive |
| `src/lib/xlsx` | Écriture XLSX sans dépendance |
| `src/lib/status` | État des serveurs de jeu : sonde TCP, moniteur périodique, historique ([SERVER-STATUS](SERVER-STATUS.md)) |
| `src/lib/settings` | Page **Paramètres** : réglages en base, validation des saisies, réinitialisation des personnages |
| `src/lib/economy` | Import des prix et des recettes, moteur économique déterministe (prix, craft, farm, opportunités), faits structurés, assistant facultatif ([ECONOMY-ENGINE](ECONOMY-ENGINE.md)) |
| `src/lib/wow` | Libellés et formats du jeu ; icônes (`icons.ts`) et illustrations de WoW Forever (`art.ts`) lues sur les CDN de Blizzard par l'optimiseur d'images, jamais copiées dans le dépôt |
| `src/app` | Pages et routes, manifeste du site installable (`app.webmanifest`) ; `src/proxy.ts` pose la CSP et filtre les requêtes sans session |
| `public/sw.js` | Service worker du site installable : rien en cache, page « Hors ligne » sans réseau. Inscrit, avec le bandeau qui propose l'installation sur téléphone, par `src/components/app-install.tsx` |
| `scripts` | Outils lancés à la main, dont `generate-icons.ts` qui redessine les icônes du site installable |
| `src/instrumentation.ts` | Lance le moniteur d'état au démarrage du serveur |

## Décisions

| Décision | Raison |
|---|---|
| Application **autonome**, sur `wow.ekreativ.be` | Aucun couplage au site commercial `ekreativ.be` (cycle de version, proxy, CSP, 54 tables). Pas de migration ultérieure |
| **Base dédiée** `wow_altboard`, rôle applicatif dédié | Isolation, sauvegarde et restauration indépendantes |
| Variables d'environnement préfixées `WOW_` + refus des bases étrangères | Un `TEST_DATABASE_URL` générique d'un autre projet a fait viser la mauvaise base pendant le développement |
| **Drizzle** plutôt que Prisma | Upserts conditionnels et `ON CONFLICT` écrits tels quels ; migrations SQL lisibles |
| Personnage identifié par **GUID** | Le nom n'est pas unique sur ce client ; le GUID l'est |
| Compte identifié par une **empreinte** du nom de dossier | Stable entre PC et entre versions d'agent ; le nom complet, envoyé depuis l'agent 0.6.0, n'est qu'affiché, après vérification contre l'empreinte |
| Fraîcheur décidée par `lastSeen`, bloc par bloc | Deux PC peuvent détenir des fichiers d'âges différents |
| Snapshots dédupliqués par hash de **progression** | Une simple connexion ne crée pas d'historique |
| Agent en `.NET 10` autonome | Aucun runtime à installer sur les PC ; seul le SDK 10 est présent sur le poste de développement |
| Authentification du tableau de bord **maison** | Un seul utilisateur ; moins de dépendances qu'une bibliothèque en version bêta |
| Aucune image ni icône du jeu | Pas d'actif Blizzard ; les icônes d'AltBoard sont des identifiants de fichier inutilisables hors du jeu |
| XLSX écrit sans bibliothèque | La seule bibliothèque courante embarque une dépendance signalée ; elle ne sert qu'aux tests, pour relire |
| État des serveurs par **sonde TCP du serveur web**, adresses en configuration ou réglées sur le site | Aucune API documentée pour WoW Forever ; un navigateur ne peut pas ouvrir de connexion TCP ; pas de dépendance à un site tiers ni de nouveau service à déployer |
| Moniteur lancé par `instrumentation.ts`, état lu en base | Un seul processus web : pas d'ordonnanceur externe. La page ne dépend pas de la mémoire du moniteur |
| Prix lus dans **Auctionator**, pas Auctioneer | Auctioneer, prévu par la roadmap de l'économie, n'est installé sur aucun compte ; Auctionator l'est et garde un relevé par jour |
| Moteur économique **déterministe**, en fonctions pures | Mêmes relevés, mêmes résultats ; testable sans base. Aucune valeur inventée : une donnée absente donne « attendre » |
| Calcul d'opportunités conservé et réutilisé tant que sa base ne change pas | Chaque opportunité garde ses entrées : on peut toujours dire d'où vient un chiffre |
| Assistant IA **facultatif**, qui explique et ne calcule pas | Il ne reçoit que les faits du moteur ; une réponse qui cite un nombre absent des faits est refusée |

## Ce qui est prévu mais non activé

- Synchronisation automatique (`watch`), service Windows : conçus dans [AGENT](AGENT.md), absents de la V1.
- n8n, notifications, API Battle.net : hors périmètre ; rien dans le pipeline n'en dépend.
- Plusieurs instances web : la limitation de débit est en mémoire (voir [SECURITY](SECURITY.md)),
  et chaque instance lancerait son propre moniteur d'état.
- Adresses des serveurs de jeu européens : inconnues, faute de source vérifiable ; celles de la
  bêta sont surveillées à leur place (voir [SERVER-STATUS](SERVER-STATUS.md)).
