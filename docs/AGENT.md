# Agent Windows — AltBoardSync

Exécutable unique, autonome (aucun runtime .NET à installer), en lecture seule sur le dossier de
World of Warcraft. Un double-clic ouvre sa [fenêtre](#fenêtre) : il synchronise alors tout seul, à
chaque écriture du jeu, et tient le journal de ce qu'il envoie. Tout reste faisable en ligne de
commande (`sync`, `watch`).

## Construire

```bash
cd agent
dotnet test
dotnet publish src/AltBoardSync -c Release -o ../dist     # dist/AltBoardSync.exe, ~12 Mo, win-x64
```

## Publier une version

La version vit dans `agent/Directory.Build.props`. Une étiquette `agent-vX.Y.Z` poussée sur GitHub
lance `.github/workflows/release-agent.yml` : tests, publication, puis GitHub Release portant
`AltBoardSync.exe` et son empreinte SHA-256. L'étiquette doit correspondre à la version du fichier,
sinon la release est refusée.

```bash
git tag agent-v0.5.1 && git push origin agent-v0.5.1
```

## Installer sur un PC

1. Télécharger l'agent depuis la page **Machines** du tableau de bord (archive ZIP avec ses
   instructions, ou exécutable seul), ou depuis la dernière release du dépôt, puis copier
   `AltBoardSync.exe` où l'on veut. Les addons AltBoard et Allemano Ledger doivent être installés
   dans le jeu (`_forever_\Interface\AddOns`).
2. Créer un jeton dans le tableau de bord (page **Machines**) : il n'est affiché qu'une fois.
3. Double-cliquer sur `AltBoardSync.exe` : sa [fenêtre](#fenêtre) demande le jeton. Le coller, puis
   **Enregistrer** : la première synchronisation part aussitôt.

Le jeton se lie à la première machine qui l'utilise ; il est refusé ailleurs. Un jeton par PC.

La fenêtre ouverte, la synchronisation est automatique tant que l'agent tourne ; son interrupteur
**Démarrage avec Windows** le relance à chaque ouverture de session.

Tout reste faisable sans fenêtre :

```powershell
AltBoardSync.exe config set serverUrl https://wow.ekreativ.be/api/sync   # autre serveur que celui par défaut
AltBoardSync.exe token set          # saisie masquée
AltBoardSync.exe sync               # un envoi
AltBoardSync.exe autostart on       # envoi automatique, dès maintenant et à chaque ouverture de session
```

Voir [Synchronisation automatique](#synchronisation-automatique).

Le jeu n'écrit `AltBoard.lua` qu'à la déconnexion du personnage ou sur `/reload` : synchroniser
avant ne voit pas les derniers changements.

## Commandes

| Commande | Effet |
|---|---|
| aucune, par double-clic | ouvre la fenêtre (comme `ui`) |
| aucune, depuis un terminal | affiche l'aide |
| `ui` | ouvre la fenêtre de l'agent ; celle de la surveillance en cours s'il y en a une |
| `sync` | lit tous les `AltBoard.lua` (et les `AllemanoLedger.lua`, `Auctionator.lua`, `NaowhForever.lua` voisins) et envoie le document |
| `watch` | synchronise à chaque écriture du jeu, jusqu'à l'arrêt |
| `autostart` / `autostart on` / `autostart off` | affiche, active ou désactive le lancement de `watch` à l'ouverture de session ; `on` le lance aussi tout de suite, `off` arrête celui qui tourne |
| `scan` | lit et affiche, **sans rien envoyer** (équivaut à `sync --dry-run`) |
| `config` | affiche la configuration |
| `config set <wowPath\|serverUrl\|machineName> <valeur>` | modifie la configuration |
| `token set` / `token clear` | enregistre ou supprime le jeton |
| `version` | affiche la version |

Options de `sync`, `scan` et `watch` : `--wow-path <dossier>`, `--server <url>`. Pour `sync` et
`scan` seulement : `--dry-run`, `--out <fichier>` (écrit le document JSON produit).

Codes de sortie : `0` réussite, `1` synchronisation échouée ou partielle, `2` configuration ou usage.

## Exemple

```text
AltBoard Sync 0.5.1

Machine : PC-GAMING

2 comptes détectés
6 personnages détectés

Compte 1 (12…#1) : 4 personnages
  Auctionator « PvE » : 2010 objets
  NaowhForever : 45 recettes
Compte 2 (34…#1) : 2 personnages

Envoi vers le serveur...

6 personnages synchronisés.
0 nouveau personnage, 1 mis à jour.
1 nouveau snapshot.
5 personnages inchangés.

Depuis la synchronisation précédente :
  Aedot (Sulfuron) : niveau 28 → 30 · +12 po 40 pa · zone : Vallée de Strangleronce · sacs mis à jour

Synchronisation terminée.
```

La partie « Depuis la synchronisation précédente » n'apparaît que si un personnage a changé depuis
l'envoi accepté précédent (voir [Journal](#journal)).

## Fichiers locaux

Dossier `%APPDATA%\AltBoardSync\` (remplaçable par la variable `ALTBOARDSYNC_HOME`) :

| Fichier | Contenu |
|---|---|
| `config.json` | `machineUuid`, `machineName`, `wowPath`, `serverUrl` — aucun secret |
| `token.dat` | jeton chiffré par DPAPI pour l'utilisateur Windows courant |
| `state.json` | dernière empreinte envoyée par compte, pour `watch` ; ni contenu ni nom réel de dossier de compte |
| `journal.jsonl` | journal affiché par la fenêtre : une entrée par envoi, panne ou événement, avec ce qui a changé par personnage ; les 200 dernières sont gardées |
| `characters.json` | ce que l'agent retient de chaque personnage envoyé (niveau, or, métiers, empreintes) pour dire ce qui change à l'envoi suivant |
| `logs\altboardsync.log` | journal technique ; ni jeton ni nom réel de dossier de compte ; rotation à 1 Mo |

`journal.jsonl` et `characters.json` nomment les personnages : ils ne quittent jamais la machine, et
ne contiennent ni le jeton ni le nom réel d'un dossier de compte. Perdus, ils ne coûtent que
l'historique affiché.

Seul le document envoyé au serveur porte le nom complet du dossier (`folderName`, depuis 0.6.0),
pour la page Comptes. L'agent 0.6.0 change aussi le format des empreintes de `state.json` : après
la mise à jour, chaque compte est renvoyé une fois, sans attendre que le jeu réécrive ses fichiers.

`machineUuid` est généré au premier lancement et identifie l'installation ; le nom d'hôte n'est
qu'informatif (un PC peut être renommé). Un `config.json` illisible arrête l'agent : il ne régénère
jamais l'UUID en silence, ce qui créerait une seconde machine côté serveur.

La variable `ALTBOARDSYNC_TOKEN` prime sur `token.dat` (tests, exécution ponctuelle).

## Découverte

`wowPath` désigne soit un client (`…\World of Warcraft\_forever_`), soit la racine contenant
plusieurs clients (`_forever_`, `_classic_beta_`, `_retail_`…). Chaque `WTF\Account\<COMPTE>\SavedVariables\AltBoard.lua`
est un compte.

Par défaut : la racine `C:\Program Files (x86)\World of Warcraft`. Jusqu'à la version 0.4.0, le
défaut était le client de la bêta, `…\_classic_beta_`, et chaque `config.json` l'a enregistré.
Depuis la 0.4.1, un `wowPath` qui désigne un dossier `_classic_beta_` passe, au démarrage, à la
racine qui le contient : le client de la sortie officielle (`_forever_`) y est lu avec celui de la
bêta. Les personnages de la bêta renvoyés ensuite sont ignorés par le serveur après la
réinitialisation ([DATABASE](DATABASE.md#réinitialisation-des-personnages)). Avec l'agent 0.4.0 :

```powershell
AltBoardSync.exe config set wowPath "C:\Program Files (x86)\World of Warcraft\_forever_"
```

puis relancer l'agent : `watch` ne relit pas sa configuration en cours de route. Dans les deux cas,
les addons AltBoard et Allemano Ledger doivent être installés dans ce client
(`_forever_\Interface\AddOns`). Un compte sans AltBoard, le dossier technique `WTF\Account\SavedVariables` et les
fichiers `.bak` sont ignorés. Zéro compte n'est pas une erreur.

Si le même dossier contient `AllemanoLedger.lua` (addon Allemano Ledger), l'agent y lit le temps
de jeu des personnages connus d'AltBoard : dernier `/played`, début du niveau en cours, niveaux
terminés, et leurs sessions de jeu : dates, durée, expérience gagnée
([LEDGER-DATA-MODEL](LEDGER-DATA-MODEL.md)). Fichier facultatif : absent, rien ne change ;
illisible, un avertissement est joint au document et la synchronisation continue.

Deux autres fichiers voisins alimentent le moteur économique, avec la même règle (facultatifs,
jamais bloquants) :

- `Auctionator.lua` (addon Auctionator) : prix de l'hôtel des ventes, jour par jour, et prix des
  marchands ([AUCTIONATOR-DATA-MODEL](AUCTIONATOR-DATA-MODEL.md)) ;
- `NaowhForever.lua` (addon NaowhForever) : recettes connues de chaque personnage, relevées à
  l'ouverture de la fenêtre d'un métier ([PROFESSIONS-DATA-MODEL](PROFESSIONS-DATA-MODEL.md)).

Pour des prix à jour : scan à l'hôtel des ventes avec Auctionator, `/reload`, puis synchroniser.
`scan --out <fichier>` montre ce qui serait envoyé, prix et recettes compris.

## Lecture pendant que le jeu écrit

1. relever taille et date du fichier ;
2. attendre 300 ms ; si elles ont changé, recommencer ;
3. ouvrir en lecture seule et en partage total (le jeu peut écrire, renommer, supprimer) ;
4. relever à nouveau taille et date ; si elles ont changé, recommencer ;
5. après 5 tentatives, le compte est signalé illisible — les autres comptes sont traités normalement.

Un fichier tronqué est toujours détecté par le parser (table non fermée). L'agent ne crée, ne
modifie et ne supprime rien dans le dossier du jeu.

## Données non à jour

Le jeu n'écrit `AltBoard.lua` qu'au `/reload`, à la déconnexion ou à la fermeture, et AltBoard ne
relève que le personnage connecté. Avant de synchroniser après une session : `/reload` ou déconnexion.

## Parser

Lit le format SavedVariables sans exécuter de Lua : seuls les littéraux sont acceptés ; un appel de
fonction, une expression ou une variable sont des erreurs. Géré : chaînes à échappements (`\"`,
`\n`, `\ddd`, `\xHH`), chaînes longues, nombres entiers, flottants, hexadécimaux et non finis
(`1.#INF`), `nil` positionnels, clés chaîne et numériques distinctes, commentaires, BOM, UTF-8
invalide. Profondeur limitée à 100 niveaux, fichier limité à 64 Mo.

Détection des structures inconnues : toute clé racine ou tout champ de personnage que l'agent ne
connaît pas produit un avertissement, transmis au serveur et conservé avec la synchronisation.
Une version de schéma AltBoard inconnue est lue au mieux, avec avertissement.

## Synchronisation automatique

`AltBoardSync.exe watch` synchronise à chaque écriture du jeu : déconnexion d'un personnage,
`/reload`, fermeture. Depuis un terminal, il affiche une ligne par envoi et s'arrête par Ctrl+C.
Lancé sans terminal (ouverture de session, `autostart on`), il tourne en arrière-plan : sa fenêtre
ne s'ouvre que sur demande. Un double-clic sur l'exécutable lance la même surveillance, fenêtre
ouverte.

```text
AltBoard.lua, AllemanoLedger.lua, Auctionator.lua ou NaowhForever.lua modifié (FileSystemWatcher sur WTF\Account)
        ↓
anti-rebond : attendre 5 s sans nouvel événement (le jeu écrit en plusieurs fois)
        ↓
lecture stable (StableFileReader)
        ↓
empreinte SHA-256 des fichiers du compte ≠ dernière empreinte envoyée ?   sinon : rien à faire
        ↓
parser → document → POST /api/sync (idempotent)
```

- **Au démarrage** : une vérification immédiate. Ce qui a changé pendant que l'agent ne tournait
  pas part aussitôt ; ce que le serveur a déjà n'est pas renvoyé.
- **Filet de sécurité** : `FileSystemWatcher` peut manquer des événements (tampon saturé). Toutes les
  10 minutes, les fichiers sont relus et comparés, et la découverte rejouée : un compte ou un
  client apparu entre-temps est pris en charge.
- **État local** : la dernière empreinte envoyée par compte, dans `state.json`. Perdu, il ne coûte
  qu'un envoi de plus.
- **Échecs** : nouvel essai après 1 minute, puis une attente doublée à chaque échec, jusqu'à
  30 minutes ; jamais plus d'un envoi à la fois. Un jeton absent ou illisible, un dossier du jeu
  introuvable, une erreur imprévue (journalisée avec son type) suivent la même règle : la
  surveillance attend qu'on les corrige, elle ne s'arrête pas (agent 0.5.1).
- **Délai** : 60 s pour tout l'échange avec le serveur, corps de la réponse compris. Une réponse
  muette ou coupée compte comme un échec.
- **Une seule surveillance** par session Windows : une seconde refuse de démarrer.

### Fenêtre

Un double-clic sur `AltBoardSync.exe`, la commande `ui` ou un clic sur l'icône de la zone de
notification ouvrent la fenêtre de l'agent :

- **état** : synchronisation active, en cours, ou en échec avec l'heure du prochain essai ;
- **Démarrage avec Windows** : l'interrupteur inscrit ou retire le lancement à l'ouverture de
  session (voir [plus bas](#démarrage-à-louverture-de-session)) ;
- **dernier envoi**, nombre de personnages, serveur et présence du jeton ;
- **Synchroniser maintenant** (ou F5), **Jeton**, **Tableau de bord**, **Fichier journal** ;
- **journal** : chaque envoi, chaque panne, et ce qui a changé par personnage.

**Jeton** ouvre la saisie du jeton d'agent : champ masqué, **Coller** (ou Ctrl+V, ou le menu du
clic droit), **Créer un jeton** qui ouvre la page Machines du tableau de bord, **Enregistrer** (ou
Entrée). Tant qu'aucun jeton n'est enregistré, la fenêtre l'ouvre d'elle-même, une fois par
lancement. Un texte qui n'a pas la forme d'un jeton (`wab_` puis 43 caractères) est refusé avant
d'être enregistré. Le jeton est chiffré comme par `token set` (voir
[Fichiers locaux](#fichiers-locaux)) et remplace celui qui existait ; une synchronisation part
aussitôt, et son résultat s'inscrit au journal : un jeton refusé par le serveur s'y lit tout de
suite.

La fermer ne quitte pas l'agent : il reste dans la zone de notification, et **Quitter** l'arrête.
Une seule surveillance tourne par session Windows : un second double-clic rouvre la fenêtre de
celle qui tourne. Au clavier : Tab, Entrée ou Espace, flèches et Page précédente/suivante pour le
journal, Échap pour fermer.

Elle est dessinée directement par l'API Windows, aux couleurs du tableau de bord : ni Windows Forms
ni WPF, qui empêcheraient de réduire l'exécutable. Seul le champ du jeton est un contrôle de
Windows : coller, sélectionner et lecteurs d'écran s'y comportent comme ailleurs. Sur Windows 11
24H2 et suivants, aucune console n'apparaît au double-clic ni à l'ouverture de session
(`consoleAllocationPolicy` du manifeste) ; sur les versions antérieures, une console s'ouvre un
instant puis se referme.

### Journal

Après chaque envoi accepté, l'agent compare les personnages à ceux de l'envoi accepté précédent
et inscrit ce qui a changé : niveau, expérience, or, niveau d'objet, temps de jeu, métiers, zone,
guilde, et les parties mises à jour (équipement, sacs, banque, réputations, monnaies). Un
personnage inconnu jusque-là est signalé comme nouveau. Au tout premier envoi, rien n'est
comparable : l'entrée ne porte que le résumé.

La comparaison est locale : elle dit ce qui a changé entre deux envois de ce PC, pas ce que le
serveur a retenu. `sync` et `watch` écrivent le même journal ; une panne n'y figure qu'une fois,
pas à chaque nouvel essai. Les mêmes lignes s'affichent dans le terminal et, pour les trois
premiers personnages, dans la bulle de notification.

### Zone de notification

Pendant `watch`, une icône indique l'état en infobulle et affiche une bulle à chaque
synchronisation et à chaque nouvelle panne. Clic gauche : la fenêtre. Clic droit : **Ouvrir
AltBoard Sync**, **Synchroniser maintenant**, **Ouvrir le tableau de bord**, **Ouvrir le fichier
journal**, **Quitter**.

Windows range les nouvelles icônes dans le débordement (`^`) : la glisser sur la barre des tâches
la garde visible. Le mode « Ne pas déranger », souvent actif en jeu, retient les bulles : elles
attendent dans le centre de notifications.

### Démarrage à l'ouverture de session

`autostart on` inscrit `watch` dans la clé Run de l'utilisateur
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, valeur `AltBoardSync`) et le lance tout de
suite. La commande passe par `conhost.exe --headless`, pour qu'aucune fenêtre ne s'ouvre. Elle
retient l'emplacement de l'exécutable : après l'avoir déplacé, relancer `autostart on`.
`autostart off` retire l'inscription et arrête la surveillance en cours.

L'interrupteur **Démarrage avec Windows** de la fenêtre écrit la même inscription, avec la même
contrainte d'emplacement ; il ne lance ni n'arrête rien, puisque l'agent tourne déjà.

Ce n'est pas un service Windows : il tournerait sous un autre compte et ne pourrait pas déchiffrer
le jeton (DPAPI).

### Ce que l'agent ne fait jamais

Il n'observe que le dossier `WTF\Account`, par les notifications de fichiers de Windows. Il
n'ouvre pas le processus du jeu, ne lit pas sa mémoire, n'y injecte rien, ne simule aucune saisie
et n'écrit rien dans le dossier du jeu.
