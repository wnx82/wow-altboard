# Modèle de données Baganator

Source du **courrier**, des **ventes en cours** et des **banques de guilde**. L'addon de sacs
Baganator range ses relevés d'inventaire dans sa bibliothèque **Syndicator**. L'agent (0.8.0 et
plus) lit ce fichier en lecture seule, comme `AltBoard.lua`. Constaté sur les fichiers réels du
2026-11-12, sur quatre comptes WoW Forever.

Fichier : `WTF\Account\<COMPTE>\SavedVariables\Syndicator.lua`, un par compte.

AltBoard relève déjà les **sacs** et la **banque** de chaque personnage, avec les mêmes totaux que
Baganator. L'agent ne reprend donc de Syndicator que ce qu'AltBoard ne voit pas :

| Bloc Syndicator | Repris | Pourquoi |
|---|---|---|
| `mail` | oui | courrier en attente, à la dernière ouverture de la boîte aux lettres |
| `auctions` | oui | objets en vente, au moment de leur mise en vente |
| `Guilds[…].bank` | oui | onglets de la banque de guilde, à leur dernière ouverture |
| `bags`, `bank`, `bankTabs` | non | déjà relevés par AltBoard (`character_items`) |
| `equipped`, `void`, `currencies`, `money` | non | équipement et or déjà relevés par AltBoard ; pas de chambre du Vide dans ce client |
| `Warband`, `SYNDICATOR_CONFIG` | non | banque de bataillon absente de ce client ; réglages de l'addon |

## `SYNDICATOR_DATA.Characters`

```lua
SYNDICATOR_DATA = {
  ["Version"] = 2,
  ["Characters"] = {
    ["Élodie Brisefer-PvE"] = {
      ["details"] = { ["character"] = "Élodie Brisefer", ["realm"] = "PvE", ["realmNormalized"] = "PvE", … },
      ["mail"] = {
        { ["itemID"] = 249428, ["itemCount"] = 3, ["itemLink"] = "|cnIQ1:|Hitem:249428::…|h[…]|h|r",
          ["quality"] = 1, ["iconTexture"] = 134252, ["expirationTime"] = 1796500000, … },
        {},                                  -- case vide : table vide
      },
      ["auctions"] = { { …, ["expirationTime"] = 1794091265 } },
      ["bags"] = { … }, ["bank"] = { … }, ["equipped"] = { … }, …
    },
  },
  ["Guilds"] = { … },
}
```

- **Clé du personnage** : « Nom-Royaume ». Syndicator ne connaît pas le GUID. Le nom vient de
  `details.character`, ou à défaut de la clé jusqu'au dernier tiret.
- **Entrée** : `itemID`, `itemCount` (1 si absent), `itemLink`, `quality`, `iconTexture`,
  `expirationTime` (secondes Unix, courrier et enchères). Les autres champs (`isBound`, `hasLoot`…)
  ne sont pas lus. Une case vide est une table vide.
- **Clé d'objet** : celle d'AltBoard, « ID », ou « ID:suffixe » pour un objet à suffixe aléatoire
  (« de l'ours »). Le suffixe est le septième champ après `item:` dans le lien. Sans lien lisible,
  l'`itemID` seul sert de clé.
- **Agrégation** : le courrier et les enchères d'un personnage sont additionnés par objet. Deux
  courriers du même objet donnent une ligne, avec l'échéance la plus proche.

## `SYNDICATOR_DATA.Guilds`

```lua
["Guilds"] = {
  ["Ordre Fictif-ClassicBetaPvE2"] = {
    ["money"] = 4699,                                   -- pièces de cuivre
    ["details"] = { ["guild"] = "Ordre Fictif", ["realm"] = "ClassicBetaPvE2", ["visited"] = true },
    ["bank"] = {
      [1] = { ["name"] = "Composants", ["slots"] = { { …entrée… }, {}, … } },
    },
  },
}
```

- **Onglets** : numérotés de 1 à 16 ; le nom est facultatif. Les objets d'un onglet sont additionnés
  par clé, 500 objets distincts au plus par onglet.
- **Banque jamais ouverte** : aucun onglet et pas d'or (ou 0). Elle n'est pas transmise.

## Rattachement aux personnages

Syndicator nomme les personnages sans GUID ni distinction de client. L'agent rattache chaque nom
au personnage d'AltBoard **du même compte** qui porte ce nom. Si deux personnages du compte portent
le même nom (un personnage de la bêta et son homonyme de WoW Forever), celui vu le plus récemment
l'emporte. Un nom inconnu d'AltBoard n'est pas transmis ; un avertissement le signale.

Une banque de guilde n'est gardée par le serveur que si son royaume est celui d'au moins un
personnage du compte. Les guildes de la bêta, dont les personnages ont été effacés, restent ainsi
hors du tableau de bord.

## Document envoyé (`baganator`, par compte)

```json
"baganator": {
  "file": { "hash": "…", "modifiedAt": "2026-11-12T10:00:00Z", "size": 123456 },
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

Chaque personnage d'AltBoard connu de Baganator figure, listes vides comprises : un courrier vidé
efface donc le relevé précédent. Les objets cités sont aussi décrits dans `items` (nom tiré du lien,
qualité, icône) ; la description d'AltBoard l'emporte quand les deux existent.

| Limite | Valeur |
|---|---|
| Personnages | 200 |
| Lignes de courrier ou d'enchères par personnage | 2000 |
| Banques de guilde | 50 |
| Onglets par banque | 16 |
| Objets distincts par onglet | 500 |

## Stockage et fraîcheur

| Table | Contenu |
|---|---|
| `character_holdings` | courrier (`mail`) et ventes (`auctions`) d'un personnage : objet, quantité, échéance |
| `character_holding_sources` | date et empreinte du fichier qui a fourni le relevé d'un personnage |
| `guild_banks` | une banque de guilde vue depuis un compte : nom, royaume, or, noms des onglets, date et empreinte du fichier |
| `guild_bank_items` | contenu d'une banque de guilde, par onglet |

Un fichier **plus ancien** que le relevé gardé, ou de **même contenu**, ne change rien. Un agent
antérieur à 0.8.0, qui n'envoie pas de bloc `baganator`, laisse le relevé en place. Supprimer un
personnage supprime son courrier ; supprimer un compte supprime ses banques de guilde.

Ces tables sont séparées de `character_items` : l'économie (patrimoine, sessions de farm) ne lit que
les sacs, la banque et l'équipement d'AltBoard, et n'est pas modifiée.

## Échéances

Le relevé est une photographie. Un courrier dont l'échéance est passée a été renvoyé ou supprimé par
le jeu ; une vente échue s'est vendue ou est revenue par courrier. La page Inventaires les masque par
défaut (bouton « Échus ») et la recherche d'objets ne les compte pas. La fiche d'un personnage les
montre, marqués « expiré ».
