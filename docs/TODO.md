# À faire

Liste de travail : idées de fonctions et constats d'audit. [ROADMAP](ROADMAP.md) reste le relevé de
ce qui est validé, preuve à l'appui ; une ligne d'ici y passe une fois implémentée, testée et
vérifiée.

Audit du 2026-10-11, sur le commit `153d601` (site 0.1.0, agent 0.4.0). Revu le 2026-11-08 (site
0.7.0, agent 0.5.1) : les lignes faites sont cochées, avec le commit qui les règle ; les autres ont
été relues dans le code et restent ouvertes.

- Priorité : **P1** à faire en premier (risque réel ou gain immédiat), **P2** utile, **P3** confort.
- Effort : **S** quelques heures, **M** un à deux jours, **L** davantage.
- Chaque constat d'audit cite le fichier et la ligne lus. Ce qui n'a pas pu être vérifié est dit
  en fin de document.

## 1. Fonctions à intégrer

### 1.1 Objectifs par personnage (feuille de route à cocher)

Une section **Objectifs** sur la page de chaque personnage : une liste ordonnée de cases à cocher,
avec une barre de progression reprise sur la carte du personnage.

Deux sortes d'objectifs :

| Sorte | Qui coche | Exemples |
|---|---|---|
| Manuel | le joueur, sur le site | « Finir la suite de quêtes de la zone », « Acheter la monture », « Faire le donjon X » |
| Automatique | le site, à chaque synchronisation | voir le tableau suivant |

Ce que les données déjà synchronisées permettent de cocher seules :

| Objectif | Donnée lue |
|---|---|
| Atteindre le niveau N | `characters.level` |
| Monter un métier au rang N | `character_professions` (rang, maximum) |
| Atteindre un palier de réputation | `character_reputations` (palier, valeur) |
| Posséder un objet, en N exemplaires | `character_items` (sacs, banque), `character_equipment` |
| Réunir N pièces d'or | `characters.money_copper` |
| Atteindre un niveau d'objet moyen | `characters.item_level` |
| Réunir N unités d'une monnaie | `character_currencies` |
| Remplir ou enchanter un emplacement d'équipement | `character_equipment` (objet, identifiant d'enchantement) |

Ce qu'elles ne permettent pas : quêtes, recettes connues, donjons et raids faits, montures,
talents, temps de recharge de métier. AltBoard ne les relève pas
([ALTBOARD-DATA-MODEL § 8](ALTBOARD-DATA-MODEL.md)) : ces objectifs restent manuels, sauf à
obtenir la donnée d'un addon.

Les modèles comptent autant que les listes : la réinitialisation des personnages prévue à la
sortie officielle (4 novembre 2026) supprime les personnages, donc leurs objectifs. Un modèle
(« Montée en niveau », « Métiers », « Avant le premier raid ») se réapplique en un clic au
personnage recréé, et à tous les autres.

- [x] **P1 · M** — Décider la règle d'un objectif automatique : coché pour toujours dès qu'il a
  été atteint une fois (date gardée), ou reflet de l'état courant (un objectif « 100 pièces d'or »
  se décoche après une dépense). Fait le 2026-11-08 (`c3146ee`) : atteint une fois, avec la date.
- [x] **P1 · M** — Tables `goal_templates`, `goal_template_items` et `character_goals`
  (personnage, position, libellé, sorte, paramètres, date d'atteinte), supprimées en cascade
  avec le personnage ; les modèles survivent à la réinitialisation. Fait le 2026-11-08
  (`c3146ee`, migration `0007_goals`), sans colonne de note : le libellé en tient lieu.
- [x] **P1 · M** — Fonction pure d'évaluation d'un objectif à partir du personnage, testée sans
  base ; appelée à la synchronisation pour dater l'atteinte, et à l'affichage pour la progression
  (« 212 / 300 »). Fait le 2026-11-08 (`c3146ee`, `web/src/lib/goals/evaluate.ts`). Sept sortes
  automatiques ; l'emplacement d'équipement rempli ou enchanté n'en fait pas partie.
- [x] **P1 · M** — Page personnage : section **Objectifs** (ajouter, cocher, réordonner, supprimer,
  appliquer un modèle), par des actions serveur comme celles de **Paramètres**. Fait le 2026-11-08
  (`c3146ee`).
- [x] **P2 · S** — Barre de progression sur les cartes et colonne dans le tableau de l'accueil,
  avec un filtre « objectifs en cours ». Fait le 2026-11-09 (site 0.9.0).
- [x] **P2 · M** — Page **Objectifs** : un modèle en colonnes, les personnages en lignes, pour voir
  d'un coup qui en est où. Fait le 2026-11-09 (site 0.9.0).
- [ ] **P3 · S** — Liste récurrente (remise à zéro chaque jour ou chaque semaine), manuelle
  seulement : l'addon ne relève aucun verrou.
- [ ] **P3 · S** — Feuille « Objectifs » dans l'export XLSX.

### 1.2 Avec les données déjà synchronisées

- [x] **P1 · S** — **Machines** : signaler un agent en retard. Le site connaît la version du dépôt
  (`WOW_AGENT_VERSION`, pied de page) et celle de chaque PC (`machines.agent_version`), mais
  `web/src/app/(dashboard)/machines/page.tsx:56` affiche la seconde sans les comparer. Fait le
  2026-11-08 (`127aaf1`) : badge « À mettre à jour » et liste des PC à mettre à jour près du
  téléchargement.
- [x] **P1 · M** — Recherche d'objets sur tous les personnages : « qui possède cet objet, et
  combien ? ». La recherche actuelle est limitée à l'inventaire d'un personnage ; les tables
  `character_items` et `items` suffisent. Fait le 2026-11-08 (`190404c`) : page **Objets**, par
  nom (sans tenir compte des accents) ou identifiant, sacs, banque et équipement.
- [x] **P2 · M** — Bloc « À surveiller » sur l'accueil, calculé sans nouvelle donnée : sacs pleins
  (`bag_slots_used` / `bag_slots_total`), banque jamais relevée (`bank_at` vide), personnage non
  relevé depuis N jours, emplacement d'équipement vide, métier arrivé à son maximum. Fait le
  2026-11-09 (site 0.9.0), avec les PC muets ; l'équipement n'est signalé qu'à partir du niveau 10.
- [x] **P2 · M** — Courbe de l'or cumulé de tous les personnages, à partir des relevés. Chaque
  personnage garde sa dernière valeur connue entre deux relevés : un relevé n'est créé qu'à une
  progression. Fait le 2026-11-09 (site 0.9.0) : 90 jours, sur l'accueil.
- [x] **P2 · S** — Page **Réputations** comparées, sur le modèle de la page **Métiers**. Fait le
  2026-11-09 (site 0.9.0).
- [ ] **P2 · M** — Temps de jeu : total par compte et tous personnages confondus ; temps du niveau N
  comparé d'un personnage à l'autre. Le total par compte est fait le 2026-11-09 (site 0.9.0, page
  **Temps de jeu**) ; la comparaison du temps par niveau reste à faire.
- [x] **P2 · M** — Sessions : résumé par semaine (heures jouées, expérience), répartition par
  étiquette (`Leveling`, `Dungeon`, `Farming`), carte jour × heure. Fait le 2026-11-09 (site
  0.9.0, page **Temps de jeu**).
- [ ] **P3 · M** — Comparaison de deux personnages côte à côte (statistiques, équipement).
- [ ] **P3 · S** — Notes libres et étiquettes par personnage (principal, reroll, banque), saisies
  sur le site.
- [x] **P3 · S** — Site installable sur le téléphone (manifeste et icônes). Fait le 2026-11-09
  (site 0.9.0).

### 1.3 Avec de nouvelles données

Chaque ligne demande une évolution de l'agent, du contrat de `POST /api/sync` et du schéma.

- [x] **P2 · L** — Finances : or gagné et dépensé par source. Fait le 2026-11-09 (agent 0.7.0,
  site 0.11.0) : page **Finances**, à partir des journées d'Allemano Ledger. L'or en fin de journée
  (`gold`) est enregistré mais pas encore affiché.
- [ ] **P3 · M** — Donjons : les « runs » d'instance de Ledger (`kind = "run"`), aujourd'hui
  écartés par `agent/src/AltBoardSync.Core/AltBoard/LedgerReader.cs:98`. À stocker à part des
  sessions, dont ils recoupent l'expérience.
- [ ] **P3 · S** — Diagnostic de l'addon : `AltBoardDB.errors` (dix dernières erreurs Lua), non lu
  par l'agent, à afficher sur la page **Comptes**.
- [ ] **P3 · M** — Nom des enchantements et icônes des objets : seuls des identifiants existent
  (enchantement dans le lien, fichier d'icône). Il faut une table de correspondance ; source à
  trouver pour WoW Forever.

### 1.3 bis Économie (suite de la branche `feat/economy`)

Ce qui reste après le moteur et les pages ([ECONOMY-ENGINE](ECONOMY-ENGINE.md)), constaté le
2026-11-06.

- [x] **P2 · M** — Audit quotidien rédigé par l'assistant, à partir des seuls faits du moteur : le
  seul usage autorisé de la roadmap de l'économie qui n'est pas fait. Fait le 2026-11-08
  (`361cf52`) : sur demande, un par marché et par jour, conservé (page **Opportunités**). Pas encore
  essayé en production.
- [x] **P2 · M** — Noms des objets jamais possédés : le moteur ne connaissait que ceux vus dans un
  inventaire (table `items`). Fait le 2026-11-09 (site 0.10.0) : import de la table `ItemSparse`
  de wago.tools depuis **Paramètres**, complété par les noms du cache local du jeu
  (`Cache/ADB/frFR/DBCache.bin`) que l'agent 0.7.0 envoie (source `client`).
- [x] **P2 · M** — Alertes de prix par objet, sous ou au-dessus d'un seuil. Fait le 2026-11-09
  (site 0.10.0) : fiche de l'objet, page Marché et bloc **À surveiller**, sans notification.
- [ ] **P2 · S** — Revoir les index de `market_item_days` avec plusieurs semaines d'historique
  réel (environ 2 000 lignes par jour de scan sur le marché « PvE »).
- [ ] **P3 · M** — Agréger les relevés de plus d'un an, par semaine, si le volume le demande.

### 1.4 Notifications et rapports (V4 de la feuille de route)

- [ ] **P2 · M** — Webhook sortant vers n8n, réglable dans **Paramètres**, sur quatre événements :
  niveau gagné, objectif atteint, serveur de jeu de nouveau en ligne, PC muet depuis N jours.
- [ ] **P3 · M** — Rapport hebdomadaire : niveaux gagnés, or, temps joué, objectifs atteints.

### 1.5 Agent (V5 de la feuille de route)

- [ ] **P2 · L** — Mise à jour automatique : la release GitHub publie déjà `AltBoardSync.exe` et
  son empreinte SHA-256 (`.github/workflows/release-agent.yml:34`). Reste à interroger la dernière
  release, télécharger, vérifier l'empreinte, remplacer l'exécutable et redémarrer. Fait en partie
  le 2026-11-14 (agent 0.8.1) : l'agent annonce la version servie par le site, et le nouvel
  exécutable lancé à la main remplace l'ancien. Restent le téléchargement et la vérification.

## 2. Sécurité du site

`npm audit --omit=dev` du 2026-10-11 : aucune vulnérabilité connue. Celui du 2026-11-08 en
signalait pour `next` et `zod`, corrigées le même jour (`c7b3b7f`, Next.js 16.4.5, zod 4.6.7).

- [x] **P1 · S** — Les pages du tableau de bord répondaient sans session valide. La session
  n'était vérifiée en base que par le layout ; `web/src/proxy.ts` ne contrôle que la présence du
  cookie. Or Next rend la page sans attendre le layout, et ne rend pas le layout du tout lors d'une
  navigation interne. Reproduit le 2026-10-11 sur une construction de production locale du commit
  `153d601`, base de test, sur les neuf pages : contenu renvoyé avec un cookie invalide, et même
  sans aucun cookie quand la requête porte l'en-tête `purpose: prefetch`, que le proxy laisse
  passer. Corrigé le 2026-10-11 : chaque page, et `generateMetadata` de la fiche, commence par
  `requireSession()` ; `web/src/lib/auth/pages.test.ts` refuse une page qui ne le fait pas
  (étendu le 2026-11-14, site 0.25.0 : `web/src/lib/auth/guards.test.ts` fait de même pour les
  routes d'API et les actions serveur, hors liste publique explicite). Les
  mêmes 54 requêtes sur la construction corrigée ne renvoient plus aucun contenu. Constaté aussi en
  production le 2026-10-11, par l'origine du réseau local : 45 réponses sur 54 avec contenu sous
  `fcf3750`, aucune sous `5f0098e`.
- [x] **P1 · S** — Messages d'erreur journalisés avec les valeurs reçues. Une requête en échec
  lève une erreur dont le message contient le SQL et tous ses paramètres
  (`web/node_modules/drizzle-orm/errors.js:12`). Ce message part dans le journal
  (`web/src/lib/sync/handler.ts:147`, `web/src/lib/auth/actions.ts:47`) et dans `sync_errors`
  (`web/src/lib/sync/process.ts:655`), contre la règle « jamais de valeur reçue » de
  [SECURITY](SECURITY.md). Ne garder que le type de l'erreur et le code PostgreSQL. Fait le
  2026-11-08 (`127aaf1`, `web/src/lib/errors.ts`) : type, code PostgreSQL ou réseau, contrainte.
- [x] **P1 · S** — Horodatages futurs acceptés. Le contrat admet toute date jusqu'à l'an 3000
  (`web/src/lib/sync/schema.ts:17`), sans comparaison à l'heure du serveur. Un PC dont l'horloge
  avance envoie un `lastSeen` futur : les envois suivants, réels, sont classés en retard et ignorés
  jusqu'à cette date. Refuser en 422 au-delà de l'heure du serveur plus une tolérance. Fait le
  2026-11-08 (`127aaf1`) : 422 `future_timestamp` au-delà d'une heure d'avance, chemins des dates
  en cause dans la réponse.
- [ ] **P2 · S** — Changer le mot de passe ne ferme aucune session
  (`web/scripts/create-admin.ts:83`) ; une session dure 30 jours (`web/src/lib/auth/cookie.ts:8`),
  sans action « déconnecter partout ». Supprimer les sessions du compte dans la même transaction.
- [ ] **P2 · S** — Destination après connexion : `safeNext` (`web/src/lib/auth/actions.ts:18`)
  accepte un chemin contenant une tabulation ou un saut de ligne, que l'analyse d'URL ramène à une
  adresse hors du site. Résoudre la valeur par rapport à l'origine et exiger la même origine.
  Résolution vérifiée dans Node, parcours non rejoué dans un navigateur.
- [x] **P2 · M** — Aucun délai côté serveur sur les requêtes ni sur le verrou consultatif.
  `query_timeout` (`web/src/db/client.ts:18`) n'agit que dans le client ; le commentaire voisin
  cite PgBouncer et un `statement_timeout` du serveur, qui n'existent plus dans la pile Proxmox.
  Poser `lock_timeout` et `statement_timeout` en début de transaction, répondre 503 quand le
  verrou est pris. Effet déduit du code, non reproduit. Fait le 2026-11-14 (site 0.25.0) :
  `takeSyncLock` pose `lock_timeout` 8 s, `statement_timeout` 12 s et
  `idle_in_transaction_session_timeout` 30 s ; `503 sync_busy` ou `503 timeout` avec
  `Retry-After`, file d'attente en mémoire de quatre envois. Un test vérifie que `lock_timeout`
  borne bien l'attente du verrou consultatif ([DATABASE § Délais](DATABASE.md)).
- [ ] **P2 · S** — Limitation de débit : la clé est l'adresse entière, donc une IPv6 différente à
  chaque requête n'est jamais limitée, et la table se vide d'un coup une fois pleine
  (`web/src/lib/rate-limit.ts:40`). À la connexion, les compteurs sont consommés avant la
  vérification et jamais remis à zéro après un succès (`web/src/lib/auth/actions.ts:31`) : cinq
  échecs par quart d'heure sur l'adresse du propriétaire le bloquent. Regrouper les IPv6 par
  préfixe /64, ne compter que les échecs, ajouter une règle de débit Cloudflare sur `/api/sync`.
- [ ] **P3 · S** — Sondes : la liste des plages non publiques est incomplète en IPv6 (adresses
  compatibles IPv4, 6to4, Teredo) et pour deux plages IPv4 réservées
  (`web/src/lib/status/guard.ts:23`). N'autoriser en IPv6 que `2000::/3`, moins les exceptions.
- [ ] **P3 · S** — Cache de l'optimiseur d'images sur un `tmpfs` sans taille, compté dans les
  512 Mo du conteneur. `maximumDiskCacheSize` est fixé à 64 Mo depuis le site 0.16.0 (illustrations
  des bandeaux) ; reste à fixer la taille du `tmpfs`. Effet non mesuré.
- [ ] **P3 · S** — Hachage des mots de passe : scrypt avec N = 2^15, r = 8, p = 1
  (`web/src/lib/auth/password.ts:5`), sous la recommandation OWASP (p = 3 à ce N). Monter le
  paramètre et recalculer le hachage à la connexion suivante.

## 3. Web : performance, interface, tests

### Interface

- [x] **P1 · S** — Journal des synchronisations muet. Les avertissements de l'agent et la cause
  d'un échec sont écrits dans `sync_errors` (`web/src/lib/sync/process.ts:152`, `:655`), table
  qu'aucune page ne lit. Le statut `partial` n'est jamais écrit (`:136`, `:171` : toujours
  `success`) : le badge « Partielle » de **Machines** ne peut pas apparaître, et une ligne
  « Échouée » ne dit pas pourquoi. Afficher les erreurs sous la ligne du journal ; compter les
  avertissements dans `errors_count` ; écrire `partial` quand il y en a. Fait le 2026-11-08
  (`127aaf1`) : dix erreurs au plus sous chaque ligne de **Machines**, puis leur nombre restant.
- [ ] **P2 · S** — Vue cartes ou tableau et comptes repliés : lus dans `localStorage` après le
  rendu (`web/src/components/character-browser.tsx:107`), le serveur rend toujours le défaut. Qui
  préfère le tableau voit les cartes, puis le basculement. Porter ces préférences dans un cookie lu
  au rendu.
- [x] **P2 · M** — Recherche, filtres et tri de l'accueil en état local
  (`character-browser.tsx:102`) : ouvrir une fiche puis revenir remet la liste à zéro. Les porter
  dans les paramètres d'URL. Fait le 2026-11-11 (site 0.15.0, `web/src/lib/dashboard/browser-state.ts`) :
  confirmé dans un navigateur, la liste revient intacte après une fiche.
- [ ] **P3 · S** — Date limite de réinitialisation saisie dans le fuseau du navigateur
  (`web/src/components/settings-forms.tsx:103`), réaffichée en heure de Bruxelles
  (`web/src/app/(dashboard)/settings/page.tsx:87`) : décalée pour qui n'est pas dans ce fuseau.

### Accessibilité

- [ ] **P2 · S** — Contraste : `--faint` (`#6b7690`, `web/src/app/globals.css:15`) donne entre
  3,6:1 et 4,35:1 sur les fonds du thème, sous le seuil AA de 4,5:1, pour du texte de 0,7 rem :
  en-têtes de tableau, libellés des tuiles, pied de page, indications de saisie. L'éclaircir
  (vers `#8089a3`), en gardant la teinte actuelle pour les traits. Rapports calculés, non mesurés
  à l'écran.
- [ ] **P2 · S** — Aucun lien « Aller au contenu » : dix éléments focalisables précèdent `<main>`
  sur chaque page (`web/src/app/(dashboard)/layout.tsx:22`).
- [ ] **P2 · M** — Graphiques : chaque point et chaque colonne est un arrêt de tabulation
  (`web/src/components/trend-chart.tsx:124`, `column-chart.tsx:149`), soit plusieurs centaines
  sur une fiche. Un seul arrêt par graphique, les flèches pour passer d'un point à l'autre.
- [ ] **P3 · S** — Les tableaux n'ont ni `<caption>` ni en-tête de ligne (`scope="row"`), et leurs
  conteneurs à défilement horizontal ne sont pas focalisables. Au 2026-11-08, seul le tableau de
  la page **Objets** a les deux, sur 18.

### Performance

À ce volume (une douzaine de personnages), rien n'est lent. Ces lignes comptent quand
l'historique grossit.

- [ ] **P2 · S** — `character_snapshots` n'a que l'index unique `(character_id, captured_at)`
  (`web/src/db/schema.ts:406`). **Activité** et **Niveaux** filtrent sur `captured_at` tous
  personnages confondus (`web/src/lib/dashboard/queries.ts:267`, `:300`). Ajouter un index sur
  `captured_at`, après un `EXPLAIN` sur la base réelle.
- [ ] **P2 · S** — La fiche lit 200 relevés entiers, document `data` compris (`queries.ts:194`),
  pour en afficher 30 changements et deux courbes. Ne lire que les colonnes utiles et les trois
  clés du document dont l'historique se sert (guilde, métiers, réputations).
- [ ] **P2 · S** — État des serveurs : `latestChecks` et `lastAnswers` parcourent toute la table
  par `DISTINCT ON` pour rendre deux lignes (`web/src/lib/status/store.ts:43`, `:51`), à chaque
  ouverture de l'accueil. Une lecture `ORDER BY checked_at DESC LIMIT 1` par service, servie par
  l'index existant.
- [ ] **P3 · S** — `listCharacters` attend sa première requête pour lancer les deux suivantes,
  filtrées par une liste qui contient tous les personnages (`queries.ts:81`, `:92`) : les lancer
  ensemble, sans filtre.
- [ ] **P3 · S** — `sync_runs` est trié par `started_at` seul (`queries.ts:140`, `:403`), son index
  commence par `machine_id` (`schema.ts:364`). Ni `sync_runs` ni `sync_errors` ne sont purgés :
  ajouter l'index, puis une durée de conservation.
- [ ] **P3 · M** — **Niveaux**, période « Tout » : tous les relevés sont lus puis réduits en
  JavaScript (`queries.ts:300`, `web/src/lib/dashboard/levels.ts:133`). Agréger en SQL (dernier
  relevé par personnage et par jour).

### Tests

- [ ] **P2 · M** — Aucun test n'exécute une page, une route ni `proxy.ts` : une page qui plante au
  rendu n'est vue qu'en production. Parcours Playwright sur la base de test que la CI démarre
  déjà : connexion, chaque page, une fiche, l'export.
- [ ] **P2 · M** — Les actions serveur (`dashboard/actions.ts`, `settings/actions.ts`,
  `status/actions.ts`, `auth/actions.ts`) et `status/runtime.ts` n'ont aucun test. Isoler le cœur
  de chaque action en fonction recevant la base, comme `settings/reset.ts`.
- [ ] **P2 · S** — Logique pure sans test, logée dans des composants client : filtre et tri de
  l'accueil (`character-browser.tsx:125`), graduations (`trend-chart.tsx:25`,
  `column-chart.tsx:36`). La sortir dans `lib/` et la tester.
- [ ] **P3 · S** — Mesurer la couverture dans `npm test` et la publier en CI.

### Code

- [ ] **P3 · M** — Trois graphiques répètent l'observation de largeur, les graduations, l'infobulle
  et la grille (`column-chart.tsx`, `trend-chart.tsx`, `levels-chart.tsx`) : en extraire un crochet
  et un module d'échelle.
- [ ] **P3 · S** — Le fuseau `Europe/Brussels` est écrit en dur dans quatorze fichiers (2026-11-08), avec des
  formateurs de date redéclarés à l'identique : une constante et des formateurs nommés dans
  `web/src/lib/wow/format.ts`. Même traitement pour les deux `formatDuration` qui n'écrivent pas
  les durées de la même façon (`server-status.tsx:86`, `level-times.ts:134`).
- [ ] **P3 · M** — Fichiers à découper : `characters/[id]/page.tsx` (600 lignes, un composant par
  section), `character-browser.tsx` (530 lignes : préférences, filtre, carte, tableau),
  `sync/process.ts` (650 lignes : empreintes, tables filles, Ledger, relevés).

### Dépendances

- [x] **P2 · S** — `npm outdated` du 2026-10-11 : `next` 16.3.8 → 16.4.0, `react` et `react-dom`
  19.2.8 → 19.3.0, `drizzle-orm` 0.45.3 → 0.45.4. `@types/react` installé est déjà en 19.3.0,
  devant la bibliothèque : une API absente à l'exécution passerait le typage. Monter ces trois
  ensemble. Fait le 2026-11-08 (`c7b3b7f`) : `next` 16.4.5, `react` et `react-dom` 19.3.1,
  `drizzle-orm` 0.45.4.
- [ ] **P3 · M** — Versions majeures disponibles, à traiter une par une : `eslint` 10,
  `typescript` 7.

## 4. Agent Windows

`dotnet test` du 2026-10-11 : 152 tests verts. Les constats « par exécution » viennent d'une sonde
hors dépôt sur `AltBoardSync.Core` seul ; l'agent n'a pas été lancé.

### Robustesse

- [x] **P1 · S** — Un jeton indéchiffrable arrête tout l'agent. `TokenStore.Read()` lève
  `InvalidDataException` (`agent/src/AltBoardSync.Core/Config/TokenStore.cs:52`), que la boucle de
  surveillance n'attrape pas (`App/WatchLoop.cs:157`) : fenêtre et icône se ferment, à chaque
  relance. Cas réel : dossier `%APPDATA%\AltBoardSync` copié sur un autre PC, ou mot de passe
  Windows réinitialisé. [AGENT](AGENT.md) promet que la surveillance ne s'arrête pas. Traiter
  l'erreur comme un jeton absent : message dans la fenêtre, saisie proposée. Fait le 2026-11-08
  (`e328b01`, agent 0.5.1) : la cause est dite, la surveillance continue.
- [x] **P1 · S** — Aucun filet de dernier recours : `agent/src/AltBoardSync/Program.cs:119`
  n'attrape que l'annulation. Toute autre exception tue l'agent d'arrière-plan sans ligne au
  journal, par exemple `token.dat` verrouillé un instant par un antivirus. Attraper toute exception
  d'un cycle, la journaliser, reculer et continuer. Fait le 2026-11-08 (`e328b01`, agent 0.5.1).
- [x] **P1 · S** — Envoi qui peut ne jamais revenir. Le délai de 60 s s'arrête à la réception des
  en-têtes (`Sync/SyncClient.cs:38`, `ResponseHeadersRead`) ; la lecture du corps n'a aucun délai
  (`:39`), et une coupure pendant cette lecture sort en exception non attrapée (`:53`). Connexion
  muette après les en-têtes : plus aucun envoi jusqu'au redémarrage, la fenêtre affiche toujours
  « Synchronisation active ». Faire couvrir tout l'échange par le délai. Fait le 2026-11-08
  (`e328b01`, agent 0.5.1) : le délai couvre en-têtes et corps, une coupure devient un échec dit.
- [ ] **P2 · S** — Un compte illisible n'est pas signalé : le cycle rend `null`
  (`App/WatchLoop.cs:141`), sans événement d'échec ni bulle. `AltBoard.lua` devenu non analysable :
  une ligne au journal, tableau de bord figé, pastille au vert.
- [ ] **P2 · M** — La surveillance garde un handle ouvert sur `WTF\Account`
  (`App/WatchLoop.cs:192`) : Windows refuse de renommer `WTF` ou de déplacer le dossier du jeu tant
  que l'agent tourne, sans le désigner. Un surveillant mort n'est jamais recréé (`:191`, `:203`).
  Remplacer par un relevé périodique de la taille et de la date des fichiers connus.
- [x] **P2 · S** — Trois champs dépassent les bornes du serveur, qui refuse alors tout le document
  en 422 à chaque essai : 51 avertissements possibles contre 50
  (`web/src/lib/sync/schema.ts:170`), `flavor` non borné contre 40, nom de machine non borné
  contre 120. Borner côté agent et journaliser le code et les champs refusés. Fait le 2026-11-14
  (site 0.25.0, agent 0.8.1) : le serveur raccourcit avertissements et `displayName` au lieu de
  refuser, l'agent applique les mêmes limites, et un refus nomme jusqu'à trois champs en cause.
  `flavor` (nom d'un dossier `_…_` du jeu) et `hostname` (nom NetBIOS, 15 caractères au plus)
  restent bornés côté serveur seulement.
- [ ] **P3 · S** — `characters.json` illisible n'est jamais réparé (`App/SyncJournal.cs:60`,
  `:67`) : plus aucun « ce qui a changé » dans le journal, sans message. Repartir d'une base vide.
- [ ] **P3 · S** — `token set` accepte n'importe quel texte, la fenêtre exige le format du jeton
  (`App/AgentApp.cs:372`) ; `token.dat` est écrit sans fichier temporaire
  (`Config/TokenStore.cs:60`), contrairement à `config.json`.
- [ ] **P3 · S** — Deux octets NUL bruts dans le source
  (`AltBoard/AltBoardReader.cs:285`, `:348`) : un éditeur qui les remplace par une espace retire
  toutes les espaces des noms envoyés, sans qu'aucun test le voie. Écrire `"\0"` et ajouter le
  test.

### Installation et mise à jour

- [x] **P2 · M** — Rien ne signale un agent périmé : l'agent envoie sa version, la réponse de
  `/api/sync` n'en propose aucune. Ajouter la dernière version à la réponse (le site la connaît),
  l'afficher dans la fenêtre, et marquer les PC en retard (voir § 1.2). Les PC en retard sont
  marqués sur **Machines** depuis le 2026-11-08 ; reste la fenêtre de l'agent. Fait le 2026-11-14
  (site 0.25.0, agent 0.8.1) : `latestAgentVersion` dans la réponse, bulle et lien
  « Mise à jour X disponible » dans la fenêtre, une fois par version.
- [ ] **P2 · M** — Mise à jour à la main piégeuse : lancer le nouvel exécutable ne fait que
  rouvrir la fenêtre de l'ancienne instance (`agent/src/AltBoardSync/Program.cs:25`), et le
  démarrage avec Windows garde l'ancien chemin en se disant « activé »
  (`RegistryAutostart.cs:20`). Comparer version et chemin au lancement, proposer le remplacement.
  Fait le 2026-11-14 (agent 0.8.1) : un exécutable plus récent arrête l'ancien, prend sa place et
  réécrit le démarrage avec Windows. Une instance antérieure à 0.8.1, qui ne dit pas sa version,
  est remplacée de même.
- [ ] **P2 · M** — Dossier du jeu fixé sur la bêta (`Discovery/AccountScanner.cs:16`,
  `…\World of Warcraft\_classic_beta_`), sans choix dans la fenêtre : à la sortie officielle du
  4 novembre 2026, l'agent ne trouvera plus rien sans `config set wowPath`. Prendre par défaut la
  racine `World of Warcraft` et ajouter le choix du dossier à la fenêtre. Fait en partie le
  2026-10-29 (agent 0.4.1) : la racine est le défaut, et une configuration fixée sur
  `_classic_beta_` passe à la racine qui le contient (`Config/AgentConfig.cs`). Reste le choix du
  dossier dans la fenêtre.
- [ ] **P2 · M** — Exécutable publié non signé, et toute étiquette `agent-v*` publie une release,
  quel que soit le commit (`.github/workflows/release-agent.yml:7`). Signer, ajouter une
  attestation de provenance, refuser une étiquette hors de `main`.
- [ ] **P3 · S** — L'exécutable publié (rogné, fichier unique) n'est jamais exécuté en CI
  (`.github/workflows/ci.yml:81`) : y lancer `AltBoardSync.exe version` et un `scan` sur les
  fixtures.

### Code et tests

- [ ] **P3 · L** — Le projet de l'exécutable (fenêtre, icône, démarrage automatique) n'a aucun
  test, et `MainWindow.cs` réunit en 1 229 lignes messages Win32, état, dessin, panneau du jeton
  et journal. Sortir vers `AltBoardSync.Core` un modèle d'état testable, puis découper.

## 5. Déploiement et exploitation

- [x] **P1 · S** — Abandonné par le joueur le 2026-11-08 : la copie restic hors de l'hôte n'est
  pas nécessaire. Le dump local de chaque nuit et la sauvegarde PBS du conteneur, deux fois par
  semaine sur un autre hôte, suffisent. Le script essaie toujours l'envoi et le reporte sans
  échouer. Constat d'origine : aucune copie hors de l'hôte n'a jamais réussi. Chaque nuit, le journal de
  `wow-altboard-backup.service` dit « restic : dépôt injoignable », et la métrique
  `wow_altboard_backup_offsite_last_success_timestamp_seconds` n'a jamais été publiée (constaté le
  2026-10-29). L'alerte de copie hors de l'hôte ne compte qu'à partir de la première copie réussie
  ([DEPLOYMENT § Surveillance](DEPLOYMENT.md)) : elle ne s'est donc jamais déclenchée. Seule la
  sauvegarde PBS du conteneur, deux fois par semaine, quitte l'hôte `prox`. Rendre
  `backup-gateway` joignable à 03:45 ou changer d'heure, et alerter aussi quand aucune copie n'a
  jamais réussi. Revu le 2026-11-08 : toujours en échec (« no route to host »), et plus aucune
  machine du réseau local ne porte l'adresse du dépôt restic ; les autres sauvegardes du conteneur
  visent la même. Ni proxnas ni le DSM n'ont de serveur de dépôt ni de dépôt restic. Les
  sauvegardes PBS du conteneur sur un autre hôte existent (2026-11-02 et 2026-11-05).
- [x] **P1 · M** — Conditionner le déploiement à la CI. L'action Komodo déploie tout commit de
  `main` dans les cinq minutes, sans regarder la CI (`deploy/proxmox/komodo.toml:46` ;
  [DEPLOYMENT § Mettre à jour](DEPLOYMENT.md) le reconnaît). Un test en échec n'empêche pas la mise
  en production. Deux voies : l'action lit l'état du commit par l'API GitHub avant **Deploy**, ou
  la pile suit une branche `production` que la CI avance quand tout est vert. Fait le 2026-11-08
  (`dd88ee7`) : l'action lit le résultat de la CI du commit par l'API GitHub et ne déploie qu'un
  succès ; CI en cours, absente ou illisible : elle attend le passage suivant. Appliqué dans
  Komodo et lancé une fois le même jour.
- [x] **P1 · S** — Exposer le commit en service hors du pied de page, par exemple dans
  `/api/health`. Le pied de page n'est lisible que connecté ; après un déploiement, la
  vérification se fait aujourd'hui à la main sur le serveur. L'action Komodo et la sonde
  Prometheus pourraient alors constater seules que le commit attendu répond. Fait le 2026-11-08
  (`dd88ee7`) : `/api/health` rend `version` et `commit`. Ni l'action ni la sonde ne les lisent
  encore.
- [ ] **P2 · M** — Essai de restauration réel. Le script vérifie que le dump est lisible
  (`deploy/proxmox/backup/wow-altboard-backup.sh:62`, `pg_restore --list`), jamais qu'il se
  restaure. Restaurer chaque semaine le dernier dump dans une base jetable, compter les lignes de
  `character_snapshots`, publier le résultat en métrique.
- [ ] **P2 · S** — Mises à jour de dépendances automatiques (Dependabot ou Renovate) pour `web/`,
  `agent/`, les actions GitHub et les images Docker : `.github/` ne contient que les deux workflows.
- [ ] **P2 · S** — CI : ajouter `npm audit --omit=dev` et une recherche de secrets (gitleaks).
- [x] **P3 · S** — `@types/node` est en `^20` (`web/package.json:28`) alors que la CI et l'image
  tournent sur Node 24 : aligner. Fait le 2026-11-08 (`c7b3b7f`) : `^24`.
- [ ] **P3 · S** — Images `node:24-alpine` et `postgres:17-alpine` suivies par étiquette flottante :
  une reconstruction peut changer de version mineure sans commit. Fixer la version mineure, que
  l'outil de mise à jour avancera.
- [ ] **P3 · S** — Retour arrière : il reconstruit l'ancien commit
  ([DEPLOYMENT § Revenir en arrière](DEPLOYMENT.md)). Étiqueter l'image par commit et garder la
  précédente rendrait le retour immédiat, même si la construction est cassée.

## 6. Documentation et dépôt

- [x] **P1 · S** — Compteurs de tests périmés : `README.md:53-54` annonce 143 (agent) et 156 (web),
  `docs/ROADMAP.md:17` 152 et 185 ; la suite web en compte 214 au 2026-10-11. Retirer les nombres
  des documents, ou les faire écrire par la CI. Fait le 2026-11-08 : nombres retirés du README et
  de la ROADMAP, la CI les compte.
- [ ] **P1 · S** — `docs/ROADMAP.md` : « Dernière mise à jour : 2026-10-08 » alors que P14 cite le
  2026-10-09 ; la synthèse parle de 6 personnages (au moins 12 en base au 2026-10-11) ; dans « Reste à faire », la ligne
  « Icônes, temps par niveau, sessions… : déployer le serveur » est faite depuis le déploiement
  automatique ; les lignes 🟡 de P7 « Reste la mise en production » sont à réévaluer. Fait en
  partie le 2026-11-08 : date à jour, ligne « déployer le serveur » retirée. Les 6 personnages
  restent : ils datent la recette de la V1. Reste à revoir en production les lignes 🟡 de P7.
- [x] **P2 · S** — `README.md:72` décrit AGENT comme « automatisation future » : `watch`, le
  démarrage avec Windows et la fenêtre existent depuis les agents 0.2.0 à 0.4.0. Fait le
  2026-11-08.
- [x] **P2 · S** — Version du site : `web/package.json` est à `0.1.0` depuis l'origine, sans
  `CHANGELOG`. Le pied de page affiche donc un numéro qui ne change jamais ; seuls le commit et la
  date identifient ce qui tourne. À décider : incrémenter à chaque livraison avec un journal des
  changements, ou retirer le numéro du pied de page. Fait : le site suit SemVer avec
  [CHANGELOG](../CHANGELOG.md), 0.7.0 au 2026-11-08.
- [x] **P3 · S** — Trois branches locales déjà fusionnées dans `main` (`feat/v1-pipeline`,
  `feat/web-design`, `feat/jeton-fenetre-graphiques-niveaux`) : à supprimer, comme le note déjà la
  feuille de route. Fait le 2026-10-29 : `main` est la seule branche durable.

## Ce qui n'a pas été vérifié

- En production, seul le défaut de session (§ 2) a été contrôlé, sans session valide et par
  l'origine du réseau local, pas par `wow.ekreativ.be` ; l'affichage des pages avec une session
  valide n'y a pas été revu après la correction.
- Aucun `EXPLAIN` sur la base réelle : les constats de performance (§ 3) viennent du schéma et du
  code, pas d'une mesure.
- Aucun contrôle d'accessibilité dans un navigateur ni avec un lecteur d'écran : contrastes
  calculés sur les variables CSS.
- L'agent n'a pas été lancé : fenêtre, rendu, exécutable publié et comportement de SmartScreen non
  observés.
- Les réglages réels de Cloudflare Access et de PostgreSQL en production n'ont pas été consultés.
- Les lignes marquées « déduit du code », « non rejoué » ou « non mesuré » sont à confirmer avant
  correction.
