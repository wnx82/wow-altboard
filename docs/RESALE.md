# Revente (EZAuctioneer)

La page **Revente** (`/resale`, menu Économie, site 0.37.0) suit l'achat-revente fait avec l'addon
EZAuctioneer : objets achetés pour être revendus, mises en vente, ventes, invendus, et les affaires
que l'addon repère à chaque scan de l'hôtel des ventes. Les données arrivent avec l'agent 0.11.0 ;
le format du fichier de l'addon est décrit dans [EZAUCTIONEER-DATA-MODEL](EZAUCTIONEER-DATA-MODEL.md).

## Ce que l'agent envoie

Dans le bloc `ezAuctioneer` de chaque compte ([API](API.md#scans-ezauctioneer-facultatif)) :

- `portfolios` : un portefeuille par personnage (`EZAuctioneerDB.portfolio`), clé
  `<région>:<royaume>:<personnage>` (royaume vide quand l'addon ne le connaissait pas encore) :
  - `stats` : bilan cumulé de l'addon (gain réalisé, ventes, commissions, invendus, dépôts perdus,
    issues inconnues) ;
  - `positions` : objets détenus pour la revente (quantité, coût d'achat total, unités en vente) ;
  - `auctions` : annonces suivies jusqu'à leur issue (prix unitaire, dépôt, commission, marché) ;
  - `log` : journal des opérations (`buy`, `post`, `sale`, `pending`, `expire`, `cancel`, `unknown`,
    `remove`), 200 entrées au plus côté addon.
- `deals` : par marché, les affaires du dernier scan (`markets[…].lastDeals`, 150 au plus), dans
  l'ordre de l'addon : coût d'achat des lots, prix de revente visé, profit et rendement estimés en
  jeu, état de l'annonce au dernier contrôle.

Les noms d'objets et les liens du jeu ne sont pas transmis : la page prend le nom et l'icône dans le
référentiel du site. Les réglages de l'addon ne sont pas transmis non plus.

## Ce que le serveur en fait

Traitement : `web/src/lib/sync/resale.ts`, dans la transaction de la synchronisation.
`EZAuctioneer.lua` est propre à chaque PC : les portefeuilles sont rangés par compte **et par PC**,
et le fichier d'un PC fait foi pour les siens, comme les finances d'Allemano Ledger. Un personnage
joué sur deux PC a donc deux portefeuilles, additionnés sur la page.

| Donnée | Règle |
|---|---|
| Portefeuille | Une ligne par `(compte, PC, clé)` dans `resale_portfolios`. Le bilan est remplacé à chaque envoi de ce PC |
| Personnage | Retrouvé parmi les personnages du compte : nom exact, sinon prénom. Sur WoW Forever, AltBoard enregistre « prénom nom » et EZAuctioneer le prénom seul, qui n'est pas unique : laissé vide si aucun ou plusieurs personnages correspondent. Le royaume d'EZAuctioneer n'est pas celui d'AltBoard et ne sert pas |
| Positions, annonces | Remplacées à chaque envoi (`resale_positions`, `resale_auctions`) |
| Journal | Ajouté sans doublon (`resale_events`) : il s'accumule au-delà des 200 entrées de l'addon. Identité : empreinte du contenu de l'entrée et rang parmi les entrées identiques du même envoi, deux achats identiques à la même seconde restant deux achats |
| Portefeuille absent de l'envoi | Portefeuille de ce PC : bilan remis à zéro, positions et annonces effacées ; le journal reste. L'agent omet un portefeuille vide et envoie toujours la liste, vide au besoin |
| Bloc sans `portfolios` | Agent antérieur à 0.11.0 : rien n'est touché |
| Affaires | Remplacent la liste du marché (`resale_deals`), sauf si la liste en place vient d'un scan plus récent |

La réponse de `POST /api/sync` ajoute `resalePortfolios` (portefeuilles reçus), `resaleEvents`
(entrées nouvelles du journal) et `resaleDeals` (affaires enregistrées).

## La page

Calculs : `web/src/lib/resale/view.ts` (sans base) et `web/src/lib/resale/load.ts`.

- **Gain réalisé**, ventes, commission, invendus, issues inconnues : somme des bilans de l'addon.
- **Capital engagé** : coût d'achat des positions.
- **Valeur du stock** : quantité × valeur de marché du site (médiane des plus bas journaliers,
  la même que la colonne « Valeur détenue » de la page Marché, voir
  [ECONOMY-ENGINE](ECONOMY-ENGINE.md)). Une variante (`i:4306:s1019`) prend le prix de son objet.
- **Plus-value latente** : valeur du stock, commission de l'hôtel des ventes déduite (réglage
  `auction_cut_percent`), moins le coût, sur les seules positions dont le prix est connu.
- **Annonces en cours** : prix demandé et écart au prix du marché.
- **Résultat par objet**, tiré du journal reçu : achats, ventes, produit brut, commission, gain
  (calculé par l'addon : produit − commission − coût d'achat des unités vendues), dépôts perdus des
  invendus et annulations. Coût d'achat des unités vendues : produit − commission − gain.
  Rendement : (gain − dépôts perdus) / coût d'achat des unités vendues, sans vente : aucun.
- **Journal** : les 60 dernières opérations, tous personnages.
- **Affaires repérées en jeu** : les 25 premières de chaque marché, calculs de l'addon repris tels
  quels.

Une issue inconnue est une annonce disparue sans notification (fin pendant que le personnage était
déconnecté) : l'addon ne sait pas si elle a été vendue, et ne compte pas son dépôt.

## Limites

- Le bilan cumulé est celui de l'addon : une remise à zéro dans l'addon remet la page à zéro, mais
  le journal déjà reçu reste.
- Le résultat par objet ne couvre que le journal reçu par le site : les opérations antérieures à
  l'agent 0.11.0 et sorties des 200 entrées de l'addon sont perdues.
- Deux comptes peuvent avoir un personnage du même nom : chaque portefeuille reste rattaché à son
  compte.
- Un objet acheté sur un PC et vendu depuis un autre reste en position dans le fichier du premier :
  l'addon de chaque PC ne voit que ce qui s'y passe.
