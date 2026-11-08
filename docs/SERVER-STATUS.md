# État des serveurs WoW Forever EU

Page **Serveurs** du tableau de bord (`/servers`) : le serveur web sonde lui-même les serveurs de
connexion et de jeu, enregistre chaque contrôle et affiche statut, latence, disponibilité et
changements d'état.

**État au 2026-11-08 : la production sonde le serveur de connexion européen et deux serveurs de
jeu européens.** Le portail `eu.actual.battle.net:1119` est celui que le client de la sortie
officielle (`_forever_`) a contacté le 2026-10-29. Les deux adresses de jeu ont été relevées le
2026-11-08 sur un client en jeu, puis saisies dans **Paramètres** (voir
[Adresses en service](#adresses-en-service)). Le libellé est « EU » ; l'historique des contrôles de
la bêta a été effacé le 2026-10-29.

## Provenance des données

Sources étudiées le 2026-10-08, dans l'ordre de préférence :

| Source | Constat | Retenue |
|---|---|---|
| API Battle.net (Game Data API, état des royaumes) | Documentée pour World of Warcraft et ses versions Classic. Ni la référence des API de données de jeu ni le guide des espaces de noms ne mentionnent WoW Forever | non |
| Page officielle « Realm Status » Europe | WoW Forever n'a pas de royaumes mais des ensembles de règles ; d'après The Forever Era, le menu de versions de la page ne proposait pas WoW Forever le 2026-09-30 | non |
| `foreverdb.net/status` | Sonde en TCP, chaque minute, le serveur de connexion de la **bêta** (`test.actual.battle.net:1119`) et les serveurs de jeu de la bêta (port 3724). Aucune API documentée ; son `robots.txt` interdit `/api/` | lien de référence |
| `theforeverera.com/fr/status/` | Ne sonde pas les serveurs : relève les avis officiels de Blizzard. Le fichier `status-now.json` qu'utilise la page n'est ni documenté ni offert à la réutilisation | lien de référence |
| Sonde TCP depuis ce serveur | Méthode de ForeverDB, sans dépendre d'un tiers | **oui** |

Conséquences :

- Les statuts affichés viennent **uniquement** des sondes de ce serveur. Aucun site tiers n'est
  interrogé, aucune page n'est analysée.
- Les **maintenances annoncées ne sont pas relevées** : aucune source officielle documentée ne les
  publie pour WoW Forever. La page renvoie au calendrier des maintenances de Blizzard et aux deux
  sites ci-dessus.
- Aucune adresse n'est configurée par défaut. Celles de la bêta ont été sondées en production du
  2026-10-09 au 2026-10-29. Elles restent dans l'environnement de la pile, mais **Paramètres** les
  remplace depuis le 2026-10-29.

## Configuration

Deux sources, dans cet ordre : la page **Paramètres** du tableau de bord, puis les variables
d'environnement du serveur web.

### Page Paramètres

`/settings`, bloc **Serveurs surveillés**. Les valeurs sont enregistrées en base (`app_settings`) et
appliquées aussitôt : le moniteur en cours est arrêté, un autre repart sur la nouvelle
configuration, sans redéployer.

| Réglage | Effet |
|---|---|
| Environnement affiché | libellé écrit à côté des serveurs : titre de la page, « Serveurs de jeu … », résumé de l'accueil. Vide : « EU » |
| Serveur de connexion, serveurs de jeu | `hôte:port`, une adresse par ligne, huit au plus par service. Enregistrer remplace les adresses de l'environnement ; une liste vide arrête la surveillance du service |
| Effacer l'historique des contrôles | supprime les contrôles antérieurs à l'enregistrement : disponibilité et changements d'état repartent de zéro, utile quand les serveurs surveillés changent |
| Revenir aux adresses de l'environnement | les variables ci-dessous s'appliquent de nouveau |

Une adresse saisie ici doit être **publique** : voir [SECURITY](SECURITY.md). Une adresse IP locale
ou privée est refusée à la saisie. Un nom d'hôte est jugé quand la sonde le résout : s'il désigne
une adresse interne, rien n'est sondé et le constat est « Adresse refusée ».

### Variables d'environnement

Elles s'appliquent à un service tant que **Paramètres** ne définit pas ses adresses. Les durées ne
se règlent qu'ici.

| Variable | Défaut | Rôle |
|---|---|---|
| `WOW_STATUS_AUTH_TARGETS` | vide | Serveur de connexion : `hôte:port`, séparées par des virgules |
| `WOW_STATUS_GAME_TARGETS` | vide | Serveurs de jeu européens : même forme |
| `WOW_STATUS_INTERVAL_SECONDS` | `300` | Secondes entre deux contrôles (30 à 3600) |
| `WOW_STATUS_TIMEOUT_MS` | `3000` | Délai sans réponse (500 à 10000) |
| `WOW_STATUS_DEGRADED_MS` | `400` | Latence à partir de laquelle un service qui répond est dit dégradé (50 à 10000) |

- Huit adresses au plus par service ; une IPv6 s'écrit `[2001:db8::1]:3724`.
- Une adresse mal formée ou une durée hors bornes n'arrête rien : elle est écartée et la page
  l'affiche en avertissement, sans répéter la valeur.
- Une variable est lue au démarrage : après une modification, recréer le conteneur `web`
  (**Deploy** dans Komodo).

En production, les saisir dans l'environnement de la pile Komodo (`deploy/proxmox/.env.example`).

## Adresses en service

Enregistrées dans **Paramètres** pour la sortie officielle : serveur de connexion le 2026-10-29,
serveurs de jeu le 2026-11-08.

| Service | Adresse | Provenance |
|---|---|---|
| Serveur de connexion | `eu.actual.battle.net:1119` | `_forever_\Logs\Connection.log` du 2026-10-29 (`Battle.net logon requested host="eu.actual.battle.net" port="1119"`) ; sondé depuis le conteneur `web` : en ligne, 27 ms |
| Serveurs de jeu | `37.244.29.131:3724` | connexion au royaume (Blizzard, RDAP `BLIZZARD`), ouverte 15 s après le lancement du client et gardée tout le temps de jeu ; relevée sur `MSI` le 2026-11-08 |
| | `34.187.88.149:3724` | serveur du monde (Google Cloud, RDAP `GOOGL-2`), ouvert à l'entrée en jeu ; relevé au même moment |

Le journal du client de la sortie officielle n'écrit aucune adresse (`peerAddr=…`), contrairement à
celui de la bêta : il ne nomme que le royaume (`realmAddress="93-5-5"`, six adresses d'entrée). Les
deux adresses de jeu viennent donc des connexions du client en jeu, relevées par
`Get-NetTCPConnection -OwningProcess (Get-Process Wow).Id -State Established` (port 3724). Premier
contrôle de production le 2026-11-08 à 20:30 : en ligne, deux adresses sur deux, 27 ms.

Le client ouvre une nouvelle connexion de monde à chaque changement de zone ou d'instance
(`Connecting to sourceRealmAddress=…` dans `Connection.log`). Si Blizzard déplace le serveur du
monde et que l'ancienne adresse cesse de répondre, le service passe à « Dégradé » (une adresse sur
deux) : relever de nouveau les connexions du client en jeu et remplacer l'adresse dans
**Paramètres**.

### Bêta, jusqu'au 2026-10-29

Relevées le 2026-10-09 dans `_classic_beta_\Logs\Connection.log` d'un client de la bêta, puis
sondées depuis le conteneur `web` de production. Elles restent dans l'environnement de la pile :

| Variable | Adresse | Rôle constaté |
|---|---|---|
| `WOW_STATUS_AUTH_TARGETS` | `test.actual.battle.net:1119` | portail Battle.net de la bêta (`Battle.net logon requested`) |
| `WOW_STATUS_GAME_TARGETS` | `24.105.52.77:3724` | entrée du royaume, première connexion de jeu, quittée après 4 secondes |
| | `24.105.52.94:3724` | ouverte après l'authentification au royaume, gardée jusqu'à la déconnexion |
| | `66.40.179.219:3724` | connexion secondaire à l'entrée en jeu, quittée après 4 secondes |
| | `66.40.178.65:3724` | ouverte à l'entrée en jeu, gardée jusqu'à la déconnexion |

- Les quatre adresses de jeu appartiennent à Blizzard (RDAP) et envoient dès la connexion
  `WORLD OF WARCRAFT CONNECTION - SERVER TO CLIENT - V2`. Aucune n'est un serveur de connexion.
- Le portail n'apparaît pas dans les connexions d'un client en jeu : le client le quitte dès qu'il
  est connecté au royaume. Seul le journal le nomme.
- Hébergement hors d'Europe, vraisemblablement aux États-Unis : plages d'adresses nord-américaines
  (ARIN), environ 160 ms de poignée de main depuis la Belgique, contre 60 ms vers
  `eu.actual.battle.net`.
- Le royaume annonce six adresses d'entrée, le journal ne nomme que celle qui a répondu. Blizzard
  peut retirer une adresse : le service passe alors à « Dégradé » (`partial`) sans panne réelle.
  Relever de nouveau les adresses dans ce cas.

Pour relever les adresses : celles que le client du jeu contacte, lues dans son journal
`Logs\Connection.log` (`logon requested host=…` pour le portail, `peerAddr=…` pour le jeu, quand il
l'écrit) ou dans ses connexions ouvertes, ou publiées par Blizzard. Ne renseigner qu'une adresse
vérifiée.

## Statuts

Chaque service est évalué sur l'ensemble de ses adresses, sondées en parallèle.

| Statut | Critère | Constat enregistré |
|---|---|---|
| En ligne | toutes les adresses acceptent la connexion, la plus rapide sous `WOW_STATUS_DEGRADED_MS` | `ok` |
| Dégradé | toutes répondent, mais la plus rapide atteint le seuil de latence | `slow` |
| Dégradé | une partie seulement des adresses répond | `partial` |
| Hors ligne | aucune ne répond et au moins une a **refusé** la connexion : panne confirmée par le serveur visé | `refused` |
| Hors ligne | aucune ne répond, silence jusqu'au délai : panne probable, non confirmée | `timeout` |
| Inconnu | aucune n'a été jointe : nom introuvable (`dns`), réseau de ce serveur (`network`), autre erreur (`error`) | `dns`, `network`, `error` |
| Inconnu | aucune adresse configurée, aucun contrôle encore fait, ou dernier contrôle périmé | aucune ligne |

Le seuil de 400 ms : une poignée de main TCP vers un centre de données européen prend quelques
dizaines de millisecondes ; un paquet d'ouverture perdu et réémis en ajoute environ mille. Au-delà
du seuil, le service répond mais le réseau ou le serveur peine.

La latence est celle de la poignée de main TCP de l'adresse la plus rapide. La résolution du nom
n'y entre pas.

## Rythme

| Règle | Détail |
|---|---|
| Intervalle | un tour par `WOW_STATUS_INTERVAL_SECONDS` (5 minutes par défaut), cadencé depuis le début du tour précédent |
| Un seul tour à la fois | une demande manuelle pendant un tour attend son résultat au lieu d'en lancer un second |
| Bouton **Actualiser** | contrôle immédiat de tous les services ; deux demandes à moins de 10 s ne valent qu'un contrôle |
| Backoff | sous un intervalle plus court que 5 minutes : après 3 échecs consécutifs (hors ligne ou inconnu), l'écart entre deux contrôles du service double à chaque échec, jusqu'à 5 minutes ; un succès rétablit le rythme. À l'intervalle par défaut, rien ne s'espace |
| Péremption | un dernier contrôle plus vieux que 15 minutes (trois intervalles ; sous un intervalle court, au moins le backoff maximal + un intervalle) ne vaut plus état présent : « Inconnu », dernière réponse rappelée |
| Arrêt | le minuteur est annulé, les connexions en cours fermées ; des sondes interrompues ne sont pas enregistrées |

L'affichage de la page ne déclenche aucune sonde : elle lit la base. Le navigateur relit la page à
chaque intervalle tant que l'onglet est visible, et n'ouvre lui-même aucune connexion vers les
serveurs de jeu.

## Stockage et historique

Table `server_status_checks` (voir [DATABASE](DATABASE.md)) : une ligne par service et par contrôle,
avec date, service, statut, constat, latence, adresses jointes sur adresses sondées, source (`tcp`)
et code d'erreur. Seul le **code** est gardé (`ECONNREFUSED`) : un message d'erreur contient
l'adresse visée. Conservation : 8 jours, purge une fois par heure.

| Affichage | Calcul |
|---|---|
| Disponibilité 24 heures | part du temps mesuré où le service répondait (en ligne ou dégradé). Affichée à partir de 30 minutes mesurées |
| Disponibilité 7 jours | idem, affichée à partir de 24 heures mesurées |
| Frise des 24 dernières heures | une case par heure, au pire statut constaté dans l'heure ; grise sans mesure |
| Changements d'état | 30 derniers changements de statut des 7 derniers jours |

Chaque contrôle vaut jusqu'au suivant, sans dépasser la durée de péremption (15 minutes par
défaut). Le calcul pondère par la durée, pas par le nombre de contrôles : pendant une panne ils
peuvent s'espacer, et les compter sous-estimerait la panne.
Le temps « Inconnu » n'entre ni dans la disponibilité ni dans la panne. Sans échantillon suffisant,
aucun pourcentage n'est affiché.

## Code

| Fichier (`web/src`) | Rôle |
|---|---|
| `lib/status/config.ts` | lecture et validation des variables, réglages du site compris |
| `lib/status/guard.ts` | adresses publiques seulement, pour celles saisies sur le site |
| `lib/status/probe.ts` | sonde TCP : connexion, mesure, fermeture, classement des erreurs |
| `lib/status/status.ts` | des résultats de sonde au statut, libellés |
| `lib/status/monitor.ts` | ordonnanceur : tour unique, backoff, demande manuelle, arrêt |
| `lib/status/store.ts` | écritures et lectures en base |
| `lib/status/view.ts` | ce que la page affiche |
| `lib/status/runtime.ts`, `instrumentation.ts` | un moniteur par processus, lancé au démarrage du serveur, remplacé quand les réglages changent |
| `lib/status/actions.ts` | action serveur du bouton **Actualiser** |
| `lib/settings/*`, `components/settings-forms.tsx`, `app/(dashboard)/settings/page.tsx` | page **Paramètres** : validation, enregistrement, formulaire |
| `components/server-status.tsx`, `status-refresh.tsx`, `app/(dashboard)/servers/page.tsx` | interface |

L'accueil affiche une miniature par service configuré, quand au moins une adresse l'est : statut,
latence, âge du dernier contrôle, frise réduite et disponibilité des 24 dernières heures
(`getServiceSummaries`, trois requêtes). Chaque miniature mène à la page Serveurs.

## Limites

- **Un port ouvert n'est pas un jeu qui fonctionne.** La sonde voit qu'un service écoute. File
  d'attente, royaume plein, liste de personnages qui n'arrive pas : rien de cela ne se voit.
- **Un seul point de mesure.** La sonde part de ce serveur. Une panne entre lui et Blizzard donne
  « Hors ligne » ou « Inconnu » alors que le jeu marche ; un problème entre votre connexion et
  Blizzard ne se voit pas.
- **Un délai dépassé n'est pas une preuve.** Un pare-feu qui ignore les paquets donne le même
  silence qu'un serveur arrêté. D'où le constat « panne probable, non confirmée ».
- **Pas de maintenance annoncée**, faute de source officielle documentée.
- **Une instance.** Chaque processus lance son moniteur : plusieurs instances web écriraient
  chacune leurs contrôles, et seule celle qui reçoit un enregistrement de **Paramètres**
  l'appliquerait sans redémarrer. Même limite que la limitation de débit (voir
  [SECURITY](SECURITY.md)).
- **Mémoire du backoff perdue au redémarrage** : le rythme normal reprend, sans autre effet.

## Diagnostic

| Symptôme | Cause probable | Vérification |
|---|---|---|
| « Inconnu — Aucune adresse configurée » | liste vide enregistrée dans **Paramètres**, ou variables vides ou absentes du conteneur | page **Paramètres**, puis `docker exec wow-altboard-web printenv WOW_STATUS_AUTH_TARGETS` |
| « Adresse refusée : elle ne désigne pas un serveur public » | nom d'hôte saisi dans **Paramètres** qui se résout vers une adresse locale ou privée | corriger l'adresse dans **Paramètres** |
| Avertissement en haut de page | adresse mal formée, durée hors bornes | corriger la variable, recréer le conteneur |
| « Aucun contrôle enregistré pour l'instant » | serveur démarré depuis moins d'un intervalle, ou base injoignable | journal du conteneur, événement `server_status.store_failed` |
| « Dernier contrôle trop ancien » | moniteur arrêté ou base injoignable | idem ; redémarrer `web` |
| « Nom d'hôte introuvable (DNS) » | faute dans le nom, ou DNS du conteneur | `docker exec wow-altboard-web nslookup <hôte>` |
| « Réseau injoignable depuis ce serveur » | pas de route, IPv6 absente, sortie filtrée | sonde manuelle ci-dessous |
| « Hors ligne » alors que le jeu marche | sortie filtrée vers ce port, ou mauvaise adresse | sonde manuelle ci-dessous, comparer avec ForeverDB |

Sonde manuelle depuis le conteneur, avec la même bibliothèque que le module :

```bash
docker exec wow-altboard-web node -e "
const s = require('net').connect({ host: process.argv[1], port: Number(process.argv[2]) });
const t = Date.now();
s.setTimeout(3000, () => { console.log('timeout'); s.destroy(); });
s.on('connect', () => { console.log('connecté en', Date.now() - t, 'ms'); s.destroy(); });
s.on('error', (e) => console.log(e.code));
" <hôte> <port>
```

Derniers contrôles et changements :

```sql
select checked_at, service, status, outcome, latency_ms, targets_up, targets_total, error
from server_status_checks order by checked_at desc limit 20;
```

```bash
docker logs wow-altboard-web 2>&1 | grep server_status   # changements de statut, échecs d'écriture
```

## Tests

`web/src/lib/status/*.test.ts` et `web/src/components/server-status.test.ts` : serveur accessible,
connexion refusée, délai dépassé, erreur DNS, interruption et fermeture des connexions, contrôles
simultanés, demande manuelle, backoff, arrêt et minuteurs, base indisponible, mesures périmées,
absence de configuration, pondération par la durée, rendu de chaque état, réglages du site
(remplacement des adresses, liste vide, libellé), adresses internes refusées à la saisie comme à
la sonde. `web/src/lib/settings/*.test.ts` : validation des saisies, enregistrement.
