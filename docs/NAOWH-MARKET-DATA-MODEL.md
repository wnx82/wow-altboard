# Modèle de données NaowhForever (prix de l'hôtel des ventes)

Troisième source des prix de l'hôtel des ventes, à côté d'[Auctionator](AUCTIONATOR-DATA-MODEL.md)
et d'[EZAuctioneer](EZAUCTIONEER-DATA-MODEL.md). **NaowhForever** est un addon tiers (Naowh, tous
droits réservés) dont l'agent lit déjà les recettes apprises ([PROFESSIONS](PROFESSIONS-DATA-MODEL.md)).
Ses modules Auction Prices et The Market gardent aussi des prix. Constaté sur les fichiers réels du
2026-11-28 (NaowhForever 1.5.1).

Ce que Naowh apporte en plus des deux autres sources :

- une **médiane pondérée par la quantité** et le **nombre d'annonces** de chaque objet. Une seule
  annonce bradée ne fausse pas la médiane, alors qu'elle fausse le prix le plus bas qu'Auctionator garde ;
- un **flux de prix** livré avec l'addon et tiré des données de Blizzard, pour **tous** les hôtels des
  ventes de la région : celui de la Horde et les Blackwater (neutres), sans y aller ni scanner.

L'agent 0.12.0 lit les deux fichiers en lecture seule. Rien n'est écrit dans le dossier du jeu.

## `NaowhForeverDB.account` (SavedVariables)

Fichier : `WTF\Account\<COMPTE>\SavedVariables\NaowhForever.lua`, un par compte, de 60 Ko à plus de
4 Mo. L'agent le lit une seule fois pour les recettes et pour les prix.

```lua
NaowhForeverDB = {
  ["account"] = {
    ["ahPrices"] = {
      ["CAMWOW EU5 Realm 5 PvE-Alliance"] = {
        ["time"] = 1795817357,        -- dernier scan complet
        ["medianTime"] = 1795817357,  -- dernier scan rapide (le seul qui donne les médianes)
        ["requested"] = 1795817347,   -- dernière demande de scan (non transmise)
        ["prices"] = { [2589] = 15, ... },   -- plus bas prix d'achat immédiat, à l'unité
        ["medians"] = { [2589] = 17, ... },  -- médiane pondérée par la quantité
        ["listed"] = { [2589] = 610, ... },  -- annonces avec prix d'achat immédiat (une pile compte une fois)
        ["seen"] = { [2589] = 1795852696, ... }, -- prix revu depuis le scan, en parcourant l'HV
        ["suffixes"] = { ... }, ["suffixSeen"] = { ... }, -- variantes à suffixe, par nom traduit
      },
    },
    ["marketHistory"] = {
      ["CAMWOW EU5 Realm 5 PvE-Alliance"] = {
        ["at"] = 1795839703,          -- dernière écriture de l'historique
        ["days"] = {
          [20775] = ",15347:2000:11,282074:21500:4,...", -- jour passé : objet:médiane[:annonces]
          [20784] = { [15347] = 2222, ... },             -- jour en cours : table de médianes
        },
        ["listed"] = { [20784] = { [15347] = 19, ... } }, -- annonces du jour en cours
      },
    },
  },
}
```

- **Clé de maison** : `<royaume>-<camp>`, le camp étant `Alliance`, `Horde` ou `Blackwater` (hôtel
  des ventes neutre). Le royaume est celui que donne le jeu. Depuis le build 71037 de WoW Forever, le
  jeu n'en donne plus : l'addon prend alors le royaume déjà vu pour ce serveur, ou à défaut le
  numéro du serveur (`6947-Alliance`). Ce royaume s'écrit comme dans les clés d'EZAuctioneer
  (« CAMWOW EU5 Realm 5 PvE »).
- **Jour** : nombre de jours depuis le 1970-01-01 à l'heure du serveur du jeu (`GetServerTime()`),
  donc un jour UTC. L'addon garde 14 jours (`HISTORY_DAYS`). Un jour passé est une chaîne ; le jour
  en cours reste en tables tant qu'il dure.
- **Prix** : à l'unité, en pièces de cuivre. Une médiane du jour en cours peut avoir des décimales :
  l'agent l'arrondit à la pièce.
- **Scan rapide ou page par page** : seul le scan rapide voit toutes les annonces et donne les
  médianes. Un scan page par page ne garde que les plus bas prix et laisse les dernières médianes
  en place. Un compte peut donc n'avoir aucune médiane.
- **Variantes à suffixe** (`suffixes`) : rangées sous le nom traduit de la variante, sans
  identifiant de suffixe. Elles ne sont pas transmises : EZAuctioneer les donne avec leur identifiant.

## Flux de prix (`NaowhForever_AuctionData\Prices.lua`)

Fichier : `Interface\AddOns\NaowhForever_AuctionData\Prices.lua`, un par client, environ 1,9 Mo. Il
est reconstruit à chaque version de l'addon, dont une version de prix chaque soir sur CurseForge.
C'est du code Lua, pas des SavedVariables :

```lua
local ns = _G.NaowhForever

ns.AuctionFeed = {
    time = 1795839703,  -- heure des données de Blizzard (celles de la maison la plus ancienne)
    regions = {
        [3] = {          -- GetCurrentRegion() : 1 Amériques, 3 Europe
            [111] = { faction = "Alliance", prices = "p:2b2:g:334,a:15o:d:15o,..." },
            [112] = { faction = "Alliance", prices = "" },  -- maison vide
            ...
        },
    },
    middles = { ... },   -- prix médians par camp, calculés à la publication (non transmis)
}
```

- **Maison** : identifiant de Blizzard et camp. Blizzard publie cinq maisons par camp et par région,
  dont une vide. Le flux ne dit pas quel royaume chaque maison dessert. L'addon le trouve en
  comparant le scan du joueur avec chaque maison.
- **Prix** : `écart:plus bas:annonces:médiane,…` en base 36. Chaque objet est donné par son écart
  avec le précédent, le premier depuis zéro. Les annonces et la médiane sont facultatives
  (`objet:prix::médiane` quand seule la médiane est connue).
- L'agent ne lit que le littéral de `ns.AuctionFeed`, avec le même lecteur que les SavedVariables :
  tout ce qui n'est pas un littéral est refusé et le fichier n'est jamais exécuté.

## Ce que l'agent transmet

Document au format 9 (voir [API](API.md)).

Bloc `naowhMarket` du compte :

- par maison : sa clé, une empreinte SHA-256 de ce qui suit, `scannedAt`, `medianAt`, `recordedAt` ;
- `items` : un tableau `[objet, plus bas, médiane, annonces, revu à]` par objet, trié par objet. Au
  moins un des deux prix est présent ; le reste peut valoir `null` ;
- `days` : jours d'historique `AAAA-MM-JJ` (UTC), du plus ancien au plus récent, chacun avec un
  tableau `[objet, médiane, annonces]` par objet ;
- au plus 20 maisons, 30 000 objets par maison, 31 jours. Une clé, un prix ou un jour invalide est
  ignoré et compté dans un avertissement. Une maison sans prix ni jour n'est pas transmise.

Bloc `naowhFeeds` du document, un par client :

- seulement la région dont une maison concorde avec un scan Naowh des comptes de ce client : au moins
  20 objets à 1 % près, comme l'addon. Sans scan Naowh, la région est inconnue : rien n'est envoyé et
  une information le dit ;
- par maison non vide : identifiant de Blizzard, camp, un tableau `[objet, plus bas, médiane, annonces]`
  par objet ;
- comme les noms d'objets du cache du jeu, `watch` ne renvoie le flux que si son fichier a changé
  depuis le dernier envoi accepté (`naowhFeedHashes` dans `state.json`). Un flux modifié seul ne
  déclenche pas d'envoi : il part avec la synchronisation suivante.

Le document grossit d'environ 1 Mo par maison (surtout l'historique) et de 1,1 Mo pour le flux. Sur
le PC de référence, il passe de 7,9 à 12,2 Mo, pour une limite de 24 Mo.

Un fichier illisible n'empêche pas la synchronisation : l'agent l'annonce dans un avertissement et
envoie le reste. Les recettes et les prix partent ou manquent ensemble, puisqu'ils viennent du même
fichier.

## Ce que le serveur en fait

- `naowh_houses` : une maison par (client, clé), avec le royaume et le camp tirés de la clé. Elle
  n'est pas rapprochée ici des marchés d'Auctionator ni d'EZAuctioneer.
- `naowh_imports` : un contenu (maison, compte, empreinte) n'est importé qu'une fois. Supprimer un
  compte retire ses imports, pas les prix.
- `naowh_prices` : dernier prix connu de chaque objet d'une maison. Le plus bas est daté par
  `priced_at` (revu en parcourant l'HV, sinon le scan complet), la médiane par `median_at`. Chacun
  n'est remplacé que par un relevé au moins aussi récent : un PC au fichier ancien ne fait pas
  reculer la maison, et un scan page par page garde la dernière médiane.
- `naowh_price_days` : médiane et annonces par (maison, objet, jour). L'addon oublie ses jours au-delà
  de 14 ; le serveur les accumule. Un jour n'est remplacé que par un historique écrit plus tard
  (`recorded_at`) : le jour en cours suit le dernier scan.
- `naowh_feed_houses` et `naowh_feed_prices` : dernière version du flux, par (client, région, maison
  de Blizzard). Une maison n'est remplacée, en bloc, que par des données de Blizzard plus récentes.
  Une maison absente d'une version garde la précédente.
- Seules les lignes nouvelles ou modifiées sont écrites. Une maison réimportée sans vrai changement
  coûte environ 0,2 s ; le tout premier import du PC de référence (3 maisons, 140 000 jours, 57 000
  prix du flux) environ 11 s.

Ces prix ne sont pas encore lus par le moteur de l'économie ni affichés : c'est le lot suivant.

Voir [DATABASE](DATABASE.md).
