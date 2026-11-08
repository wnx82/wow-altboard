# API

Trois versions évoluent séparément :

| Version | Où | Valeur actuelle |
|---|---|---|
| `agentVersion` | version de l'exécutable (`agent/Directory.Build.props`) | `0.5.0` |
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
  session encore ouverte, aux valeurs provisoires. Au plus 60 sessions par personnage.

Compatibilité : `playtime` et `sessions` sont des ajouts facultatifs à la version 1. Les objets étant
stricts, un serveur antérieur refuserait un document qui les contient : **le serveur se met à jour avant les
agents**. Un agent antérieur reste accepté par le nouveau serveur.

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

Le schéma complet, avec ses bornes, est `web/src/lib/sync/schema.ts` ; son miroir côté agent est
`agent/src/AltBoardSync.Core/Sync/SyncPayload.cs`. Le fichier
`tests/fixtures/payloads/two-accounts.json`, produit par l'agent réel, sert de contrat aux tests de l'API ;
`tests/fixtures/payloads/economy-account.json` fait de même pour les prix et les recettes.

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
| 429 | `rate_limited` | plus de 60 requêtes en 5 minutes, ou 10 échecs d'authentification en 15 minutes |
| 500 | `internal_error` | erreur de traitement : la synchronisation entière est annulée |
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
