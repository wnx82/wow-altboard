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
- `bank` et `bags` sont absents tant que l'addon ne les a jamais datés ;
- `playtime` est absent sans l'addon Allemano Ledger ([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)).
  `levels[].level` est le niveau quitté ; `playedSeconds` est omis quand plusieurs niveaux ont été
  gagnés d'un coup. Au plus 200 niveaux par personnage ;
- `sessions` est absent quand Allemano Ledger n'en a enregistré aucune. `startedAt` identifie la
  session ; `durationSeconds` est le temps connecté, pauses exclues ; `inProgress` signale une
  session encore ouverte, aux valeurs provisoires. Au plus 60 sessions par personnage ;
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

Le schéma complet, avec ses bornes, est `web/src/lib/sync/schema.ts` ; son miroir côté agent est
`agent/src/AltBoardSync.Core/Sync/SyncPayload.cs`. Le fichier
`tests/fixtures/payloads/two-accounts.json`, produit par l'agent réel, sert de contrat aux tests de l'API ;
`tests/fixtures/payloads/economy-account.json` fait de même pour les prix et les recettes, et
`tests/fixtures/payloads/baganator-account.json` pour le courrier, les enchères et les banques de guilde.

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
  "requestId": "c6ed9755-d086-4437-a6f1-66dcc97bfe0c"
}
```

`status` vaut `partial` quand l'agent a signalé des avertissements (`warnings` d'un compte) : ils
sont conservés dans `sync_errors`, comptés dans `errors_count` et affichés sous la ligne du journal
de la page **Machines**. Les données sont enregistrées de la même façon. L'agent ne lit que le code
HTTP.

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
| 422 | `future_timestamp` | un horodatage d'un personnage (`lastSeen`, `statsAt`, sacs, banque, temps de jeu, sessions) dépasse de plus d'une heure l'heure du serveur : horloge du PC en avance (`issues` : chemins, vingt au plus) |
| 429 | `rate_limited` | plus de 60 requêtes en 5 minutes, ou 10 échecs d'authentification en 15 minutes |
| 500 | `internal_error` | erreur de traitement : la synchronisation entière est annulée ; `sync_errors` et le journal n'en gardent que le type et le code PostgreSQL ou réseau |
| 503 | `service_unavailable` | base injoignable : réessayer plus tard |

Toutes les réponses portent `requestId`, `X-Request-ID` et `Cache-Control: no-store`.
Une synchronisation est **tout ou rien** et **idempotente** : la renvoyer ne change rien.

## `GET /api/export/xlsx`

Session du tableau de bord requise (401 sinon). Renvoie `AltBoard-export-AAAA-MM-JJ.xlsx` :
feuilles Résumé, Personnages, Métiers, Équipement, Monnaies, Réputations, Comptes, Machines.
Le classeur est une photographie : la base reste la source.

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
 "items":[{"itemKey":"2589","name":"Étoffe de lin","quality":1,"icon":"inv_fabric_linen_01","owned":550,"href":"/inventory?q=…"}]}
```

6 personnages et 8 objets au plus, rangés par pertinence (le nom commence par le texte, puis l'un
de ses mots, puis ailleurs). Les objets possédés passent d'abord et mènent à la page Inventaires ;
les autres ne sont proposés que si l'hôtel des ventes les a déjà vus, et mènent à leur fiche de
marché. Les pages du menu sont cherchées par le navigateur, sans appel.

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
{"event":"sync.received","requestId":"…","machine":"<uuid>","agentVersion":"0.1.0","accounts":2,"characters":6,"durationMs":84,"result":{"status":"success","charactersUpdated":1}}
```

Autres événements : `sync.rejected` (statut, code), `sync.failed`, `sync.unavailable`,
`auth.login.succeeded`, `auth.login.failed`, `agent_token.created`, `agent_token.revoked`, `export.xlsx`.
