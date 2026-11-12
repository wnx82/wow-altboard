# Moteur économique

Calculs déterministes sur les relevés reçus : mêmes relevés, mêmes résultats. Aucune valeur
n'est inventée : un prix, un volume ou un po/h absent reste absent, et la décision est alors
« attendre ». Code : `web/src/lib/economy/`. Sources des données :
[AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md), [PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md),
inventaires d'[ALTBOARD-DATA-MODEL](ALTBOARD-DATA-MODEL.md).

```
PostgreSQL → load.ts (requêtes, nombre fixe) → prices / craft / farm / opportunities (fonctions pures)
           → runs.ts (calcul conservé) → pages · facts.ts (JSON) → assistant facultatif (explication)
```

## Fenêtre et début de l'historique

- Fenêtre lue : 60 jours (30 jours de statistiques, 30 de plus pour la variation sur 30 jours).
- **Début de l'historique** : réglage de la page Paramètres, sinon la date limite de la
  réinitialisation des personnages. Les jours antérieurs (économie de la bêta) sont ignorés.
- « Aujourd'hui » se compte dans le fuseau Europe/Brussels, comme les jours d'Auctionator.

## Prix (`prices.ts`)

Prix de référence d'un jour : son **plus bas** (plus bas des prix minimums vus ce jour-là).

| Statistique | Règle |
|---|---|
| Dernier prix | `m` d'Auctionator, s'il date d'après le début de l'historique |
| Valeur de marché | médiane des plus bas sur 14 jours ; sur 30 à défaut ; **au moins 3 jours**, sinon « insuffisant » |
| Médianes | 7 et 30 jours |
| Variations | dernier jour relevé contre : le jour relevé précédent (1 j) ; le dernier relevé d'au moins 7 ou 30 jours plus tôt |
| Volatilité | 1,4826 × MAD ÷ médiane des plus bas sur 30 jours (3 jours au moins) |
| Liquidité | quantité médiane en vente sur 30 jours : élevée ≥ 50, moyenne ≥ 10, faible en dessous |
| Prix anormal | écart robuste du dernier prix à la médiane des jours précédents (en MAD) au-delà de 3,5 |

### Confiance (0 à 100)

Moyenne géométrique pondérée de quatre facteurs entre 0 et 1 ; un facteur nul l'annule.

| Facteur | Poids | Règle |
|---|---|---|
| Historique | 30 % | jours relevés sur 30, plein à 7 jours |
| Fraîcheur | 30 % | plein jusqu'à 1 jour sans relevé, nul à 10 jours |
| Volume | 20 % | quantité médiane : 0,15 à 2 ou moins, échelle logarithmique jusqu'à 1 à 20 ; 0,5 si inconnue |
| Stabilité | 20 % | volatilité : 1 jusqu'à 15 %, 0,2 au-delà de 100 % ; 0,4 si inconnue |

Plafond à **30** pour un marché à une ou deux unités en vente, et pour un objet relevé moins de
trois jours : jamais assez pour décider seul.

### Valeur des inventaires (`loadMarketValues`)

Depuis le site 0.20.0, la page Inventaires et la fiche d'un personnage estiment les objets
détenus à leur **valeur de marché** sur l'hôtel des ventes relevé le plus récemment, arrondie au
cuivre, **commission non déduite** : la même règle que la colonne « Valeur détenue » du Marché.
Un objet sans valeur de marché n'est jamais valorisé ; le total indique combien d'exemplaires il
laisse de côté. Le tri « Valeur » range ces objets en dernier.

## Craft (`craft.ts`)

Pour chaque recette connue d'au moins un personnage :

- **Composant** : prix du marchand s'il est connu et moins cher que le marché (source « marchand »,
  confiance 100) ; sinon valeur de marché (« hôtel des ventes ») ; sinon « inconnu ».
- **Coût d'opportunité** : un composant possédé coûte ce qu'il rapporterait vendu ; il n'est
  jamais compté gratuit.
- **Produit net** = valeur de marché du produit × quantité × (1 − commission). Commission : 5 % par
  défaut, réglable.
- **Profit** = produit net − coût ; **profit prudent** avec, pour chaque composant, le plus cher
  de sa valeur de marché et de son dernier prix vu.
- **Faisable** : fabrications possibles avec les stocks (sacs et banques), composants de marchand
  achetés.

| Décision | Condition |
|---|---|
| Attendre | prix inconnu, historique de moins de 3 jours, confiance < 35, ROI < 10 %, ou perte au prix prudent |
| Ne pas crafter | profit ≤ 0 |
| Vendre les compos | profit ≤ 0, composants possédés, et leur vente rapporte plus que le produit |
| Crafter | profit > 0, ROI ≥ 10 %, profit prudent ≥ 0, confiance ≥ 35 |

Confiance d'un craft : la plus faible de celles du produit et des composants. Chaque décision
porte ses raisons (`REASON_LABELS`). Le profit passé d'une recette est recalculé jour par jour au
plus bas du jour, seulement les jours où le produit et chaque composant ont été relevés.

## Farm (`farm.ts`, `sessions.ts`)

- **V1, signal de marché** (composants des recettes connues, hors marchand) : score sur 100 =
  50 % prix au-dessus de la médiane 30 jours (de −10 % à +40 %), 25 % offre inférieure à
  l'habitude, 25 % stabilité. **Ce n'est pas un rendement** : aucun po/h n'en est déduit.
- **V2, sessions** : la session part du dernier relevé des sacs et de la banque d'un personnage, et
  se termine sur un relevé plus récent (sinon elle est refusée). Durée = écart entre les deux
  relevés des sacs (`bagsAt`). Différence d'objets (sacs et banque confondus) valorisée à la
  valeur de marché actuelle, commission déduite ; un objet sans prix est listé, jamais valorisé.
  po/h = (argent gagné + objets) × 3600 ÷ durée. Une seule session ouverte par personnage
  (index unique). Comparaisons par libellé (zone, métier, ressource) et par personnage.

## Opportunités (`opportunities.ts`, `runs.ts`)

| Type | Condition |
|---|---|
| Crafter / Transformer | décision Crafter ; Transformer si la recette n'a qu'un composant |
| Ne pas crafter | décision Ne pas crafter ou Vendre les compos, confiance ≥ 50 |
| Vendre | objet possédé, dernier prix ≥ médiane 30 j + 10 %, marché liquide, prix non anormal |
| Garder | objet possédé, dernier prix ≤ médiane 30 j − 15 % |
| Acheter | composant d'un craft rentable, dernier prix ≤ médiane 30 j − 20 %, marché liquide |
| Farmer | signal de farm ≥ 60 |

Vendre, garder, acheter et farmer exigent une confiance ≥ 50 et une valeur de marché (3 jours
au moins). Classement : gains attendus pondérés par la confiance, crafts à éviter en fin de liste.

Chaque opportunité porte sa valeur en pièces de cuivre, son horizon, sa confiance, ses raisons et
ses **entrées** (valeurs utilisées, dernier jour relevé). Le calcul est conservé
(`opportunity_runs`, `opportunities`) et **réutilisé** tant que sa base ne change pas : même
version du moteur (`ENGINE_VERSION`), même dernier import, même dernière synchronisation, mêmes
paramètres (dont la date du jour).

## Faits et assistant (P11)

- `GET /api/economy/facts` (session requise) : faits structurés du moteur — marché et date du
  dernier relevé, calcul d'opportunités, meilleurs crafts, hausses, baisses, prix anormaux,
  signaux et sessions de farm — avec les règles que toute explication doit suivre.
- Assistant **facultatif, désactivé par défaut**. Deux fournisseurs :
  - **Claude** : `WOW_AI_PROVIDER=anthropic` et `WOW_AI_API_KEY`. Il passe par l'API Messages
    d'Anthropic, avec le SDK officiel. Le modèle par défaut est `claude-opus-5-5`, avec un effort
    `medium`. Si les filtres de sécurité déclinent une question, l'API la repose au modèle de
    repli recommandé.
  - **API « chat completions » compatible OpenAI** (Ollama, LM Studio…) : `WOW_AI_URL` et
    `WOW_AI_MODEL`, `WOW_AI_API_KEY` en option. `WOW_AI_REASONING_EFFORT` (`none`, `minimal`,
    `low`, `medium` ou `high`) est transmis tel quel en `reasoning_effort` ; une autre valeur
    désactive l'assistant. Une réponse coupée par le serveur (contexte plein) est refusée, avec
    sa cause. La page Opportunités sonde ce serveur (`GET /models`, 3 s) sans retarder le reste
    de la page : machine éteinte ou injoignable, elle le dit, masque le formulaire et propose
    « Réessayer ». Toute réponse HTTP vaut serveur allumé. Une question posée pendant une panne
    reçoit sa cause : serveur injoignable, connexion coupée ou délai dépassé.

  Il ne reçoit que ces faits, jamais la base ni du SQL. Toute réponse qui cite un nombre absent des
  faits et de la question est **refusée** (petits entiers jusqu'à 10 exceptés). 10 questions par
  10 minutes et par utilisateur.
- **Audit du jour**, affiché « Analyse IA du marché » en tête de la page Opportunités, avec le bouton
  **Lancer l'analyse IA** (`daily-audit.ts`) : sur demande, l'assistant rédige un bilan
  du marché en cinq points : fraîcheur des relevés, meilleures opportunités et leur confiance,
  crafts à éviter, mouvements notables (constats) et limites des faits. Mêmes faits, même
  vérification des nombres. Un audit par marché et par jour (Europe/Brussels), conservé dans
  `economy_audits` avec le calcul dont il vient. Le relire ne rappelle pas l'assistant ; le
  réécrire remplace celui du jour, et un audit refusé laisse le précédent en place. La page montre
  les 8 derniers audits et signale celui du jour s'il repose sur un calcul remplacé depuis.
  5 rédactions par 10 minutes et par utilisateur. Essai réel le 2026-11-08 (qwen3.5:9b, Ollama,
  `reasoning_effort` `none`) : 14 à 22 s, aucun nombre hors des faits.

## Alertes de prix (`alerts.ts`)

Sur la fiche d'un objet, deux seuils facultatifs par marché : **prévenir sous** et **prévenir
au-dessus de**, saisis en or (« 12,5 ») ou en unités (« 12 po 50 pa »), relus par
`money-input.ts`. Ils sont comparés au dernier prix relevé (`market_item_latest`) : un seuil bas se
déclenche au prix égal ou inférieur, un seuil haut au prix égal ou supérieur. Un prix antérieur au
début de l'historique ne compte pas. Le seuil bas doit rester sous le seuil haut ; 500 alertes au
plus. Rien n'est conservé de l'état : il se recalcule à chaque affichage, sur la fiche de l'objet,
dans la liste **Alertes de prix** de la page Marché (retrait sur place, badge « alerte » dans le
tableau) et dans le bloc **À surveiller** de l'accueil. Aucune notification.

## Noms des objets (`item-names.ts`)

L'addon ne nomme que les objets vus dans un inventaire (table `items`). Les autres prennent le nom
de la table `ItemSparse` du jeu, que wago.tools publie pour chaque version du client WoW Forever
(produit `wowf`, en `frFR`). Depuis le site 0.13.0, le serveur lance l'import seul
(`item-names-runtime.ts`, démarré par `instrumentation.ts`) : une minute après son démarrage, puis
chaque jour, il lit la dernière version (`/api/builds/wowf/latest`) et ne télécharge son fichier CSV
(5,5 Mo et 19 324 objets pour 1.60.1.70862) que si cette version n'est pas déjà importée. Un seul
import tourne à la fois ; **Paramètres → Noms des objets** en force un. Le
nom de l'addon reste prioritaire ; une clé `g:1234:60` prend le nom de `1234`, une mascotte
(`p:…`) ou une clé à suffixe de l'addon (`1234:567`) n'en reçoit pas. Les noms servent au Marché,
au Craft, au Farm, aux Opportunités, aux faits de l'assistant et aux libellés des objectifs.

Depuis le site 0.19.0, le même contrôle importe ensuite les **noms des icônes** (`icon-files.ts`,
table `icon_files`) : la table `ManifestInterfaceData` de la même version (8,8 Mo, 30 167 icônes
pour 1.60.1.70888), dont seuls les fichiers de `Interface\ICONS\` à nom simple sont gardés. L'addon
relève l'icône d'un objet par son identifiant de fichier ; ce nom donne l'adresse de l'image sur le
CDN de Blizzard (`render.worldofwarcraft.com`, par l'optimiseur d'images). Les icônes propres à WoW
Forever y manquent : la page Inventaires affiche alors le point d'interrogation du jeu.

Depuis le site 0.20.0, il importe aussi la table `Item` (1,4 Mo, table `item_icons`) : l'icône
de chaque objet, y compris ceux que l'addon n'a jamais relevés. Une icône se cherche d'abord dans
`items.icon` (addon), puis dans `item_icons` par l'identifiant de base de la clé (`1234`,
`1234:567` et `g:1234:60` prennent celle de `1234` ; une mascotte `p:…` n'en a pas). Les deux
tables sont remplacées dans la même transaction ; un échec du téléchargement de `Item` laisse les
icônes déjà importées intactes. Les icônes accompagnent le nom des objets sur les pages de
l'économie, la page Inventaires, la fiche d'un personnage et la recherche globale.

Depuis le site 0.21.0, le contrôle importe ensuite les **caractéristiques des armures et des
armes** (`item-specs.ts`, table `item_specs`), pour les filtres d'équipement de la page
Inventaires. Le type et l'emplacement viennent de la table `Item` de WoW Forever (19 079
équipements en 1.60.1). Sa table `ItemSparse` ne décrit qu'une partie des objets, le serveur
envoyant les autres au client : niveau d'objet, niveau requis et classes autorisées viennent
d'elle quand elle les a (7 848), sinon de la table `ItemSparse` de WoW Classic Era (9 219), dont
le niveau requis est le même pour 99 % des 5 720 objets que les deux tables partagent. Les
objets propres à WoW Forever absents des deux (un sur huit des équipements détenus le
2026-11-13) gardent leur type mais n'ont pas de niveau : un filtre de niveau les écarte. Un
import a lieu quand l'une des deux versions change.

Les filtres « Pour » suivent les règles de port de WoW Classic (`gear.ts`) : armes que chaque
classe peut apprendre, cuir sans mage, prêtre ni démoniste, mailles pour le chasseur et le
chaman et plaques pour le guerrier et le paladin à partir du niveau 40, boucliers pour le
guerrier, le paladin et le chaman, reliques pour leur classe, puis les classes autorisées par
l'objet. Pour une classe, tout ce qu'elle pourra porter ; pour un personnage, ce qu'il peut
porter à son niveau (niveau requis et niveau 40 compris).

L'agent 0.7.0 complète ces noms avec ceux du cache local du client (`DBCache.bin`), envoyés à la
synchronisation quand ce cache change (`storeClientNames`). Ce sont les enregistrements que le
serveur du jeu a transmis au client, correctifs compris : plus récents que la table de wago.tools,
ils la remplacent (source `client`, qualité déjà connue gardée), et un import wago.tools ne les
écrase pas. Seule la langue `frFR` est retenue. Sur les données réelles du 2026-11-09, wago.tools
seul nomme 59 % des objets d'Auctionator ; avec le cache, 98,5 %.

## Limites connues

- Granularité journalière : pas de prix « 24 h » ni d'heure de scan, pas de nombre d'enchères.
- Un scan partiel fait un jour à peu d'objets : la page Audit le signale (moins de la moitié des
  objets habituels).
- Noms d'objets jamais possédés : ceux de wago.tools, réimportés chaque jour quand une nouvelle
  version du jeu est publiée. La table publiée peut écrire un nom autrement que le jeu (« Etoffe de
  lin » sans accent).
- Le moteur ne connaît que les recettes relevées par NaowhForever.
