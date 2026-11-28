# API

Trois versions évoluent séparément :

| Version | Où | Valeur actuelle |
|---|---|---|
| `agentVersion` | version de l'exécutable (`agent/Directory.Build.props`) | `0.5.1` |
| `schemaVersion` | format du document envoyé par l'agent | `1` |
| schéma AltBoard | `AltBoardDB.schema`, transmis dans `addonSchema` | `2` |

Le serveur refuse tout `schemaVersion` qu'il ne connaît pas. Une évolution incompatible du document
passe par une nouvelle valeur, les anciennes restant acceptées le temps de mettre les agents à jour.

## `POST /api/sync`

Reçoit l'état AltBoard d'une machine.

| En-tête | Valeur |
|---|---|
| `Authorization` | `Bearer wab_…` (jeton d'agent) |
| `Content-Type` | `application/json` |

### Document (version 1)

```json
{
  "schemaVersion": 1,
  "agentVersion": "0.1.0",
  "generatedAt": "2026-10-04T13:10:05.78+00:00",
  "machine": { "uuid": "00000000-0000-4000-8000-000000000001", "hostname": "PC-GAMING", "displayName": "PC du salon" },
  "accounts": [
    {
      "accountKey": "<SHA-256 du nom de dossier, 64 hexadécimaux>",
      "folderHint": "12…#1",
      "folderName": "123456789#1",
      "flavor": "_classic_beta_",
      "addonSchema": 2,
      "addonVersion": "0.8.3",
      "file": { "hash": "<SHA-256 du fichier>", "modifiedAt": "2026-10-04T13:10:03.26+00:00", "size": 90253 },
      "warnings": [],
      "notices": ["Baganator : 1 personnage absent d'AltBoard sur ce compte (Nom) : son courrier et ses enchères ne sont pas transmis."],
      "items": [{ "key": "36", "itemId": 36, "name": "Vieille masse", "quality": 1, "icon": 133478, "link": "|cnIQ1:|Hitem:36:…" }],
      "characters": [
        {
          "guid": "Player-9999-00000001",
          "name": "Élodie Brisefer",
          "realm": "ClassicBetaPvE2",
          "lastSeen": 1791118113,
          "class": "MAGE", "race": "Éolide de l’Ordre suprême", "faction": "Alliance",
          "level": 25, "xp": 29426, "xpMax": 34000, "moneyCopper": 80964, "itemLevel": 16.25,
          "guild": "Les Sans-Souci", "zone": "Taverne du Corbeau écarlate", "hidden": false,
          "stats": { "strength": 24, "intellect": 116, "crit": 0.896 },
          "statsAt": 1791116901,
          "gear": [{ "slot": 5, "itemId": 2969, "enchantId": 24, "name": "Gilet de lieur de sort", "quality": 2, "itemLevel": 17 }],
          "professions": [{ "skillLine": 197, "name": "Couture", "rank": 88, "max": 150, "primary": true }],
          "reputations": [{ "factionId": 47, "name": "Ironforge", "group": "Alliance", "reaction": 5, "current": 4715, "min": 3000, "max": 9000 }],
          "currencies": [{ "name": "Faveur marchande", "quantity": 60, "max": 0 }],
          "bags": { "at": 1791117999, "slotsUsed": 57, "slotsTotal": 58, "items": [{ "key": "1114", "count": 7 }] },
          "bank": { "at": 1791111262, "slotsUsed": 52, "slotsTotal": 54, "items": [] },
          "playtime": {
            "totalSeconds": 171000, "measuredAt": 1791118113,
            "current": { "level": 25, "startTotalSeconds": 162400, "startedAt": 1791031713 },
            "levels": [{ "level": 24, "playedSeconds": 18300, "wallSeconds": 58320, "reachedAt": 1791031713, "zone": "Les Paluns" }]
          },
          "sessions": [
            { "startedAt": 1791090000, "stoppedAt": 1791097200, "durationSeconds": 6900, "xpGained": 8200, "levels": 1, "zone": "Loch Modan", "tag": "Leveling", "inProgress": false },
            { "startedAt": 1791110000, "stoppedAt": 1791118570, "durationSeconds": 4770, "xpGained": 5300, "levels": 1, "zone": "Loch Modan", "tag": "Leveling", "inProgress": true }
          ]
        }
      ]
    }
  ]
}
```

Règles :

- les objets sont **stricts** : un champ inconnu fait refuser le document ;
- un champ sans valeur est **omis**, jamais envoyé à `null` ;
- les horodatages issus d'AltBoard (`lastSeen`, `statsAt`, `bags.at`, `bank.at`) restent des
  secondes Unix, telles qu'écrites par l'addon ;
- `realm` peut être vide (agent 0.11.1) : depuis le build 71037 de WoW Forever, le jeu ne donne plus
  le royaume. Le serveur reprend celui du personnage déjà connu par son GUID, sinon celui des
  personnages du même serveur (`Player-<serveur>-…`), dans le document puis en base. Un personnage
  dont le royaume reste introuvable est écarté avec un avertissement (synchronisation `partial`) ;
  aucun royaume vide n'est enregistré ;
- `bank` et `bags` sont absents tant que l'addon ne les a jamais datés ;
- `playtime` est absent sans l'addon Allemano Ledger ([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)).
  `levels[].level` est le niveau quitté ; `playedSeconds` est omis quand plusieurs niveaux ont été
  gagnés d'un coup. Au plus 200 niveaux par personnage ;
- `sessions` est absent quand Allemano Ledger n'en a enregistré aucune. `startedAt` identifie la
  session ; `durationSeconds` est le temps connecté, pauses exclues ; `inProgress` signale une
  session encore ouverte, aux valeurs provisoires. Au plus 60 sessions par personnage ;
- `runs` (agent 0.11.0) : donjons et autres runs d'instance d'Allemano Ledger, absents sans run.
  `startedAt` identifie le run (unique) ; facultatifs : `stoppedAt`, `durationSeconds`, `zone`
  (80 caractères), `tag` (40), `xpGained`, `levels`, `moneyCopper` et `netCopper` (or gagné moins
  or dépensé, négatifs quand le run a coûté), `lootValueCopper`. Un run recoupe la session qui le
  contient : il n'est pas compté parmi les sessions. Au plus 60 runs par personnage ;
- `finances` (agent 0.7.0) : journées d'Allemano Ledger, absentes sans l'addon. Une entrée par
  jour (`day`, date locale du client de jeu, `AAAA-MM-JJ`, unique) : `income` et `expense`, montants
  par source en pièces de cuivre (sources `loot`, `vendor`, `quest`, `ah`, `mail`, `trade`, `other`
  pour les revenus ; `repair`, `vendor`, `training`, `travel`, `ah`, `mail`, `trade`, `other` pour
  les dépenses ; une source absente vaut 0, une source inconnue fait refuser le document),
  `transferIn` et `transferOut` (or échangé avec ses propres personnages), et, s'ils sont connus,
  `lootValue` (prix de vente au marchand des objets ramassés), `gold` (or à la dernière note du
  jour), `playedSeconds` (temps connecté). Au plus 800 jours :

  ```json
  "finances": [{ "day": "2026-11-08", "income": { "quest": 1735, "vendor": 2786 }, "expense": { "training": 650 },
                 "transferIn": 0, "transferOut": 0, "lootValue": 134, "gold": 8039, "playedSeconds": 6079 }]
  ```
- `folderName` (agent 0.6.0) : nom complet du dossier `WTF\Account`, affiché sur la page Comptes.
  ASCII imprimable sans espace, 64 caractères au plus ; l'agent l'omet sinon. Le serveur recalcule
  l'empreinte à partir de ce nom (`SHA-256("wow-altboard-account:" + NOM EN MAJUSCULES)`) et refuse
  le document (`422`) si elle diffère d'`accountKey`. Un envoi sans `folderName` n'efface pas le nom
  déjà reçu.
- `addonErrors` (agent 0.11.0), par compte : erreurs Lua gardées par l'addon AltBoard
  (`AltBoardDB.errors`), dix au plus, `{ "at": <secondes Unix>, "where": "…", "message": "…", "version": "0.8.3" }`.
  `where` au-delà de 80 caractères et `message` au-delà de 400 sont raccourcis par le serveur. La
  liste reçue remplace celle du même PC, montrée sur la page **Comptes** ; une liste vide l'efface,
  un envoi sans liste n'y touche pas.

Compatibilité : `playtime`, `sessions`, `folderName`, `finances` et `itemNames` sont des ajouts facultatifs à la version 1. Les objets étant
stricts, un serveur antérieur refuserait un document qui les contient : **le serveur se met à jour avant les
agents**. Un agent antérieur reste accepté par le nouveau serveur.

### Noms des objets du cache du jeu (facultatif)

Champ `itemNames` du document, ajouté par l'agent 0.7.0 quand le cache local d'un client a changé
depuis le dernier envoi accepté ([ECONOMY-ENGINE](ECONOMY-ENGINE.md#noms-des-objets-item-namests)) :

```json
"itemNames": [{ "flavor": "_forever_", "locale": "frFR", "build": 70862,
                "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-09T10:12:00+00:00", "size": 6822109 },
                "names": [{ "id": 38, "name": "Chemise de recrue" }] }]
```

Un client par entrée, 10 au plus ; 100 000 noms au plus par entrée, 200 caractères au plus par nom.
Seule la langue du site (`frFR`) est enregistrée ; la réponse ajoute `itemNamesStored`, le nombre
de noms ajoutés ou modifiés.

### Prix et recettes (facultatifs)

Deux blocs facultatifs par compte, ajoutés par l'agent 0.5.0 quand les fichiers existent :

```json
"auctionator": {
  "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-06T16:19:26.53+00:00", "size": 1843211 },
  "dbVersion": 8,
  "markets": [
    { "key": "PvE", "contentHash": "<SHA-256 du contenu normalisé>",
      "items": [{ "key": "2576", "lastMin": 100, "days": [[2500, 200, 1000, 34], [2501, 100, 100, 13]] }] }
  ],
  "vendorPrices": [{ "key": "159", "price": 5 }]
},
"recipes": {
  "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-06T16:21:53.09+00:00", "size": 5202 },
  "characters": [
    { "guid": "Player-9999-00000001",
      "recipes": [{ "spellId": 2963, "skillLine": 197, "outputItemId": 2996, "outputQuantity": 1, "cooldown": false,
                    "reagents": [{ "itemId": 2589, "quantity": 2 }] }] }
  ]
}
```

- `days` : `[jour Auctionator, plus bas, plus haut, quantité ou null]`, prix en pièces de cuivre ;
  plus bas ≤ plus haut, sinon le document est refusé. Formats et bornes :
  [AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md), [PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md).
- Un relevé déjà reçu (même marché, compte et `contentHash`) n'est pas réimporté ; la réponse
  ajoute `marketsImported`, `marketsUnchanged`, `marketObservations` et `recipeCharacters`.
- Compatibilité : comme `playtime`, ces blocs exigent un serveur à jour avant les agents.

### Courrier, enchères et banques de guilde (facultatif)

Bloc facultatif par compte, ajouté par l'agent 0.8.0 quand `Syndicator.lua` (addon Baganator)
existe :

```json
"baganator": {
  "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-12T11:06:00.55+00:00", "size": 4212 },
  "characters": [
    { "guid": "Player-9999-00000001",
      "mail": [{ "key": "249428", "count": 5, "expiresAt": 1796500000 }],
      "auctions": [{ "key": "20576", "count": 1, "expiresAt": 1794091265 }] }
  ],
  "guilds": [
    { "name": "Ordre Fictif", "realm": "ClassicBetaPvE2", "moneyCopper": 4699,
      "tabs": [{ "index": 1, "name": "Composants", "items": [{ "key": "2318", "count": 25 }] }] }
  ]
}
```

- `expiresAt` : secondes Unix, facultatif. 2000 lignes au plus par liste, 50 guildes, 16 onglets
  (`index` de 1 à 16), 500 objets par onglet. Format et rattachement des personnages :
  [BAGANATOR-DATA-MODEL](BAGANATOR-DATA-MODEL.md).
- Un GUID inconnu du serveur est ignoré. Une banque de guilde n'est gardée que si son royaume est
  celui d'un personnage du compte. Un fichier plus ancien que le relevé gardé, ou de même contenu,
  ne change rien.
- Compatibilité : un serveur antérieur au site 0.18.0 refuse ce bloc (schéma strict).

### Scans EZAuctioneer (facultatif)

Bloc facultatif par compte, ajouté par l'agent 0.10.0 quand `EZAuctioneer.lua` existe et contient
au moins un relevé :

```json
"ezAuctioneer": {
  "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-19T09:06:12.4+00:00", "size": 5302114 },
  "schema": 5,
  "markets": [
    { "key": "3:Royaume Test PvE:Alliance:faction", "contentHash": "<SHA-256 des scans et des relevés>",
      "scans": [{ "at": 1795079141, "auctions": 174284, "items": 6744, "origin": "own" }],
      "items": [{ "key": "i:2589", "samples": [[1795009157, 12, 840], [1795079141, 15, 610]] }] }
  ]
}
```

- `samples` : `[heure, prix, unités]`, heure en secondes Unix, prix (25e percentile) en pièces de
  cuivre, au moins 1. `key` d'un marché : `<région>:<royaume>:<faction>:faction` ou
  `<région>:<royaume>:neutral` ; d'un objet : `i:<objet>`, avec suffixe facultatif. Une autre forme
  fait refuser le document (422 `invalid_payload`). Royaume vide (`3::Alliance:faction`, agent
  0.11.1, jeu au build 71037) : le serveur le remplace, dans `markets`, `deals` et les `market` des
  annonces, par le royaume des personnages du compte joués sans royaume, écrit comme dans les marchés
  déjà connus ; plusieurs royaumes possibles : marché écarté avec un avertissement. 20 marchés au plus, 50 scans par marché,
  20 000 objets par marché, 1 à 50 relevés par objet. Format et sens des champs :
  [EZAUCTIONEER-DATA-MODEL](EZAUCTIONEER-DATA-MODEL.md).
- Un contenu déjà reçu (même marché, compte et `contentHash`) n'est pas réimporté ; un relevé déjà
  connu (même marché, objet et heure) n'est pas doublé. La réponse ajoute `scanMarketsImported`,
  `scanMarketsUnchanged` et `scanSamples` (relevés nouveaux).
- Compatibilité : un serveur antérieur au site 0.31.0 refuse ce bloc (schéma strict).

Depuis l'agent 0.11.0, le bloc porte aussi le **portefeuille de revente** et les **affaires**
repérées en jeu ([RESALE](RESALE.md)), tous deux facultatifs :

```json
"portfolios": [
  { "key": "3:Royaume Test PvE:Élodie Brisefer",
    "stats": { "realized": -2231, "sales": 0, "cuts": 0, "expired": 1, "depositsLost": 2231, "unknown": 0 },
    "positions": [{ "key": "i:5266", "qty": 1, "cost": 16800, "listed": 1, "openedAt": 1795079000 }],
    "auctions": [{ "id": 2004001, "key": "i:5266", "qty": 1, "unit": 60000, "deposit": 2231, "cut": 0.05,
                   "market": "3:Royaume Test PvE:Alliance:faction", "postedAt": 1795079100 }],
    "log": [{ "at": 1795079000, "kind": "buy", "key": "i:5266", "qty": 1, "amount": 16800, "source": "achat" }] }
],
"deals": [
  { "market": "3:Royaume Test PvE:Alliance:faction", "at": 1795079141,
    "entries": [{ "key": "i:7094", "kind": "resale", "source": "scan", "qty": 3, "cost": 11000, "resale": 45000,
                  "profit": 112081, "roi": 2.4, "listings": 10, "thin": false, "live": "live" }] }
]
```

- `portfolios` : 200 au plus, clé `<région>:<royaume>:<personnage>` unique (royaume vide permis,
  aucun deux-points dans le royaume ni le nom). `positions` (clé unique) et `auctions` (`id`
  unique) : 500 au plus ; `log` : 300 au plus, `kind` parmi `buy`, `post`, `sale`, `pending`,
  `expire`, `cancel`, `unknown`, `remove`. Montants en pièces de cuivre ; `realized`, `gain`
  et `profit` peuvent être négatifs. Les clés d'objets suivent la forme des scans.
- `deals` : 20 marchés au plus (clé unique), 150 affaires chacun, dans l'ordre de l'addon. `kind` :
  `resale` ou `vendor` ; `live` : `live`, `gone` ou `checking`.
- Les portefeuilles sont rangés par compte et par PC (le fichier de l'addon est propre à chaque PC).
  Le serveur remplace bilan, positions et annonces de chaque portefeuille, ajoute les entrées
  nouvelles du journal et remet à zéro un portefeuille de ce compte et de ce PC absent de l'envoi ;
  l'agent 0.11.0 envoie toujours la liste, vide au besoin. Un bloc sans `portfolios` (agent plus
  ancien) n'y touche pas. La réponse ajoute `resalePortfolios`,
  `resaleEvents` (entrées nouvelles) et `resaleDeals`.
- Compatibilité : un serveur antérieur au site 0.37.0 refuse ces champs, comme `runs` et
  `addonErrors` (schéma strict).

### Prix NaowhForever (facultatif)

Bloc facultatif par compte, ajouté par l'agent 0.12.0 quand `NaowhForever.lua` contient des prix de
l'hôtel des ventes (`ahPrices`) ou leur historique (`marketHistory`) :

```json
"naowhMarket": {
  "file": { "hash": "<SHA-256>", "modifiedAt": "2026-11-28T09:00:00+00:00", "size": 4310227 },
  "houses": [
    { "key": "Royaume Test PvE-Alliance", "contentHash": "<SHA-256 des heures, prix et jours>",
      "scannedAt": 1795817357, "medianAt": 1795817357, "recordedAt": 1795839703,
      "items": [[2589, 15, 17, 610, 1795852696], [4306, 24000, null, 3, null]],
      "days": [{ "day": "2026-11-27", "items": [[2589, 16, 598], [4306, 23500, null]] }] }
  ]
}
```

- `key` : `<royaume>-<camp>`, camp `Alliance`, `Horde` ou `Blackwater` ; royaume de 1 à 80
  caractères, numéro du serveur quand le jeu n'en donnait pas. `items` : `[objet, plus bas, médiane,
  annonces, revu à]`, triés par objet, sans double, au moins un des deux prix ; `days` : `[objet,
  médiane, annonces]`, jours `AAAA-MM-JJ` triés. Prix à l'unité en pièces de cuivre, au moins 1 ;
  heures en secondes Unix. 20 maisons au plus (clé unique), 30 000 objets par maison et par jour,
  31 jours. Une autre forme fait refuser le document (422 `invalid_payload`). Format et sens des
  champs : [NAOWH-MARKET-DATA-MODEL](NAOWH-MARKET-DATA-MODEL.md).
- Un contenu déjà reçu (même maison, compte et `contentHash`) n'est pas réimporté. Chaque prix n'est
  remplacé que par un relevé au moins aussi récent, chaque jour que par un historique écrit plus tard.
  La réponse ajoute `naowhHousesImported`, `naowhHousesUnchanged`, `naowhPrices` et `naowhDays`
  (lignes ajoutées ou modifiées).

Champ `naowhFeeds` du document : le flux de prix livré avec l'addon (`NaowhForever_AuctionData`), un
par client, pour la région que désignent les scans Naowh des comptes du client :

```json
"naowhFeeds": [
  { "flavor": "_forever_", "file": { "hash": "<SHA-256>", "modifiedAt": "…", "size": 1953311 },
    "time": 1795839703, "region": 3,
    "houses": [{ "id": 114, "faction": "Horde", "items": [[2589, 14, 16, 402], [4306, 22000, null, null]] }] }
]
```

- `time` : heure des données de Blizzard. `houses` : 50 au plus, identifiant unique, camp
  `Alliance`, `Horde` ou `Blackwater` ; `items` : `[objet, plus bas, médiane, annonces]`, 1 à 30 000,
  triés par objet. 10 clients au plus, sans double.
- Une maison n'est remplacée, en bloc, que par des données de Blizzard plus récentes. La réponse
  ajoute `naowhFeedHousesImported` et `naowhFeedHousesUnchanged`.
- Une heure de ces deux blocs (`scannedAt`, `medianAt`, `recordedAt`, revu à, jour, `time`) plus
  d'une heure après l'heure du serveur fait refuser le document (422 `future_timestamp`).
- Compatibilité : un serveur antérieur au site 0.38.0 refuse ces champs (schéma strict).

Le schéma complet, avec ses bornes, est `web/src/lib/sync/schema.ts` ; son miroir côté agent est
`agent/src/AltBoardSync.Core/Sync/SyncPayload.cs`. Le fichier
`tests/fixtures/payloads/two-accounts.json`, produit par l'agent réel, sert de contrat aux tests de l'API ;
`tests/fixtures/payloads/economy-account.json` fait de même pour les prix et les recettes, et
`tests/fixtures/payloads/baganator-account.json` pour le courrier, les enchères et les banques de guilde,
`tests/fixtures/payloads/ezauctioneer-account.json` pour les scans EZAuctioneer et
`tests/fixtures/payloads/naowh-account.json` pour les prix NaowhForever.

### Réponse `200`

```json
{
  "runId": 42,
  "status": "success",
  "accountsReceived": 2,
  "charactersReceived": 6,
  "charactersCreated": 0,
  "charactersUpdated": 1,
  "charactersUnchanged": 5,
  "charactersStale": 0,
  "snapshotsCreated": 1,
  "errors": [],
  "latestAgentVersion": "0.9.0",
  "latestAgentSha256": "<SHA-256 de l'exécutable servi, 64 hexadécimaux>",
  "requestId": "c6ed9755-d086-4437-a6f1-66dcc97bfe0c"
}
```

`status` vaut `partial` quand l'agent a signalé des avertissements (`warnings` d'un compte) : ils
sont conservés dans `sync_errors` (code `agent_warning`), comptés dans `errors_count` et affichés
sous la ligne du journal de la page **Machines**. Les données sont enregistrées de la même façon.

`notices` (facultatif, agent 0.9.0 et suivants, mêmes limites que `warnings`) : informations sans
gravité, gardées dans `sync_errors` avec le code `agent_notice` et affichées en gris sur la page
**Machines**. Elles ne comptent pas dans `errors_count` et ne rendent pas la synchronisation
partielle. L'avertissement « Baganator : N personnages absents d'AltBoard » d'un agent 0.8.x est
rangé de même.

Au-delà de 50 avertissements pour un compte, le serveur garde les 49 premiers et les remplace par un
dernier, « N autres avertissements non transmis » ; un avertissement de plus de 400 caractères, ou
un `displayName` de plus de 120, est raccourci et finit par « … ». Ces textes ne font donc plus
refuser le document. L'agent 0.8.1 applique les mêmes limites avant l'envoi.

`latestAgentVersion` : version de l'agent livrée avec le site (`agent/Directory.Build.props` lu à la
construction). Elle accompagne toutes les réponses faites à un jeton valide, refus compris ; elle
est absente si le jeton est refusé ou si la construction ne la connaissait pas. L'agent 0.8.1 la
retient et annonce une version plus récente que la sienne une fois.

`latestAgentSha256` (site 0.29.0) : SHA-256 de l'exécutable servi par `GET /api/sync/agent`, avec
`latestAgentVersion`, à un agent authentifié seulement. L'agent 0.9.0 ne s'installe une nouvelle
version que si le fichier téléchargé a cette empreinte. Absent si l'image ne contient pas d'agent ;
une erreur de lecture du fichier est journalisée (`agent.digest_failed`) sans gêner la
synchronisation.

`charactersStale` : personnages dont ce PC détient un fichier plus ancien que l'état déjà connu,
et personnages inconnus du serveur, non vus en jeu depuis la date limite de la dernière
réinitialisation (voir [DATABASE § Réinitialisation des personnages](DATABASE.md)) : ils ne sont
pas recréés.

### Refus

| Code HTTP | `code` | Cause |
|---|---|---|
| 400 | `invalid_json` | corps illisible |
| 401 | `unauthorized` | jeton absent, mal formé, inconnu ou révoqué |
| 403 | `token_machine_mismatch` | jeton déjà lié à une autre machine |
| 413 | `payload_too_large` | corps de plus de 24 Mio |
| 415 | `unsupported_media_type` | corps non JSON |
| 422 | `unsupported_schema_version` | `schemaVersion` inconnu (`supported` liste les versions acceptées) |
| 422 | `invalid_payload` | schéma non respecté (`issues` : chemins et codes, jamais les valeurs) |
| 422 | `future_timestamp` | un horodatage d'un personnage (`lastSeen`, `statsAt`, sacs, banque, temps de jeu, sessions), d'un scan EZAuctioneer ou d'un prix NaowhForever dépasse de plus d'une heure l'heure du serveur : horloge du PC en avance (`issues` : chemins, vingt au plus) |
| 429 | `rate_limited` | plus de 60 requêtes en 5 minutes, ou 10 échecs d'authentification en 15 minutes |
| 500 | `internal_error` | erreur de traitement : la synchronisation entière est annulée ; `sync_errors` et le journal n'en gardent que le type et le code PostgreSQL ou réseau |
| 503 | `service_unavailable` | base injoignable : réessayer plus tard |
| 503 | `sync_busy` | quatre envois attendent déjà leur tour, une attente de plus de 20 secondes, ou le verrou de synchronisation tenu plus de 8 secondes par une autre écriture (réinitialisation, suppression d'un compte) : rien n'est écrit |
| 503 | `timeout` | une requête du traitement a dépassé 12 secondes : la synchronisation entière est annulée et notée en échec dans `sync_runs` |

Toutes les réponses portent `requestId`, `X-Request-ID` et `Cache-Control: no-store`.
Une synchronisation est **tout ou rien** et **idempotente** : la renvoyer ne change rien.

Les refus `429` et `503` portent `Retry-After`, en secondes : 300 pour `rate_limited`, 60 pour
`service_unavailable`, 30 pour `sync_busy`, 120 pour `timeout`. L'agent 0.8.1 n'essaie pas avant ce
délai.

**File d'attente.** Le serveur traite un envoi à la fois. Un envoi dont le jeton est valide attend son
tour en mémoire avant que son corps soit lu : quatre au plus, 20 secondes au plus chacun. Les
écritures qui prennent le même verrou (synchronisation, réinitialisation des personnages,
suppression d'un compte) l'attendent 8 secondes au plus. Au-delà, la synchronisation reçoit
`sync_busy` ; la réinitialisation ou la suppression affiche « Une synchronisation est en cours :
réessayez dans quelques secondes. » Voir [DATABASE § Délais](DATABASE.md).

## `GET /api/sync/agent`

Mise à jour automatique de l'agent (site 0.29.0, agent 0.9.0). Jeton d'agent (`Authorization:
Bearer wab_…`), pas de session : la route est sous `/api/sync`, que Cloudflare Access laisse passer.

| Code HTTP | `code` | Cause |
|---|---|---|
| 200 | — | `application/octet-stream` : l'exécutable, avec `X-Agent-Version`, `X-Agent-Sha256` et `Cache-Control: no-store` |
| 401 | `unauthorized` | jeton absent, mal formé, inconnu ou révoqué ; compte comme un échec d'authentification de `/api/sync` |
| 404 | `agent_unavailable` | image sans agent, ou sans version connue |
| 429 | `rate_limited` | plus de 12 téléchargements en 15 minutes, ou 10 échecs d'authentification en 15 minutes (partagés avec `/api/sync`) |
| 503 | `service_unavailable` | base injoignable pour vérifier le jeton |

Le jeton n'est pas lié à la machine ici : un téléchargement n'écrit rien. Chaque téléchargement est
journalisé (`agent.update_download`, avec la version et l'identifiant du jeton).

## `GET /api/export/xlsx`

Session du tableau de bord requise (401 sinon). Renvoie `AltBoard-export-AAAA-MM-JJ.xlsx` :
feuilles Résumé, Personnages, Métiers, Équipement, Monnaies, Réputations, Objectifs, Comptes,
Machines. Le classeur est une photographie : la base reste la source.

## `GET /api/export/inventory` et `GET /api/export/finances`

La vue affichée d'une page, en Excel : lien « Exporter » de la page. Session requise (401 sinon),
vérifiée par la route elle-même.

| Route | Paramètres | Fichier |
|---|---|---|
| `/api/export/inventory` | ceux de l'adresse de la page **Inventaires** (`q`, `perso`, `lieux`, filtres, `tri`…), mêmes valeurs par défaut | `AltBoard-inventaires-AAAA-MM-JJ.xlsx` : Résumé (filtres appliqués), Objets (une ligne par objet, dans l'ordre de la page), Détail (une ligne par personnage et par endroit) |
| `/api/export/finances` | `period` : `7`, `30` (par défaut), `90` ou `all` | `AltBoard-finances-AAAA-MM-JJ.xlsx` : Bilan, Par jour (Par mois pour « Tout »), Par personnage, Journées ; revenus et dépenses par source |

## `GET /api/agent/zip` et `GET /api/agent`

Session du tableau de bord requise (401 sinon). L'agent publié dans l'image à sa construction
([DEPLOYMENT § Agent offert au téléchargement](DEPLOYMENT.md#agent-offert-au-téléchargement)), en
pièce jointe, `Cache-Control: private, no-store`. 404 quand l'image n'en contient pas.

| Route | Fichier |
|---|---|
| `/api/agent/zip` | `AltBoardSync.zip` : l'exécutable et `LISEZMOI.txt` (installation, empreinte SHA-256 de l'exécutable), environ 40 % plus léger. Construite au premier appel, puis gardée en mémoire |
| `/api/agent` | `AltBoardSync.exe` seul |

## `GET /api/economy/facts`

Faits structurés du moteur économique, en JSON, pour une explication par IA
([ECONOMY-ENGINE § Faits et assistant](ECONOMY-ENGINE.md)). Session du tableau de bord requise
(`401` sinon) ; `?market=<id>` choisit l'hôtel des ventes ; `404` tant qu'aucun prix n'a été reçu.
Réponse `Cache-Control: private, no-store`. Le calcul d'opportunités qu'il cite est conservé, ou
réutilisé si sa base n'a pas changé.

## `GET /api/search`

Recherche globale du tableau de bord (Ctrl+K). Session requise (`401` sinon), vérifiée par la
route elle-même. `?q=` : 2 caractères au moins ou un identifiant d'objet, 60 au plus ; accents et
majuscules ignorés. Réponse `Cache-Control: private, no-store` :

```json
{"characters":[{"id":6,"name":"…","realm":"…","class":"PALADIN","level":6}],
 "items":[{"itemKey":"2589","name":"Étoffe de lin","quality":1,"icon":"inv_fabric_linen_01","owned":550,"href":"/inventory?q=…"}],
 "recipes":[{"spellId":3275,"itemKey":"1251","name":"Bandage en lin","quality":1,"icon":"…","profession":"Secourisme",
   "crafters":[{"id":1,"name":"…","class":"MAGE"}],"crafterCount":1,"href":"/market/1251"}],
 "factions":[{"factionId":1090,"name":"Kirin Tor","characters":1,"best":5,"href":"/reputations?faction=Kirin%20Tor"}]}
```

6 personnages, 8 objets, 5 recettes et 4 factions au plus, rangés par pertinence (le nom commence par le texte, puis l'un
de ses mots, puis ailleurs). Les objets possédés passent d'abord et mènent à la page Inventaires ;
les autres ne sont proposés que si l'hôtel des ventes les a déjà vus, et mènent à leur fiche de
marché. Une recette est cherchée par le nom de l'objet fabriqué, parmi celles qu'au moins un
personnage connaît ; elle nomme 4 fabricants au plus, du plus haut niveau au plus bas, et mène à
la fiche de marché de l'objet. Une faction (connue d'au moins un personnage, `best` : palier le plus avancé) mène à la
page **Réputations** filtrée. Un identifiant numérique ne cherche ni recette ni faction. Les pages
du menu sont cherchées par le navigateur, sans appel.

## `GET /api/items/tooltip`

Caractéristiques d'un objet pour sa bulle (dégâts, vitesse, armure, caractéristiques, effets,
ensemble, durabilité, prix de vente), à la manière de Wowhead. Session requise (`401` sinon),
vérifiée par la route elle-même ; 600 demandes par minute et par utilisateur (`429` au-delà).
`?key=` : clé d'objet de l'inventaire, `1234` ou `1234:567` (suffixe aléatoire) ; `400` sinon.

```json
{"status":"ok","lines":[{"type":"text","segments":[{"text":"Niveau d'objet 80","tone":"gold"}]},
 {"type":"pair","left":[{"text":"À une main"}],"right":[{"text":"Épée","tone":"q1"}]},
 {"type":"money","copper":255355}]}
```

`status` : `ok`, `missing` (Wowhead ne connaît pas l'objet, `lines` vide) ou `unavailable`
(Wowhead injoignable et rien en cache). `ok` et `missing` portent `Cache-Control: private,
max-age=3600`, `unavailable` `private, no-store`. Les lignes viennent de la table `item_tooltips`,
remplie à la première demande ([DATABASE](DATABASE.md), [SECURITY](SECURITY.md#bulles-des-objets-wowhead)).

## `GET /api/health`

Publique. `200` si la base répond, `503` sinon, avec la construction en service :

```json
{"status":"ok","version":"0.7.0","commit":"c7b3b7f"}
```

`status` vaut `unavailable` en `503`. `version` et `commit` valent `null` si la construction ne les
connaissait pas. Le dépôt étant public, ils ne révèlent rien de plus ; ils permettent de vérifier
un déploiement sans session. Aucun autre détail.

## Journal du serveur

Une ligne JSON par requête de synchronisation, sans jamais de jeton ni de contenu du document :

```json
{"event":"sync.received","requestId":"…","machine":"<uuid>","agentVersion":"0.1.0","accounts":2,"characters":6,"bytes":91234,"durationMs":84,"result":{"status":"success","charactersUpdated":1}}
```

Autres événements : `sync.rejected` (statut, code), `sync.failed`, `sync.unavailable`, `sync.busy`
(`stage` : `queue` pour la file pleine ou l'attente dépassée, `lock` pour le verrou),
`auth.login.succeeded`, `auth.login.failed`, `agent_token.created`, `agent_token.revoked`, `export.xlsx`,
`export.inventory`, `export.finances`, `notify.sent`, `notify.failed`
([NOTIFICATIONS § Journal](NOTIFICATIONS.md#journal)).
