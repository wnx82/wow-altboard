# Modèle de données Auctionator

Source des prix de l'hôtel des ventes. La roadmap de l'économie prévoyait l'addon **Auctioneer** :
il n'est installé sur aucun compte. **Auctionator** l'est, et c'est donc lui que lit l'agent.
Constaté sur les fichiers réels du 2026-11-06 (Auctionator 341, base version 8).

Fichier : `WTF\Account\<COMPTE>\SavedVariables\Auctionator.lua`, un par compte. L'agent le lit en
lecture seule, comme `AltBoard.lua`, et ne transmet que les prix. La configuration de l'addon et
l'historique de mise en vente du joueur ne sont pas lus.

## `AUCTIONATOR_PRICE_DATABASE`

```lua
AUCTIONATOR_PRICE_DATABASE = {
  ["__dbversion"] = 8,
  ["PvE"] = "<document CBOR>",          -- un hôtel des ventes par clé
  ["ClassicBetaPvE2"] = "<document CBOR>",
}
```

- **Clé d'hôtel des ventes** : nom du jeu de règles régional (« PvE ») ou nom du royaume. Le même
  nom existe dans plusieurs clients (`_forever_`, `_classic_beta_`) : un marché est identifié par
  le couple (client, clé).
- **Valeur** : à la déconnexion, le client sérialise chaque hôtel des ventes en **CBOR** dans une
  chaîne Lua. Les chaînes CBOR y sont des chaînes d'octets (type majeur 2), une table vide est un
  tableau. Échappements Lua rencontrés : `\n`, `\r`, `\000`, `\"`, `\\`. Une table Lua non
  sérialisée est aussi acceptée.
- Toute autre version de base que 8 est refusée avec un avertissement : aucun prix n'est transmis.

### Entrée d'un objet

Clé : `"1234"` (objet), `"g:1234:60"` (équipement, avec son niveau d'objet), `"p:1234"` (mascotte).

Sur WoW Forever, Auctionator 352 ajoute `"gr:1234:of the Monkey"` : une variante à suffixe aléatoire,
nommée par son suffixe en anglais (`Source/Utilities/DBKeyFromLink.lua`). Chaque enchère d'une
variante est rangée sous cette clé **et** sous la clé simple `"1234"`, qui garde donc le plus bas prix
de toutes les variantes. L'agent 0.11.2 ignore ces clés sans avertissement (32 935 sur un fichier
réel du 2026-11-24, contre 7 588 clés simples) ; avant lui, chaque synchronisation devenait
`partial` (« clés d'objet non reconnues »). Les prix par variante viennent des scans
d'EZAuctioneer (`i:1234:s<suffixe>`).

| Champ | Contenu |
|---|---|
| `m` | dernier prix minimum vu, en pièces de cuivre |
| `h` | `{ ["<jour>"] = prix }` : **plus haut** des prix minimums vus ce jour-là |
| `l` | `{ ["<jour>"] = prix }` : **plus bas** des prix minimums, écrit seulement s'il diffère de `h` |
| `a` | `{ ["<jour>"] = quantité }` : plus grande quantité en vente vue ce jour-là |

`<jour>` : nombre de jours depuis le 2020-01-01 (`SCAN_DAY_0`), compté sur l'heure locale du PC de
jeu. Exemple : le jour 2499 est le 2026-11-04, sortie officielle de WoW Forever.

**Ce qu'Auctionator ne garde pas** : l'heure d'un scan, le nombre d'enchères, le vendeur, le
prix de chaque enchère. Le jour est la seule granularité. Un jour peut ne porter que les objets
d'une recherche ciblée (scan partiel).

## `AUCTIONATOR_VENDOR_PRICE_CACHE`

`{ ["<objet>"] = prix }` : prix chez un marchand, relevé par l'addon quand le joueur ouvre la
fenêtre d'un marchand. L'agent le transmet tel quel ; le moteur s'en sert pour les composants
achetés chez un marchand.

## Ce que l'agent transmet

Bloc `auctionator` du compte (voir [API](API.md)) :

- par hôtel des ventes : sa clé, une empreinte SHA-256 du contenu normalisé, et ses objets ;
- par objet : `lastMin` (`m`) et la liste des jours `[jour, plus bas, plus haut, quantité|null]`,
  avec plus bas = `l` sinon `h` ;
- au plus 400 jours par objet (les plus récents), 100 000 objets par marché, 20 marchés ;
- un prix au-delà de 10¹³ pièces de cuivre ou un jour invalide est ignoré et compté dans un
  avertissement.

## Ce que le serveur en fait

- Un même contenu (marché, compte, empreinte) n'est importé qu'une fois.
- `market_item_days` : un relevé par (marché, objet, jour). Plusieurs comptes ou PC relèvent le
  même jour : plus bas des plus bas, plus haut des plus hauts, plus grande quantité. L'import est
  idempotent.
- `market_item_latest` : dernier prix minimum vu, remplacé seulement par un jour plus récent.
- `vendor_prices` : remplacé seulement par un fichier plus récent.

Voir [DATABASE](DATABASE.md) et [ECONOMY-ENGINE](ECONOMY-ENGINE.md).

## Économie de la bêta

Les relevés du client `_forever_` antérieurs au 2026-11-04 viennent de la bêta (fichiers recopiés
à l'installation). Le moteur ignore les jours antérieurs au **début de l'historique** :
le réglage de la page Paramètres, sinon la date limite de la réinitialisation des personnages.
