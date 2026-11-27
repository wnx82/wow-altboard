# Modèle de données AltBoard — structure réellement observée

> Statut : ✅ Validé sur fichiers réels (analyse du 2026-10-04).
> Règle : ce document ne décrit que ce qui a été **observé** dans les fichiers ou **lu** dans le
> code source de l'addon. Aucun champ n'est supposé.

## 1. Sources analysées

| Source | Détail |
|---|---|
| Addon | AltBoard **0.8.3** (`## Interface: 16001`, auteur Allemano), source dans `AltBoard-v0.8.3-beta-forever/` |
| Client | `C:\Program Files (x86)\World of Warcraft\_classic_beta_` (« WoW Forever », seul flavor installé) |
| Déclaration | `## SavedVariables: AltBoardDB` — une seule variable globale, **par compte** |
| Schéma addon | `AB.SCHEMA = 2` (`Core.lua:9`), stocké dans `AltBoardDB.schema` |
| Fichiers réels | 2 fichiers `AltBoard.lua` (79 251 et 32 331 octets) + 2 `AltBoard.lua.bak` |
| Volume | 3 dossiers de compte, 2 avec AltBoard, 6 personnages (4 + 2), 1 royaume |

Dossiers observés sous `WTF\Account\` :

| Dossier | Nature | `AltBoard.lua` |
|---|---|---|
| `9999999999#9` | compte | **non** (a des `SavedVariables`, mais pas AltBoard) |
| `999999999#9` | compte | oui (4 personnages) |
| `999999999#9` | compte | oui (2 personnages) |
| `SavedVariables` | **pas un compte** : dossier technique du client, au même niveau | non |

Conséquences : un compte peut avoir des `SavedVariables` sans AltBoard, et tout sous-dossier de
`WTF\Account\` n'est pas un compte. Seule la présence de `<dossier>\SavedVariables\AltBoard.lua`
désigne un compte à synchroniser ; les autres cas sont normaux, pas des erreurs.

## 2. Format du fichier

Observé sur les 4 fichiers (courants et `.bak`) :

- encodage **UTF-8 sans BOM**, fins de ligne **CRLF** ;
- première ligne **vide**, puis `AltBoardDB = {` ; le fichier se termine par `}` + ligne vide ;
- **aucune indentation** ;
- clés chaîne `["cle"] = valeur,` ; clés numériques `[2740] = valeur,` ;
- entrées **positionnelles** sans clé (`{`, `0,`, `nil,`) pour les tableaux — sans commentaire `-- [n]` ;
- `nil` positionnels présents (trous dans `gear` et `stats.res`) ;
- nombres entiers et flottants à pleine précision (`5.072000026702881`) ; pas de notation exponentielle observée ;
- chaînes entre guillemets doubles ; aucun échappement `\"` ni `\ddd` observé dans ces fichiers
  (le parser doit quand même les gérer : c'est le format standard des SavedVariables) ;
- caractères non ASCII bruts en UTF-8 : accents (`Épaulières`), apostrophe typographique `’`
  (`Éolide de l’Ordre suprême`), apostrophe droite `'` (`Bottes d'écuyer`) ;
- les liens d'objet contiennent des `|` (`|cnIQ2:|Hitem:4314:…|h[Nom]|h|r`).

Le fichier `.bak` est la sauvegarde précédente écrite par le client. **L'agent doit l'ignorer.**

Extrait réel anonymisé (structure exacte, sans indentation) :

```lua

AltBoardDB = {
["itemsWindow"] = {
},
["window"] = {
},
["launcher"] = {
["left"] = 192.6572862305548,
["top"] = 1059.21537035471,
},
["items"] = {
["275019"] = {
["q"] = 1,
["l"] = "|cnIQ1:|Hitem:275019::::::::5:1489:::::::::|h[Paquet de fournitures]|h|r",
["i"] = 413571,
["n"] = "Paquet de fournitures",
},
},
["settings"] = {
},
["errors"] = {
},
["schema"] = 2,
["chars"] = {
["Player-0000-00000001"] = {
["name"] = "Prenom Nom",
["realm"] = "ClassicBetaPvE2",
["class"] = "MAGE",
["level"] = 25,
["gear"] = {
nil,
nil,
{
["q"] = 2,
["name"] = "Épaulières à double couture en laine",
["link"] = "|cnIQ2:|Hitem:4314::::::::25:1482::::::::Player-0000-00000001:|h[Épaulières à double couture en laine]|h|r",
["icon"] = 135037,
["ilvl"] = 22,
},
},
},
},
}
```

## 3. Clés racines de `AltBoardDB`

| Clé | Type | Contenu | Utile à la synchro |
|---|---|---|---|
| `schema` | nombre | version du schéma addon (`2`) | **oui** (détection de version) |
| `chars` | table | personnages, **clé = GUID joueur** | **oui** |
| `items` | table | référentiel d'objets partagé, clé = `itemKey` | **oui** (noms des objets des sacs/banque) |
| `errors` | liste | 10 dernières erreurs Lua `{ t, where, msg, v }` — vide dans les 2 fichiers | diagnostic : transmises depuis l'agent 0.11.0 (`addonErrors`), montrées sur la page Comptes |
| `order` | liste de GUID | ordre manuel des personnages — **absente** des 2 fichiers (créée seulement après un déplacement) | optionnel |
| `settings` | table | préférences d'interface de l'addon | non |
| `launcher` | table | position du bouton (`left`, `top`) | non |
| `window`, `itemsWindow` | table | position des fenêtres (vides) | non |

`AltBoardDB.probe` a existé (versions 0.0.x) et est supprimée au chargement depuis 0.8.2
(`Core.lua:147`).

Il n'existe **aucune** information de compte, de machine ni de version d'addon dans `AltBoardDB`
(la version n'apparaît que dans `errors[].v`). La version de l'addon se lit dans
`Interface\AddOns\AltBoard\AltBoard.toc` (`## Version: 0.8.3`).

## 4. Identifiants

| Concept | Identifiant réel | Origine |
|---|---|---|
| Machine | aucun dans AltBoard | à générer par l'agent (`machine_uuid`) |
| Compte | nom du dossier `WTF\Account\<COMPTE>` | système de fichiers, pas le contenu |
| Royaume | `chars[guid].realm` (nom normalisé, ex. `ClassicBetaPvE2`) | `GetNormalizedRealmName()` (`Compat.lua:8`) |
| Personnage | **GUID** `Player-<idServeur>-<hex8>` (clé de `chars`) | `UnitGUID("player")` |

- Le GUID est unique : aucun doublon entre les deux comptes analysés ; préfixe unique `Player-4620`.
- Le nom **n'est pas** un identifiant : sur WoW Forever, `name` = prénom + nom de famille séparés
  par une espace (`Compat.lua:18`) et « les prénoms ne sont pas uniques ». Les 6 personnages ont
  une espace dans leur nom.
- Aucune région (EU/US) ni genre du personnage n'est disponible.
- **Royaume vide depuis le build 71037 de WoW Forever (2026-11-21).** `GetNormalizedRealmName()` et
  `GetRealmName()` rendent `""` : chaque personnage connecté depuis enregistre `realm = ""`. L'agent
  0.11.1 le transmet quand même (0.11.0 et avant l'écartaient : « nom, royaume ou lastSeen absent »).
  Le site déduit le royaume du personnage déjà connu par son GUID, sinon des personnages du même
  serveur (`Player-6947-…`), dans le document puis en base (`web/src/lib/sync/realms.ts`). Sur les
  fichiers réels du 2026-11-24 : 6947 = `CAMWOWEU5Realm5PvE`, 6855 = `CAMWOWEU5Realm1PvE`,
  4620 = `ClassicBetaPvE2`.

## 5. Personnage — `chars[guid]`

Présence mesurée sur les 6 personnages.

| Champ | Type | Présence | Signification (source dans `Data.lua`) |
|---|---|---|---|
| `name` | chaîne | 6/6 | nom complet, peut contenir une espace |
| `realm` | chaîne | 6/6 | royaume normalisé |
| `class` | chaîne | 6/6 | jeton de classe **non localisé** : `MAGE`, `SHAMAN`, `PRIEST`, `PALADIN`, `WARLOCK`, `HUNTER` |
| `race` | chaîne | 6/6 | race **localisée** (client frFR) : `Nain`, `Gnome`, `Humain`, `Éolide de l’Ordre suprême` |
| `faction` | chaîne | 6/6 | `Alliance` (seule valeur observée) |
| `level` | entier | 6/6 | niveau |
| `xp`, `xpMax` | entier | 6/6 | expérience courante / requise |
| `rested` | entier | 5/6 | expérience reposée ; **absent** si aucune |
| `guild` | chaîne | 3/6 | nom de guilde ; **absent** hors guilde |
| `zone` | chaîne | 6/6 | zone localisée (`Cité de Stormwind`) |
| `money` | entier | 6/6 | argent en **pièces de cuivre** (`GetMoney()`) |
| `ilvl` | flottant | 6/6 | niveau d'objet moyen équipé (`15.9375`) — non entier pour 5/6 |
| `lastSeen` | entier | 6/6 | horodatage Unix (secondes) de la dernière collecte |
| `stats` + `statsAt` | table + entier | 6/6 | statistiques et horodatage de leur lecture |
| `gear` | table | 6/6 | équipement par emplacement |
| `profs` | liste | 6/6 | métiers (peut être vide) |
| `reps` | table | 6/6 | réputations, clé = ID de faction |
| `currency` | table | 6/6 | monnaies, clé = nom (vide pour 5/6) |
| `bags` + `bagSlots` + `bagsAt` | table + table + entier | 6/6 | contenu des sacs, emplacements, horodatage |
| `bank` + `bankSlots` + `bankAt` | table + table + entier | **2/6** | banque ; **absents** tant que la banque n'a jamais été ouverte |
| `hidden` | booléen | 0/6 | personnage masqué dans l'addon (`Data.lua:526`) ; absent si non masqué |

Un personnage sans `name` est ignoré par l'addon lui-même (`Data.lua:480`).

### 5.1 `stats`

22 clés, toutes présentes pour les 6 personnages :
`str`, `agi`, `sta`, `int`, `spi`, `armor`, `health`, `power`, `powerType` (chaîne, ex. `MANA`),
`ap`, `rap`, `crit`, `rcrit`, `hit`, `dodge`, `parry`, `block`, `sp`, `scrit`, `heal`, `shit`, `res`.

- `res` : tableau positionnel `{ nil, 0, 0, 0, 0, 0 }` — index 2 à 6 = feu, nature, givre, ombre, arcane.
- `defense` est prévue par le code (`Data.lua:236`) mais **absente** des fichiers (API indisponible sur ce client).
- Toute valeur que le client ne fournit pas est simplement omise.
- Les statistiques incluent les améliorations actives au moment de la lecture ; elles ne sont pas lues en combat.

### 5.2 `gear`

Tableau indexé par emplacement d'inventaire (1 à 19, convention de l'API WoW : 1 tête, 2 cou,
3 épaules, 4 chemise, 5 torse, 6 taille, 7 jambes, 8 pieds, 9 poignets, 10 mains, 11-12 doigts,
13-14 bijoux, 15 dos, 16 main droite, 17 main gauche, 18 distance, 19 tabard).
Emplacements réellement vus : 3 à 12 et 15 à 18.

Sérialisation mixte, observée dans les deux fichiers : entrées positionnelles avec `nil` pour les
emplacements vides (23 `nil`), **et** clés explicites `[15] = {…}` quand le tableau est creux
(18 occurrences). Entre 5 et 14 objets par personnage.

| Champ | Type | Signification |
|---|---|---|
| `link` | chaîne | lien d'objet complet ; champ 1 = ID objet, champ 2 = ID d'enchantement (ex. `item:2969:24:`) |
| `name` | chaîne | nom localisé |
| `q` | entier | qualité (0 à 3 observées) |
| `ilvl` | entier | niveau d'objet |
| `icon` | entier | identifiant de fichier d'icône |

`name`, `q`, `ilvl` peuvent manquer si le client n'avait pas encore chargé l'objet (`Data.lua:76`).
Le nom de l'enchantement n'est **pas** disponible, seulement son ID dans le lien.
Certains liens contiennent un GUID de joueur, qui n'est pas forcément celui du porteur : on y trouve
des personnages d'un autre compte (objet fabriqué puis échangé). Tous les GUID sont donc anonymisés
dans les fixtures, pas seulement les clés de `chars`.

### 5.3 `profs`

Liste ordonnée (0 à 4 entrées observées).

| Champ | Type | Exemple |
|---|---|---|
| `name` | chaîne localisée | `Couture` |
| `skillLine` | entier | `197` |
| `rank` | entier | `88` |
| `max` | entier | `150` |
| `primary` | booléen | `true` pour les 2 métiers principaux |
| `icon` | entier | `136249` |

### 5.4 `reps`

Table à clé **numérique** = ID de faction (4 à 10 factions par personnage).

| Champ | Type | Exemple |
|---|---|---|
| `name` | chaîne localisée | `Ironforge` |
| `group` | chaîne localisée | `Alliance`, `Autre(s)` |
| `reaction` | entier | palier de réputation (4 et 5 observés) |
| `cur`, `min`, `max` | entier | valeur courante et bornes du palier (`cur=4571`, `min=3000`, `max=9000`) |

### 5.5 `currency`

Table à clé **chaîne** = nom localisé de la monnaie (l'addon n'a pas toujours d'ID,
`Data.lua:281`). Seules les monnaies de quantité > 0 sont conservées.
Valeur : `{ qty, max, icon }`. Une seule monnaie observée (`Faveur marchande`).

### 5.6 `bags` / `bank`

Table `{ [itemKey] = quantité }`. `itemKey` est une **chaîne** : `"<itemID>"` ou
`"<itemID>:<suffixe>"` pour les objets à suffixe aléatoire (`Data.lua:93`) — aucun suffixe
dans les fichiers analysés. 13 à 41 clés par personnage.

`bagSlots` / `bankSlots` : `{ used, total }`.

Les métadonnées (nom, qualité, icône, lien) ne sont **pas** dans le personnage : elles sont dans
`AltBoardDB.items[itemKey]`.

## 6. Référentiel `items`

Table à clé `itemKey`, partagée par tous les personnages du compte (357 et 143 entrées).

| Champ | Type | Signification |
|---|---|---|
| `n` | chaîne | nom localisé |
| `q` | entier | qualité |
| `i` | entier | icône |
| `l` | chaîne | lien d'objet |
| `pending` | booléen | présent si le nom n'était pas encore chargé — 0 occurrence observée |

## 7. Comportement de l'addon ayant un impact sur la synchronisation

- **Collecte du personnage connecté uniquement** (`Data.lua:1`) : les autres personnages gardent
  leurs dernières valeurs connues. `lastSeen` est donc propre à chaque personnage.
- **Écriture disque** : le client n'écrit `AltBoard.lua` qu'au `/reload`, à la déconnexion ou à la
  fermeture du jeu. Les données ne sont jamais en temps réel.
- **Horodatages partiels** : `statsAt`, `bagsAt`, `bankAt` datent chaque bloc séparément.
  La banque n'est lue que guichet ouvert.
- **Suppression** : un personnage supprimé dans l'addon (`Data.Delete`, `Data.lua:532`) disparaît
  du fichier. Sa disparition du fichier ne prouve pas sa suppression en jeu.
- **Ordre des clés instable** (mesuré, `.bak` → courant) : d'une sauvegarde à l'autre, le client
  réécrit les clés de `stats`, `profs` et `reps` dans un ordre différent, y compris pour les
  personnages non joués. Comparés sans tenir compte de l'ordre, 4 personnages non joués sur 4 sont
  **strictement identiques** ; le seul personnage joué (niveau 8 → 10) change `level`, `xp`, `xpMax`,
  `rested`, `money`, `ilvl`, `gear`, `stats`, `reps`, `bags`, `bagSlots`, `zone`, `guild`, `lastSeen`.
  Tout hash doit donc être calculé sur une forme **canonique** (clés triées), jamais sur le texte brut.
- **Multi-PC** : les `SavedVariables` sont locales à chaque PC. Deux PC peuvent détenir des versions
  d'âges différents du même personnage ; `lastSeen` permet de départager.
- **Identité relevée trop tôt** (WoW Forever, constaté le 2026-11-27) : l'identité (`level`, `xp`,
  `xpMax`, `rested`, `guild`) n'est relue qu'aux événements de connexion, de niveau, d'expérience et
  de guilde, une seconde après chacun. Juste après un passage de niveau, le client peut encore
  donner l'ancien niveau, une expérience 0 / 0 et aucune guilde. Sans expérience gagnée ensuite (des
  heures de cueillette, par exemple), le fichier garde cet état : Aekiss Valtharion, au niveau 49
  selon Allemano Ledger, restait au niveau 48, en 0 / 0 et sans guilde. Le site 0.37.3 corrige à la
  réception (`web/src/lib/sync/identity.ts`) :
  - le niveau en cours d'Allemano Ledger remplace un niveau d'AltBoard plus bas ;
  - l'expérience devient inconnue, ou reste celle déjà connue quand le niveau n'a pas changé ;
  - la guilde et l'expérience reposée déjà connues restent, au lieu d'un départ de guilde fictif.

  Une expérience 0 / 0 n'est jamais réelle et suit la même règle, même sans Ledger.

## 8. Données demandées par le cahier des charges mais absentes d'AltBoard

| Donnée | Constat |
|---|---|
| Genre du personnage | absent |
| Région du royaume | absente |
| Quêtes, recettes | absentes |
| Nom des enchantements | absent (ID seulement, dans le lien) |
| Identité du compte | absente du fichier — uniquement le nom du dossier |
| Version de l'addon | absente du fichier — à lire dans le `.toc` |
| Historique | absent — l'addon ne garde que l'état courant |
| Temps de jeu, temps par niveau | absents — fournis par l'addon Allemano Ledger, voir [LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md) |

## 9. Checkpoint A

| Question | Réponse |
|---|---|
| Machine identifiable ? | ✅ oui, par `machine_uuid` généré par l'agent |
| Compte identifiable ? | ✅ oui, par le nom du dossier `WTF\Account\<COMPTE>` |
| Royaume identifiable ? | ✅ oui, `realm` normalisé (+ ID serveur dans le GUID) |
| Personnage identifiable ? | ✅ oui, par GUID |

Aucune ambiguïté : le checkpoint A est franchi.
