# Modèle de données EZAuctioneer

Deuxième source des prix de l'hôtel des ventes, à côté d'[Auctionator](AUCTIONATOR-DATA-MODEL.md).
**EZAuctioneer** est l'addon de revente du propriétaire du tableau de bord. Auctionator ne garde
qu'un prix par jour. EZAuctioneer garde chaque scan complet, à son heure. Constaté sur les fichiers
réels du 2026-11-19 (addon 0.4.3, base version 5).

Fichier : `WTF\Account\<COMPTE>\SavedVariables\EZAuctioneer.lua`, un par compte, jusqu'à 5 Mo et
plus. L'agent 0.10.0 le lit en lecture seule, comme `AltBoard.lua`, et ne transmet que les scans.

## `EZAuctioneerDB`

```lua
EZAuctioneerDB = {
  ["schema"] = 5,
  ["markets"] = {
    ["3:CAMWOW EU5 Realm 5 PvE:Alliance:faction"] = {
      ["history"] = {
        ["i:2589"] = { ["samples"] = { { ["ts"] = 1795079141, ["p"] = 15, ["units"] = 610 }, ... } },
        ["i:4306:s1019"] = { ... },
      },
      ["lastSummary"] = { ["at"] = 1795079141, ["auctions"] = 174284, ["items"] = 6744, ["origin"] = "own" },
      ["lastDeals"] = { ... },
    },
  },
  ["scanLog"] = { { ["outcome"] = "ok", ["market"] = "…", ["endedAt"] = 1795079142, ["auctions"] = 174284, ["items"] = 6744, ["origin"] = "own" }, ... },
  ["portfolio"] = { ["3:CAMWOW EU5 Realm 5 PvE:<personnage>"] = { ... } },
}
```

- **Clé de marché** : `<région>:<royaume>:<faction>:faction` (hôtel des ventes de faction) ou
  `<région>:<royaume>:neutral` (hôtel des ventes neutre). Le royaume est le nom que donne le jeu
  (`GetRealmName()`). Il peut différer de celui de la liste des royaumes et des clés d'Auctionator
  (« PvE »). Le moteur ne s'y fie donc pas : il relie un marché d'EZAuctioneer à un marché
  d'Auctionator quand leurs prix concordent (voir [ECONOMY-ENGINE](ECONOMY-ENGINE.md), « Scans
  EZAuctioneer »).
  Depuis le build 71037 de WoW Forever (2026-11-21), `GetRealmName()` rend `""` : les scans suivants
  sont rangés sous `3::Alliance:faction`. L'agent 0.11.1 transmet ces marchés (0.11.0 les écartait :
  « marché non reconnu ») ; le site leur donne le royaume des personnages du compte joués sans
  royaume, écrit comme dans les marchés déjà connus (`3:CAMWOW EU5 Realm 5 PvE:Alliance:faction`),
  et les écarte avec un avertissement quand ces personnages sont de plusieurs royaumes.
- **Clé d'objet** : `i:<objet>`, `i:<objet>:s<suffixe>` ou `i:<objet>:s<suffixe négatif>:f<facteur>`.
  Une variante à suffixe (« de l'Ours », etc.) a son propre prix.
- **Relevé** (`samples`) : `ts`, heure du serveur du jeu (`GetServerTime()`, secondes Unix) ;
  `p`, 25e percentile du prix unitaire, pondéré par les unités en vente, en pièces de cuivre ;
  `units`, unités en vente. L'addon garde les 12 derniers relevés de chaque objet (réglage
  `maxSamples`), 8000 objets par marché au plus, et oublie un objet non vu depuis 21 jours.
- **Rapport de scan** : `lastSummary` (dernier scan du marché, champ `at`) et `scanLog` (5 derniers
  scans de tous les marchés, champ `endedAt`, `outcome` « ok » ou autre). `auctions` : enchères
  vues ; `items` : objets distincts ; `origin` : « own » (scan de l'addon) ou « external » (scan
  lancé par un autre addon). Le même scan figure souvent dans les deux, daté à une seconde près.
- **Bases version 3 à 5** : même format de l'historique, toutes acceptées. Toute autre version
  est refusée avec un avertissement : aucun scan n'est transmis.

## Ce que l'agent transmet

Bloc `ezAuctioneer` du compte (voir [API](API.md)), document au format 6 :

- par marché : sa clé, une empreinte SHA-256 des scans et des relevés, ses scans et ses objets ;
- par scan : heure, enchères, objets, origine. Les rapports `lastSummary` et `scanLog` réussis,
  sans double : un rapport à moins de 60 secondes du précédent, aux mêmes comptes, est le même
  scan. 50 scans au plus par marché ;
- par objet : sa clé et ses relevés `[heure, prix, unités]`, triés par heure, 50 au plus ;
- au plus 20 marchés et 20 000 objets par marché. Un relevé invalide (heure hors 2020–2099, prix
  nul ou au-delà de 10¹³ pièces de cuivre, unités négatives) ou une clé inconnue est ignoré et
  compté dans un avertissement. Un marché sans relevé n'est pas transmis.

Depuis l'agent 0.11.0, le **portefeuille** de chaque personnage (bilan, positions, annonces suivies,
journal) et les **affaires** du dernier scan de chaque marché (`lastDeals`) sont aussi transmis :
voir [RESALE](RESALE.md). Les noms et liens d'objets du portefeuille ne le sont pas (le site a son
référentiel), ni les réglages de l'addon.

Un fichier illisible n'empêche pas la synchronisation : l'agent l'annonce dans un avertissement et
envoie le reste. La surveillance (`watch`) réagit aussi à ce fichier.

## Ce que le serveur en fait

- `scan_markets` : un marché par (client, clé), avec région, royaume, maison et faction tirés de
  la clé.
- `scan_imports` : un contenu (marché, compte, empreinte) n'est importé qu'une fois. Supprimer un
  compte retire ses imports, pas les relevés.
- `market_item_scans` : un relevé par (marché, objet, heure). Un relevé déjà reçu ne change plus :
  c'est la photo d'un instant. L'addon oublie ses plus vieux scans ; le serveur les accumule. Deux
  comptes du même marché ne doublent rien.
- `market_scans` : un scan par (marché, heure), avec le nombre d'objets relevés et d'unités. Un
  rapport s'y rattache s'il est à moins de 120 secondes ; sinon il forme un scan sans relevé.
- **Au-delà de 60 jours**, les relevés de chaque jour (heure de Bruxelles) sont résumés dans
  `market_item_scan_days` (plus bas, médiane, plus haut, plus grand nombre d'unités, nombre de
  scans) puis supprimés, par la purge quotidienne. Le prix de chaque jour n'est donc jamais perdu.

Depuis le site 0.35.0, le moteur de l'économie complète les prix d'Auctionator par les scans des
marchés reliés ([ECONOMY-ENGINE](ECONOMY-ENGINE.md), « Scans EZAuctioneer »). Le tableau de bord
affiche aussi les scans sur la page **Marché** (taille de chaque marché, et s'il complète les
prix) et sur la page d'un objet (section « Scans EZAuctioneer » : dernier prix, variation sur
24 h, unités en vente, courbe scan par scan).

Voir [DATABASE](DATABASE.md).
