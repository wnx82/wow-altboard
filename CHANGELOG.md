# Journal des modifications

Deux versions, chacune en SemVer : le **site** (`web/package.json`) et l'**agent**
(`agent/Directory.Build.props`, étiquette `agent-vX.Y.Z` pour une release). Le pied de page du
tableau de bord affiche les deux. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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
