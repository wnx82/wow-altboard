# Journal des modifications

Deux versions, chacune en SemVer : le **site** (`web/package.json`) et l'**agent**
(`agent/Directory.Build.props`, étiquette `agent-vX.Y.Z` pour une release). Le pied de page du
tableau de bord affiche les deux. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## Site 0.24.0 — 2026-11-13

### Ajouté

- **Caractéristiques des objets dans les bulles**, comme sur Wowhead : niveau d'objet, liaison,
  emplacement et type, dégâts, vitesse et dégâts par seconde, armure, caractéristiques,
  résistances, durabilité, niveau requis, effets « Équipé », « Utilise » et « Chances quand vous
  touchez », ensemble (pièces et bonus), objet créé par une recette et ses composants, prix de
  vente. Les valeurs sont celles de WoW Forever, suffixes aléatoires compris (« de l'ours ») ;
  les couleurs sont celles du jeu. Sur les pages Inventaires (les deux présentations), la fiche
  d'un personnage et la page Équipement.
  - Lues chez Wowhead (base WoW Forever, en français) à la première ouverture d'une bulle, puis
    gardées en base 30 jours : seul le numéro de l'objet est envoyé. Une bulle épinglée mène à la
    fiche Wowhead de l'objet.
  - Objet que Wowhead ne décrit pas encore (les plus récents de WoW Forever) : la bulle garde les
    lignes tirées des tables du jeu et le signale.
- Route `GET /api/items/tooltip` et migration `0019_item_tooltips` (table `item_tooltips`, ajout
  seul).

### Modifié

- La page Inventaires est **rangée par catégorie par défaut**, comme les sacs du jeu ; les autres
  tris restent au menu « Trier par » (`?tri=quantite` pour l'ancien ordre).
- Présentation par catégorie : une fenêtre par groupe (Équipement, Consommables, Artisanat,
  Autres) avec son nombre d'objets et sa valeur ; chaque catégorie montre son nombre d'objets et sa
  valeur, et se replie d'un clic. Un lien du sommaire rouvre la catégorie repliée qu'il vise.

## Site 0.23.0 — 2026-11-13

### Ajouté

- **Page Équipement** (`/gear`, menu Personnages) : pour une classe ou un personnage et un niveau
  de 1 à 60, le meilleur équipement en réserve chez tous les personnages, emplacement par
  emplacement, comme sur la fiche du jeu.
  - Choix par médaillons de classe ou par personnage (son niveau par défaut), curseur de niveau,
    lieux fouillés (sacs, banque, courrier, banques de guilde ; enchères en option). L'adresse
    garde le choix (`?pour=guerrier&niveau=45`).
  - Chaque emplacement montre le meilleur objet (deux pour les doigts et les bijoux, le même
    s'il est détenu en deux exemplaires), son détenteur et l'endroit, puis quatre autres choix
    repliés. La bulle du jeu donne le détail.
  - Seul ce que la classe porte à ce niveau compte : niveau requis, mailles et plaques au
    niveau 40, armes apprises, boucliers, ambidextrie (voleur 10, guerrier et chasseur 20 ; une
    arme à une main peut alors aller en main gauche, sans être proposée deux fois), reliques. Un
    objet lié quand ramassé ne compte que chez son détenteur.
  - Classement par niveau d'objet ; une armure plus légère que celle de la classe perd dix
    niveaux par rang (un guerrier de niveau 45 préfère des plaques 33 à des mailles 40). Option
    « Armure en plaques seulement ».
  - Pour un personnage : ce qu'il porte, l'écart avec l'objet porté (+8, mesuré comme le
    classement) et l'option « Améliorations seulement ».
- La bulle d'un objet indique sa liaison : lié quand ramassé, quand équipé, quand utilisé, objet
  de quête.
- Migration `0018_item_specs_bonding` : colonne `bonding` de `item_specs`, tirée de la table
  `ItemSparse` ; les lignes existantes sont reprises par l'import suivant, au démarrage.

### Modifié

- Page Inventaires plus proche du jeu : les filtres forment une fenêtre en rangées titrées
  (Afficher, Équipement, Chercher dans) ; le sommaire et les titres des catégories portent une
  icône du jeu.

## Site 0.22.0 — 2026-11-13

### Ajouté

- **Catégories sur la page Inventaires**, comme le rangement des sacs du jeu : armes, armures, sacs
  et carquois, nourriture et boissons, potions, élixirs et flacons, parchemins, bandages,
  améliorations d'objets, flèches et balles, tissu, cuir, métal et pierre, viande et poisson,
  herbes, élémentaire, enchantement, pièces et explosifs, recettes, réactifs, quête, clés,
  mascottes et montures, divers et camelote (tout objet gris).
  - Nouveau tri « Catégorie » (`?tri=categorie`). Dans « Tous les objets », la grille se découpe
    en sections titrées, avec un sommaire pour sauter de l'une à l'autre ; dans une section, la
    meilleure qualité d'abord. Dans « Sac par sac », les cases suivent le même ordre.
  - Nouveau filtre « Catégorie » (`?cat=cuir`), limité aux catégories des objets détenus.
- Le contrôle quotidien de wago.tools importe la classe et la sous-classe de tous les objets,
  plus seulement des armures et des armes.
- Migration `0017_item_specs_all_items` : la table `item_specs` accepte tous les objets ; ses
  lignes sont reprises par l'import suivant, au démarrage, même avec Classic Era injoignable (les
  niveaux déjà pris dans Classic Era restent).

## Site 0.21.0 — 2026-11-13

### Ajouté

- **Filtres d'équipement sur la page Inventaires** (ligne « Équipement » des filtres) :
  - **type** d'armure (tissu, cuir, mailles, plaques, boucliers, bijoux et divers, reliques) ou
    d'arme (épées, haches et masses à une ou deux mains, dagues, armes de pugilat et d'hast, bâtons,
    arcs, armes à feu, arbalètes, baguettes, armes de jet, cannes à pêche) ;
  - **emplacement** (tête, torse, mains, doigt…) ;
  - **tranche de niveau requis** (de … à …) ;
  - **pour** une classe (tout ce qu'elle peut apprendre à porter) ou pour un personnage (ce qu'il
    peut porter à son niveau, mailles et plaques au niveau 40 comprises) ;
  - nouveau tri « Niveau requis ». Tous ces filtres se gardent dans l'adresse
    (`?type=cuir&nmin=20&nmax=30&pour=chasseur`).
- **Bulle d'objet** : emplacement et type, classes autorisées, niveau requis et niveau d'objet,
  comme en jeu, sur la page Inventaires et dans l'inventaire de la fiche d'un personnage.
- Le contrôle quotidien de wago.tools importe les caractéristiques des armures et des armes : type
  et emplacement de WoW Forever, niveaux et classes de WoW Forever ou, à défaut, de WoW Classic Era
  (sans Classic Era joignable au premier import, WoW Forever seul, complété ensuite).
  Les objets propres à WoW Forever dont aucun niveau n'est publié sont signalés sous la grille
  quand un filtre de niveau est actif.
- Migration `0016_item_specs` : table `item_specs` (ajout seul).

## Site 0.20.0 — 2026-11-12

### Ajouté

- **Valeur des inventaires.** Chaque objet est estimé à sa valeur de marché sur l'hôtel des ventes
  relevé le plus récemment, commission non déduite, comme la colonne « Valeur détenue » du Marché.
  - La bulle d'objet affiche le prix unitaire et la valeur de la pile. Épinglée, elle mène au cours
    de l'objet au marché.
  - Total estimé en tête de la page Inventaires, puis par personnage et par banque de guilde dans la
    vue sac par sac. Les exemplaires sans prix connu ne sont pas comptés ; le total le signale.
  - Nouveau tri « Valeur » (`?tri=valeur`) : les objets sans prix passent en dernier.
- **Échéances proches.** Un courrier ou une vente qui expire dans les 3 jours porte le temps restant
  au coin de sa case (« 20 h », « 2 j »). Bouton « Bientôt échus » (`?bientot=1`) sur la page
  Inventaires. Sur l'accueil, le bloc « À surveiller » liste le courrier à récupérer, avec un lien
  vers les objets concernés.
- **Recherche globale** : loupe dans l'en-tête, ou Ctrl+K (⌘K sur Mac). Personnages, objets
  (possédés d'abord, puis ceux déjà vus à l'hôtel des ventes) et pages du menu, sans tenir compte
  des accents ; flèches et Entrée au clavier. Route `GET /api/search`.
- **Icônes des objets partout** : devant les noms d'objets du Marché, du Craft, des Opportunités et
  du Farm, et dans l'équipement d'un personnage. Le contrôle de wago.tools importe aussi la table
  `Item` du jeu, qui donne l'icône des objets que l'addon n'a jamais relevés.
- Migration `0015_item_icons` : table `item_icons` (ajout seul).

### Modifié

- **Fiche d'un personnage** : l'inventaire (sacs, banque, courrier, enchères) s'affiche en fenêtre de
  sac comme sur la page Inventaires, avec la même bulle, une recherche locale, la valeur estimée et
  un lien vers la page Inventaires limitée à ce personnage.
- Sur téléphone, les informations de la fiche d'un personnage passent sous son nom au lieu de
  l'écraser.

## Site 0.19.0 — 2026-11-12

### Modifié

- **Page Inventaires à la manière du jeu.**
  - **Recherche en vedette** : grand champ en tête de page, touche `/` pour s'y placer, croix pour
    l'effacer. Sur téléphone, les filtres se replient derrière un bouton « Filtres ».
  - **Tous les objets** : une grille de cases comme les sacs du jeu, avec l'icône de l'objet, un
    liseré à la couleur de sa qualité (à partir de « peu commun ») et la quantité au coin.
  - **Bulle d'objet** au survol, au clavier ou au toucher : nom à la couleur de la qualité, total,
    puis chaque détenteur (personnage et endroit, ou guilde et onglet) avec sa quantité et
    l'échéance d'un courrier ou d'une vente. Un clic la garde ouverte ; Échap ou un clic ailleurs
    la referme.
  - **Sac par sac** : une fenêtre par personnage (portrait, niveau, royaume) puis par banque de
    guilde, chaque endroit ou onglet en grille de cases. Choisir un personnage ouvre cette vue.
  - Le tri (quantité, nom, qualité) range aussi les cases de chaque endroit.

### Ajouté

- **Icônes des objets** : le contrôle quotidien de wago.tools importe aussi la table
  `ManifestInterfaceData` du jeu, qui relie l'identifiant d'icône relevé par l'addon à son nom. Les
  images viennent du CDN de Blizzard ; une icône propre à WoW Forever, absente de ce CDN, devient le
  point d'interrogation du jeu.
- Migration `0014_icon_files` : table `icon_files` (ajout seul).

## Site 0.18.0 — 2026-11-12

### Ajouté

- **Page Inventaires** (menu Personnages) : tout ce que possèdent les personnages, en une page.
  - **Endroits** : sacs et banque relevés par AltBoard, courrier, ventes en cours et banques de
    guilde relevés par Baganator. Chaque endroit s'active ou se masque d'un bouton.
  - **Par objet** : le total d'un objet, tous détenteurs confondus, puis chaque détenteur
    (personnage et endroit, ou guilde et onglet) avec sa quantité. Tri par quantité, nom ou qualité.
  - **Par personnage** : le contenu de chaque personnage par endroit, avec la date du relevé, puis
    les banques de guilde par onglet, avec leur or.
  - Recherche par nom (sans accent) ou par identifiant, filtres par compte, personnage et qualité
    minimale. Les courriers et ventes dont l'échéance est passée sont masqués (bouton « Échus »).
    L'état des filtres est porté par l'adresse de la page.
- **Fiche d'un personnage** : panneaux « Courrier » et « Enchères en cours », avec l'échéance de
  chaque objet.
- **Objets** : la recherche compte aussi le courrier et les ventes en cours.
- Contrat de `POST /api/sync` : bloc facultatif `baganator` par compte (courrier, ventes, banques de
  guilde), envoyé par l'agent 0.8.0. Voir [BAGANATOR-DATA-MODEL](docs/BAGANATOR-DATA-MODEL.md).
- Migration `0013_baganator_holdings` : tables `character_holdings`, `character_holding_sources`,
  `guild_banks`, `guild_bank_items` (ajouts seuls).

### Déploiement

- Déployer ce site **avant** d'installer l'agent 0.8.0 sur les PC : un serveur antérieur refuse le
  bloc `baganator`.

## Agent 0.8.0 — 2026-11-12

### Ajouté

- Lit `Syndicator.lua`, le fichier de l'addon **Baganator** : courrier, ventes en cours et banques
  de guilde de chaque compte. Sacs et banque restent ceux d'AltBoard. Fichier facultatif : absent,
  rien ne change ; illisible, un avertissement est joint et la synchronisation continue.
- Syndicator nomme les personnages sans GUID : chacun est rattaché au personnage d'AltBoard du même
  nom sur le compte, le plus récemment vu en cas d'homonymes. Un nom inconnu d'AltBoard n'est pas
  transmis ; un avertissement le signale.
- `scan` affiche le résumé : objets au courrier, objets aux enchères, banques de guilde.
- `watch` synchronise aussi quand `Syndicator.lua` change.
- Exige le site 0.18.0.

## Site 0.17.0 — 2026-11-12

### Ajouté

- **Page Application** (menu Gestion). Elle indique comment installer AltBoard sur l'appareil
  utilisé : le bouton « Installer » quand Chrome est prêt, sinon les étapes pour Android, iPhone ou
  ordinateur. Elle explique aussi les cas où le menu du navigateur ne propose rien : page ouverte
  depuis une autre application, application déjà installée, navigation privée.
- Le **diagnostic** de cette page montre ce que le navigateur dit de l'appareil : navigateur,
  affichage, pointeur, manifeste reçu ou non, service worker, invite de Chrome, application déjà
  installée, bandeau tu. « Copier le diagnostic » le met en texte, pour le transmettre.
- « Réafficher le bandeau » annule un « Compris » ou un « Plus tard ».

### Corrigé

- **Bandeau d'installation absent sur certains téléphones.** Un téléphone à stylet (Galaxy à
  S Pen) annonce un pointeur précis, comme un ordinateur, et le bandeau ne s'affichait jamais. Le
  téléphone est maintenant reconnu aussi par le système que déclare le navigateur.
- Le bandeau se taisait pour toujours après une installation, même si l'application avait été
  désinstallée depuis. Quand Chrome sait dire si l'application est installée, sa réponse
  l'emporte : le manifeste se déclare dans `related_applications`.
- Le bandeau, sans invite de Chrome, renvoie vers la page Application (« Pas dans le menu ? »).

## Site 0.16.0 — 2026-11-11

### Ajouté

- **Bandeaux illustrés WoW Forever.** Les illustrations officielles de World of Warcraft: Forever
  habillent le site : trois peintures et dix-sept paysages du jeu, tirés des annonces de Blizzard.
  - **Page de connexion** : la grande peinture de l'annonce en plein écran, derrière le formulaire
    en verre dépoli.
  - **En-tête de chaque page** : une illustration propre à la page, par exemple des galions au
    couchant pour Finances, un port pour Marché, une forge pour Artisanat. Elle est assombrie du
    côté du titre et apparaît en fondu.
  - **Accueil** : la peinture des héros en grand bandeau, une illustration sur chaque carte du
    podium et un paysage par compte sur les bannières des comptes.
- Les illustrations ne sont pas copiées dans le dépôt. Le serveur les lit sur le CDN de Blizzard,
  les réduit à la taille de l'écran (WebP) et les garde en cache, comme les icônes. Le navigateur
  ne contacte que ce site. Sans elles (CDN injoignable), les bandeaux gardent leur décor sombre.

### Modifié

- Cache de l'optimiseur d'images plafonné à 64 Mo. Les variantes d'images s'arrêtent à 1920 pixels
  de large.

## Site 0.15.1 — 2026-11-11

### Corrigé

- **Bandeau d'installation absent sur téléphone.** Chrome ne propose l'installation qu'après trente
  secondes de visite et un appui, et d'autres navigateurs jamais. Sans cette proposition, le bandeau
  indique désormais le chemin au bout de huit secondes : menu ⋮ puis « Installer l'application »
  (sur iPhone : Partager puis « Sur l'écran d'accueil »). « Compris » le tait trente jours. Si
  Chrome propose l'installation ensuite, le bandeau passe au bouton « Installer ». Il est aussi
  présent sur la page de connexion, et ne revient plus une fois l'application installée.
- **Pages refaites entièrement à chaque chargement.** Cloudflare remplaçait les adresses e-mail
  (noms des comptes) du HTML par « [email protected] ». React ne retrouvait plus le texte du serveur
  (erreur 418) et reconstruisait toute la page dans le navigateur. Les pages portent maintenant
  `Cache-Control: no-transform`, que Cloudflare respecte.

## Site 0.15.0 — 2026-11-11

### Ajouté

- **Favoris depuis l'accueil** : une étoile à côté du nom de chaque compte, sur Mes personnages,
  l'ajoute aux favoris ou l'en retire en un clic. L'étoile change tout de suite. Les personnages du
  compte passent alors en premier, sous une bannière dorée, ou rejoignent les autres comptes.
- **Filtre « Favoris »** dans la barre de l'accueil : seuls les personnages des comptes favoris
  restent affichés. Le bouton apparaît dès qu'un compte est favori. Sur téléphone, il se réduit à
  l'étoile.
- **La liste de l'accueil garde son état** : la recherche, les filtres, le tri et le filtre
  « Favoris » sont recopiés dans l'adresse (`?q=…&tri=nom&favoris=1`). Ouvrir une fiche puis
  revenir retrouve la liste telle qu'on l'a laissée, et le lien se partage ou se met en signet.
- **Application Android proposée** : sur téléphone, un bandeau « Installer AltBoard » apparaît en
  bas de l'écran dès que Chrome permet l'installation. Installée, l'application a son icône,
  s'ouvre en plein écran et figure parmi les applications du téléphone. « Plus tard » tait le
  bandeau trente jours. Rien n'est proposé sur ordinateur.
- Raccourcis de l'application (appui long sur l'icône) : Objectifs, Opportunités, Finances,
  Serveurs.
- **Page « Hors ligne »** : sans réseau, l'application affiche une page à ses couleurs avec un
  bouton « Réessayer », au lieu de l'erreur du navigateur. Un service worker minimal la sert ; il
  ne met rien en cache, les données restent toujours fraîches.

### Modifié

- Les comptes « mis en avant » s'appellent désormais des **favoris**. Sur la page Comptes, le bouton
  devient « Ajouter aux favoris » ou « Retirer des favoris ». Il réagit aussi dès le clic.

### Sécurité

- CSP : `worker-src 'self'` ajouté. Sans lui, `'strict-dynamic'` aurait refusé le service worker.
  `/sw.js` répond sans session, comme le manifeste : fichier fixe, sans donnée.

### Corrigé

- Un favori qui ne s'enregistre pas le dit. Si le serveur est injoignable, si la base échoue ou si
  le compte a été supprimé entre-temps, l'étoile reprend son état et un court message s'affiche à
  côté. Avant, l'erreur restait muette ou remplaçait toute la page.

## Site 0.14.0 — 2026-11-11

### Modifié

- **Page Finances repensée** :
  - Le bilan de la période est mis en vedette, comparé à la période précédente de même longueur :
    écart en or et en pourcentage, flèche, en vert ou en rouge selon que la nouvelle est bonne.
    Les revenus et les dépenses ont chacun leur écart. Une jauge montre la part des revenus
    repartie en dépenses.
  - Nouveau graphique avec les revenus au-dessus de l'axe et les dépenses en dessous. Le bilan de
    chaque jour (ou mois) y apparaît en repère. Les couleurs or et bleu ont été vérifiées pour la
    vision des couleurs.
  - Trois chiffres marquants : le meilleur jour, le jour le plus coûteux et le personnage le plus
    rentable.
  - Les sources de revenus et de dépenses sont classées en barres, avec montant et part.
  - Le tableau des personnages montre l'icône de classe et la part de chacun dans les revenus.
  - Le meilleur jour est signalé dans le détail. La période se choisit dans l'en-tête.
  - Chiffres clés : bilan moyen par jour joué.

## Site 0.13.0 — 2026-11-10

### Ajouté

- **Noms des objets à jour sans intervention** : le serveur vérifie la dernière version du jeu chez
  wago.tools une minute après son démarrage, puis chaque jour, et importe la table des objets à
  chaque nouvelle version. Plus de « Objet 6264 » sur Craft, Marché ou Opportunités tant que
  wago.tools répond. Le bouton de la page Paramètres force toujours un import.
- **Craft, colonne « Vos composants »** : pour chaque recette, l'état des stocks (tout en stock et
  combien de fois, à compléter chez un marchand, en partie, rien), puis chaque composant avec la
  quantité détenue face à la quantité demandée et ses détenteurs (personnage, sacs ou banque).
  Nouveau filtre « Faisables avec vos stocks », combinable avec la décision.
- **Opportunités « Vendre » et « Garder »** : la quantité détenue et ses détenteurs, au dernier
  relevé, sur la page Opportunités comme à l'accueil ; un objet vendu depuis le calcul est signalé.
- Fiche d'un objet du marché : emplacement du stock de chaque personnage (sacs, banque).

### Modifié

- **Design de toutes les pages** : un en-tête commun (`PageHeader`) avec l'emblème de la rubrique
  du menu (Personnages, Économie, Gestion), le titre agrandi, la présentation dessous, un halo et
  un filet dorés. Chiffres clés avec liseré doré, titres de section prolongés d'un filet, états
  vides avec un sceau, en-têtes de tableau teintés et lignes alternées.
- Fiche d'un personnage : grande icône de la classe en fond de l'en-tête, comme sur le podium.
- Page de connexion : blason, titre et halo doré au-dessus du formulaire.

### Corrigé

- Import des noms : le téléchargement de la table (5,5 Mo) dispose de 5 minutes au lieu d'une ;
  il a pris près de deux minutes sur le serveur de production. Le bouton n'attend plus que
  45 secondes, sous la limite du proxy Cloudflare : au-delà, l'import continue sur le serveur.

## Site 0.12.0 — 2026-11-10

### Ajouté

- **Comptes mis en avant** : bouton bascule « Mettre en avant à l'accueil » sur la page Comptes.
  Sur l'accueil, les comptes mis en avant passent en premier, sous une bannière dorée ; les autres
  suivent sous l'intertitre « Autres comptes ». Le choix survit aux synchronisations.
- **Podium** en tête de l'accueil : les trois personnages les plus hauts (niveau, puis expérience
  gagnée dans le niveau, puis niveau d'objet), la première place au centre. Un personnage masqué
  dans l'addon n'y monte pas. Sa médaille le suit dans les cartes et le tableau.
- Migration `0012_account_featured` : colonne `wow_accounts.featured` (ajout seul, `false` par
  défaut).

### Modifié

- **Accueil redessiné** : nouvel en-tête (nombre de personnages et de comptes, comptes en avant,
  dernière synchronisation, état des serveurs en pastilles), personnages remontés juste après les
  chiffres clés et « À surveiller ». La courbe de l'or, les meilleures opportunités et les frises
  de 24 heures des serveurs passent en bas de page.
- Cartes des personnages : guilde sous le nom, dernière zone connue en pied de carte, médaille
  du podium. En-têtes de compte avec leurs chiffres en pastilles.

## Agent 0.7.1 — 2026-11-09

### Corrigé

- La synchronisation échouait à chaque cycle après la mise à jour depuis l'agent 0.6.0 ou plus
  ancien : « erreur inattendue (ArgumentNullException) : Value cannot be null. (Parameter
  'dictionary') ». Le `state.json` écrit par ces versions n'a pas d'empreinte du cache de noms,
  que l'agent 0.7.0 lisait comme nulle au lieu de vide. Une clé manquante ou nulle de
  `state.json` est maintenant lue comme vide. Remplace la 0.7.0, à ne pas installer.

## Agent 0.7.0 — 2026-11-09

### Ajouté

- Lit les **finances par jour** d'Allemano Ledger (`days`) : revenus et dépenses par source,
  transferts entre personnages, valeur marchande du butin, or en fin de journée, temps connecté.
  800 jours au plus par personnage.
- Lit les **noms des objets** du cache local de chaque client (`Cache\ADB\<langue>\DBCache.bin`,
  langue de `WTF\Config.wtf`) et les envoie quand ce cache a changé (empreinte gardée dans
  `state.json`). Un cache seul modifié ne déclenche pas d'envoi : il part avec le suivant. Cache
  absent ou illisible : avertissement, la synchronisation continue.
- Exige le site 0.11.0 : un serveur antérieur refuse ces nouveaux champs.

## Site 0.11.0 — 2026-11-09

### Ajouté

- Page **Finances** (menu Économie) : revenus, dépenses, bilan, bilan par heure de jeu, butin
  ramassé et transferts entre personnages sur 7, 30 ou 90 jours ou depuis le début ; revenus par
  jour (par mois sur tout l'historique), détail par source, par personnage et par jour. Données
  d'Allemano Ledger, transmises par l'agent 0.7.0.
- Noms des objets du **cache du jeu** envoyés par l'agent 0.7.0 : ils remplacent ceux de
  wago.tools (correctifs du serveur de jeu compris) ; seule la langue du site (`frFR`) est gardée.
  **Paramètres → Noms des objets** en donne le nombre.
- Contrat de `POST /api/sync` : champs facultatifs `finances` (personnage) et `itemNames`
  (document) ; la réponse ajoute `itemNamesStored`.
- Migration `0011_character_ledger_days` : table `character_ledger_days` (ajout seul).

### Déploiement

- Déployer ce site **avant** d'installer l'agent 0.7.0 sur les PC.

## Site 0.10.0 — 2026-11-09

### Ajouté

- **Alertes de prix** : sur la fiche d'un objet, un seuil bas (« prévenir sous ») et un seuil haut
  (« prévenir au-dessus de »), saisis en or (« 12,5 ») ou en unités (« 12 po 50 pa »). Ils sont
  comparés au dernier prix relevé. Une alerte déclenchée s'affiche dans le bloc **À surveiller** de
  l'accueil, en tête de la page Marché (liste des alertes, retrait sur place) et d'un badge dans le
  tableau des objets. Aucune notification.
- **Noms des objets jamais possédés** : **Paramètres → Noms des objets** importe la table des
  objets du jeu publiée par wago.tools pour la dernière version du client WoW Forever, en français
  (19 324 objets pour 1.60.1.70862). Marché, Craft, Farm, Opportunités, l'assistant et les
  objectifs « objet possédé » nomment désormais les objets vus seulement à l'hôtel des ventes ou
  dans une recette. Le nom relevé par l'addon reste prioritaire. La recherche du Marché trouve ces
  objets par leur nom.
- Migration `0010_item_names_price_alerts` : tables `item_names` et `price_alerts` (ajouts seuls).

## Site 0.9.0 — 2026-11-09

### Ajouté

- Accueil : bloc **À surveiller**, calculé à partir des données déjà synchronisées : PC muets depuis
  7 jours, sacs pleins ou à 2 places près, métiers arrivés au maximum de leur palier, équipement
  incomplet (à partir du niveau 10), personnages pas vus en jeu depuis 14 jours, banque jamais
  relevée. Les personnages masqués dans l'addon n'y figurent pas.
- Accueil : courbe de l'**or cumulé** de tous les personnages sur 90 jours. Entre deux relevés,
  chaque personnage garde sa dernière valeur connue.
- Objectifs : progression « Objectifs 2/5 » sur chaque carte, colonne dans le tableau et filtre
  (en cours, tous atteints, sans objectif). Nouvelle page **Objectifs** : un tableau par modèle, ses
  objectifs en colonnes, les personnages en lignes.
- Page **Réputations** : chaque faction avec les personnages qui la connaissent, du meilleur palier
  au moins bon, groupée comme dans le jeu.
- Page **Temps de jeu** : total par compte, résumé des 12 dernières semaines (heures, sessions,
  expérience, répartition par étiquette) et carte jour × heure, à l'heure de Bruxelles.
- Page **Machines** : un PC sans synchronisation depuis 7 jours est signalé (« Muet depuis N
  jours »), avec une liste en tête de page.
- Site installable sur le téléphone : manifeste `app.webmanifest`, icônes (dont une icône
  adaptative et une pour iOS), couleur de thème. Le manifeste et les icônes répondent sans session,
  le système les lisant parfois sans le cookie du site.

## Site 0.8.2 — 2026-11-09

### Ajouté

- Page Comptes : **Supprimer ce compte…** sur chaque fiche. La confirmation rappelle ce qui
  disparaît (personnages et leur historique, relevés de marché, liens aux PC) et redemande le mot de
  passe. Les prix déjà relevés restent. Prévu pour la copie d'un dossier `WTF\Account` vue une
  seule fois ([DATABASE](docs/DATABASE.md#suppression-dun-compte)).

### Modifié

- La réinitialisation des personnages et la suppression d'un compte partagent la même vérification
  du mot de passe, chacune avec son propre compteur de tentatives.

## Site 0.8.1 — 2026-11-08

### Modifié

- Page Machines : le bouton principal **Télécharger AltBoardSync.exe** donne directement
  l'exécutable, sans archive à extraire. L'archive ZIP avec ses instructions reste proposée en lien
  secondaire.

## Site 0.8.0 — 2026-11-08

### Ajouté

- Page Comptes : la **référence complète** de chaque compte (nom du dossier `WTF\Account`,
  « 123456789#1 ») s'affiche dans un badge doré, avec un bouton de copie. Elle arrive avec l'agent
  0.6.0 ; d'ici là, le badge montre le libellé masqué et la mention « masquée ». L'export tableur
  donne la même référence.
- `POST /api/sync` accepte `folderName` par compte. Le serveur vérifie qu'il correspond à
  l'empreinte du compte (`422` sinon) et ne l'efface pas quand un agent plus ancien renvoie le
  compte. Migration `0009_account_folder_name` (ajout de colonne seul).

### Modifié

- Confidentialité : le nom du dossier de compte est désormais transmis et gardé en base, à la
  demande du propriétaire ([SECURITY](docs/SECURITY.md)). Il reste absent des journaux de l'agent
  et des textes envoyés au serveur d'IA.

## Agent 0.6.0 — 2026-11-08

### Ajouté

- Envoie le nom complet du dossier de chaque compte (`folderName`), pour la page Comptes. Un nom
  hors ASCII imprimable n'est pas envoyé : le serveur ne pourrait pas le vérifier.
- Après la mise à jour, chaque compte est renvoyé une fois sans attendre que le jeu réécrive ses
  fichiers.

## Site 0.7.2 — 2026-11-08

### Modifié

- Page Opportunités : l'audit du jour devient **Analyse IA du marché**, en tête de page, juste
  sous le choix du marché. Le bouton **Lancer l'analyse IA** (puis **Relancer**) fait rédiger le
  bilan par le serveur d'IA, et le texte s'affiche aussitôt dessous. Pendant l'analyse, la page
  prévient qu'elle peut durer jusqu'à deux minutes. Serveur d'IA éteint : la section le dit.

### Exploitation

- Page **Serveurs** : deux serveurs de jeu européens surveillés depuis le 2026-11-08,
  `37.244.29.131:3724` (royaume) et `34.187.88.149:3724` (monde), relevés sur un client en jeu
  et saisis dans **Paramètres** ([SERVER-STATUS](docs/SERVER-STATUS.md#adresses-en-service)).

## Site 0.7.1 — 2026-11-08

### Modifié

- Navigation principale en trois groupes déroulants : **Personnages** (accueil, Objets, Métiers,
  Niveaux, Activité), **Économie** (Opportunités, Marché, Craft, Farm, Audit) et **Gestion**
  (Comptes, Machines, Serveurs, Paramètres). L'en-tête tient sur une ligne à toutes les largeurs ;
  le groupe de la page en cours est en or, avec le nom de la page sur grand écran. Sur téléphone,
  un seul bouton, nommé d'après la page, ouvre les trois groupes. Une liste se ferme au choix
  d'une page, à un clic ailleurs, avec Échap ou quand le focus quitte la navigation.

## Site 0.7.0 — 2026-11-08

### Ajouté

- **Objectifs** par personnage, en tête de sa page : manuels (cochés à la main) ou automatiques,
  cochés seuls à la synchronisation et datés (niveau, métier, réputation, objet possédé, or,
  niveau d'objet, monnaie). Atteint une fois, un objectif le reste. Progression affichée
  (« 212 / 300 »), ordre modifiable. Modèles réutilisables, qui survivent à la réinitialisation
  des personnages et s'appliquent sans doublon. Migration `0007_goals`.
- Page **Objets** : qui possède un objet, et combien, sur tous les personnages (sacs, banque,
  équipement). Recherche par nom, sans tenir compte des accents ni de la casse, ou par
  identifiant.
- **Audit du jour** sur la page Opportunités : sur demande, l'assistant rédige un bilan du marché
  à partir des seuls faits du moteur, avec la même vérification des nombres. Un par marché et par
  jour, conservé avec le calcul dont il vient ; les 8 derniers restent lisibles. Migration
  `0008_economy_audits`.
- Page **Machines** : badge « À mettre à jour » sur un agent plus ancien que celui du site, et
  liste des PC concernés près du téléchargement. Sous chaque ligne du journal, les erreurs et
  avertissements de la synchronisation (dix au plus).
- `GET /api/health` rend la version et le commit en service.

### Modifié

- Le déploiement automatique ne met en service qu'un commit de `main` dont la CI a réussi ; CI en
  cours, absente ou illisible : il attend le passage suivant.
- Une synchronisation avec avertissements est enregistrée `partial`, avec leur nombre.

### Corrigé

- Failles connues de Next.js et de zod : Next.js 16.4.5, React 19.3.1, zod 4.6.7, drizzle-orm
  0.45.4, `@types/node` aligné sur Node 24.
- Les journaux et `sync_errors` ne contiennent plus le texte SQL ni les valeurs d'une requête en
  échec : seuls le type de l'erreur, son code PostgreSQL ou réseau et la contrainte en cause.
- Une date postérieure à l'heure du serveur de plus d'une heure (horloge d'un PC en avance) est
  refusée en 422 `future_timestamp`, au lieu de faire ignorer les envois suivants.

## Agent 0.5.1 — 2026-11-08

### Corrigé

- La surveillance ne s'arrête plus sur une erreur imprévue : le cycle est journalisé, signalé et
  repris au suivant. Avant, toute exception fermait l'agent sans ligne au journal.
- Un jeton illisible (dossier copié d'un autre PC, mot de passe Windows réinitialisé) est signalé
  avec sa cause, sans arrêter la surveillance.
- Le délai de 60 s couvre tout l'échange avec le serveur, corps de la réponse compris. Une réponse
  muette ou coupée devient un échec dit, au lieu de bloquer les envois jusqu'au redémarrage.

## Site 0.6.0 — 2026-11-08

### Ajouté

- La page Opportunités sonde le serveur de l'assistant local (3 s), sans retarder le reste de la
  page. Machine éteinte ou injoignable : la page le dit, masque le formulaire et propose
  « Réessayer ». Claude n'est pas sondé.

### Modifié

- Le projet s'appelle **WoW AltBoard** : titre des pages, en-tête (« AltBoard » seul sur
  téléphone), page de connexion. Dépôt GitHub `wnx82/wow-altboard`. Les noms de l'addon, de
  l'agent `AltBoardSync`, de la base et de la pile Komodo ne changent pas.
- Une question posée pendant une panne reçoit sa cause : serveur injoignable (machine éteinte),
  connexion coupée pendant la réponse, ou délai dépassé. Avant : « L'assistant ne répond pas ».

## Site 0.5.0 — 2026-11-07

### Ajouté

- `WOW_AI_REASONING_EFFORT` (`none`, `minimal`, `low`, `medium` ou `high`) : transmis en
  `reasoning_effort` à l'API compatible OpenAI. Essai réel sur Ollama : avec `none`, `qwen3.5:9b`
  répond en 2 à 4 s ; sans ce réglage, sa réflexion remplit le contexte ou dépasse le délai.

### Corrigé

- Une réponse coupée par le serveur (`finish_reason: "length"`, contexte plein) n'est plus
  signalée « illisible » : le message donne la cause et les deux remèdes.

## Site 0.4.0 — 2026-11-06

### Ajouté

- L'assistant de la page Opportunités peut utiliser **Claude** : `WOW_AI_PROVIDER=anthropic` et
  `WOW_AI_API_KEY`, une clé d'API Anthropic. Il passe par l'API Messages, avec le SDK officiel
  `@anthropic-ai/sdk`. Le modèle par défaut est `claude-opus-5-5` ; `WOW_AI_MODEL` en choisit un
  autre. Si les filtres de sécurité déclinent une question, l'API la repose au modèle de repli
  recommandé. La vérification des nombres de la réponse ne change pas.

### Modifié

- Sans `WOW_AI_PROVIDER`, l'assistant utilise toujours l'API compatible OpenAI (`WOW_AI_URL`,
  `WOW_AI_MODEL`). Un fournisseur inconnu désactive l'assistant.

## Site 0.3.0 — 2026-11-06

### Ajouté

- Économie : import des prix de l'hôtel des ventes (addon **Auctionator**) et des recettes connues
  de chaque personnage (addon **NaowhForever**), envoyés par l'agent 0.5.0. Un même fichier n'est
  importé qu'une fois ; les relevés de plusieurs comptes et PC se fusionnent jour par jour.
- Moteur économique déterministe ([ECONOMY-ENGINE](docs/ECONOMY-ENGINE.md)) :
  - prix : valeur de marché, médianes, variations, volatilité, liquidité, prix anormaux et
    confiance ;
  - rentabilité des crafts : un composant possédé coûte ce qu'il rapporterait, profit au prix
    prudent, commission réglable ;
  - signal de farm ;
  - opportunités classées (crafter, transformer, vendre, garder, acheter, farmer, ne pas crafter),
    chacune avec les valeurs qui la fondent.

  Aucune valeur n'est inventée : sans 3 jours de relevés, la décision est « attendre ».
- Nouvelles pages :
  - **Opportunités** et **Marché** ;
  - fiche d'objet : courbe de prix, quantités en vente, profit passé des recettes ;
  - **Craft** ;
  - **Farm** : sessions mesurées entre deux relevés des sacs, po/h ;
  - **Audit**.

  Les meilleures opportunités s'affichent aussi sur l'accueil.
- **Paramètres** : début de l'historique et commission de l'hôtel des ventes.
- `GET /api/economy/facts` : faits structurés du moteur.
- Assistant facultatif, désactivé par défaut (`WOW_AI_URL`, `WOW_AI_MODEL`, `WOW_AI_API_KEY`). Il
  explique ces faits sans rien calculer ; une réponse qui cite un nombre absent des faits est
  refusée.

### Modifié

- `POST /api/sync` : blocs `auctionator` et `recipes` facultatifs par compte ; taille maximale
  du document portée à 24 Mio.
- Un montant négatif s'affiche avec son signe ; il apparaissait à 0.

### Production

- Migrations `0005_economy` et `0006_farm_open_session`, appliquées au déploiement. Régler
  ensuite **Début de l'historique** au 2026-11-04 dans **Paramètres** : les jours antérieurs
  viennent de la bêta.

## Agent 0.5.0 — 2026-11-06

### Ajouté

- Lit `Auctionator.lua` (prix, que le client sérialise en CBOR) et `NaowhForever.lua` (recettes),
  à côté d'`AltBoard.lua`. Ces deux fichiers sont facultatifs : absents ou illisibles, ils ne
  bloquent jamais la synchronisation.
- `watch` synchronise aussi quand seul l'un de ces deux fichiers change.
- `scan` et `sync` affichent le nombre d'objets relevés par hôtel des ventes et de recettes.

## Site 0.2.1 — 2026-10-30

### Corrigé

- Page **Machines** : le bouton **Télécharger l'agent** passe en haut de la page. Il restait sous
  les cartes des machines, invisible sans faire défiler.

## Site 0.2.0 — 2026-10-29

### Ajouté

- Page **Machines** : l'agent se télécharge depuis le site, en archive ZIP de 6,8 Mo avec ses
  instructions (`LISEZMOI.txt`), ou en exécutable seul de 11,8 Mo, avec sa version et son
  empreinte SHA-256. L'image le publie depuis les sources du dépôt ; session requise (`GET /api/agent/zip`,
  `GET /api/agent`).
- Instructions d'installation : les addons AltBoard et Allemano Ledger vont dans
  `_forever_\Interface\AddOns`.

### Production

- Fin de la bêta : base sauvegardée, puis personnages de la bêta réinitialisés (14 supprimés) ;
  les fichiers de la bêta renvoyés ensuite sont ignorés.
- Serveurs surveillés : portail européen `eu.actual.battle.net:1119` à la place de celui de la bêta,
  libellé « EU », historique de la bêta effacé. Aucune adresse de jeu européenne n'est encore
  vérifiée.

## Agent 0.4.1 — 2026-10-29

### Corrigé

- Le dossier par défaut était le client de la bêta (`…\World of Warcraft\_classic_beta_`) : à la
  sortie officielle, l'agent n'aurait pas lu le nouveau client. Le défaut devient la racine
  `World of Warcraft`, qui lit chaque client installé, et une configuration fixée sur
  `_classic_beta_` passe d'elle-même à la racine qui le contient.

## Agent 0.4.0 — 2026-10-07

### Ajouté

- Saisie du jeton dans la fenêtre : plus besoin de ligne de commande pour installer un PC.

## Agent 0.3.0 — 2026-10-06

### Ajouté

- Fenêtre de l'agent et journal des modifications envoyées, personnage par personnage.

## Agent 0.2.0 — 2026-10-06

### Ajouté

- Synchronisation automatique (`watch`) à chaque écriture du jeu, démarrage à l'ouverture de
  session, icône dans la zone de notification.

## Site 0.1.0 — 2026-10-04 au 2026-10-16

Première mise en ligne le 2026-10-04, puis évolutions publiées sans changement de version.

### Ajouté

- `POST /api/sync` authentifié par jeton, validé, transactionnel et idempotent.
- Tableau de bord : personnages regroupés par compte, fiche personnage, comptes, machines et
  jetons, export Excel.
- Temps de jeu par niveau, sessions et courbe d'expérience (addon Allemano Ledger).
- Pages **Métiers**, **Activité** et **Niveaux**.
- État des serveurs WoW Forever EU (page **Serveurs**, miniatures sur l'accueil), contrôlés toutes
  les cinq minutes.
- Page **Paramètres** : serveurs surveillés réglables, réinitialisation des personnages pour la
  sortie officielle.
- Versions du site et de l'agent en pied de page.

### Exploitation

- Pile Komodo sur Proxmox (2026-10-05), déploiement automatique à chaque push sur `main`,
  sauvegarde quotidienne, surveillance par Prometheus, alerte ntfy des déploiements en échec.

### Sécurité

- Session vérifiée par chaque page du tableau de bord, préchargements compris (2026-10-11).

## Agent 0.1.0 — 2026-10-04

### Ajouté

- Commande `sync` : découverte des comptes, lecture stable de `AltBoard.lua` et
  `AllemanoLedger.lua`, parser SavedVariables, envoi au serveur.
