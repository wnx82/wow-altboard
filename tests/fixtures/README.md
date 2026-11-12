# Fixtures

Toutes les données sont anonymisées : GUID, noms de personnage et noms de guilde sont remplacés.
Aucun nom de dossier de compte réel n'y figure.

| Fichier | Origine |
|---|---|
| `account-four-characters.lua`, `account-two-characters.lua` | fichiers `AltBoard.lua` réels (addon 0.8.3), format conservé octet pour octet |
| `*-previous.lua` | fichier `.bak` correspondant : sauvegarde précédente du client, clés dans un autre ordre |
| `partial-data.lua`, `special-strings.lua`, `multi-realm.lua`, `unknown-schema.lua`, `no-altboarddb.lua`, `empty.lua` | écrits à la main pour les cas limites |
| `payloads/two-accounts.json` | document produit par l'agent à partir des deux fixtures réelles ; sert de contrat entre l'agent et l'API |
| `auctionator-small.lua` | fichier `Auctionator.lua` réel et entier (addon 341) : 8 objets relevés un seul jour (2026-11-05), 12 prix marchands. Prix et réglages de l'addon : aucune donnée personnelle |
| `auctionator-multi-day.lua` | produit par `tools/make-economy-fixtures.mjs` depuis un `Auctionator.lua` réel : 40 objets de l'hôtel des ventes « PvE » (30 relevés plusieurs jours, 10 un seul), réencodés en CBOR comme le fait le client, et 15 prix marchands |
| `naowh-recipes.lua` | produit par le même outil : `NaowhForeverDB.account.profMakes` d'un `NaowhForever.lua` réel, GUID remplacé par `Player-9999-00000001` |
| `payloads/economy-account.json` | document produit par l'agent à partir de `account-four-characters.lua`, `auctionator-multi-day.lua` et `naowh-recipes.lua` ; contrat des blocs `auctionator` et `recipes` |
| `syndicator-small.lua` | écrit à la main sur le modèle d'un `Syndicator.lua` réel (Baganator) : personnages et guildes fictifs. Courrier en double du même objet, objet à suffixe, vente en cours, personnage vide, personnage inconnu d'AltBoard, banque de guilde avec un onglet et banque jamais ouverte |
| `payloads/baganator-account.json` | document produit par l'agent 0.8.0 à partir de `account-four-characters.lua` et `syndicator-small.lua` ; contrat du bloc `baganator` |

## Régénérer

Fixtures Lua, depuis de vrais fichiers :

```bash
node tools/anonymize-altboard.mjs tests/fixtures <nom>=<chemin vers AltBoard.lua>
```

Document JSON, après toute évolution du format produit par l'agent : placer les deux fixtures réelles
dans une arborescence `WTF/Account/<compte>/SavedVariables/AltBoard.lua` temporaire, puis

```bash
dotnet run --project agent/src/AltBoardSync -- scan --wow-path <dossier temporaire> --out tests/fixtures/payloads/two-accounts.json
```

et remplacer `machine` par une identité fictive.

Fixtures de l'économie, depuis de vrais fichiers (lecture seule, rien n'est écrit dans le dossier du jeu) :

```bash
node tools/make-economy-fixtures.mjs tests/fixtures <chemin vers Auctionator.lua> <chemin vers NaowhForever.lua> <GUID réel>=Player-9999-00000001
```

puis, pour `payloads/economy-account.json`, placer `account-four-characters.lua` (renommé
`AltBoard.lua`), `auctionator-multi-day.lua` (renommé `Auctionator.lua`) et `naowh-recipes.lua`
(renommé `NaowhForever.lua`) dans `_forever_/WTF/Account/<compte>/SavedVariables` d'un dossier
temporaire, lancer `scan --out` comme ci-dessus et remplacer `machine` par une identité fictive.
Le GUID fictif doit être celui d'un personnage de `account-four-characters.lua`, sans quoi le
serveur n'attache aucune recette.

Pour `payloads/baganator-account.json`, même démarche avec `account-four-characters.lua` (renommé
`AltBoard.lua`) et `syndicator-small.lua` (renommé `Syndicator.lua`). Les noms des personnages de
`syndicator-small.lua` doivent rester ceux de `account-four-characters.lua`, sans quoi l'agent ne
les rattache à aucun GUID.
