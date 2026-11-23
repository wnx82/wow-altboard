# Notifications

Le site peut prévenir un outil extérieur, n8n par exemple, quand quelque chose arrive : un niveau
gagné, un objectif atteint, le serveur de jeu qui répond de nouveau, un PC qui ne synchronise plus,
une alerte de prix franchie, et chaque lundi un rapport de la semaine écoulée. Il envoie chaque événement en JSON, par une
requête `POST` vers une adresse réglée dans **Paramètres → Notifications**. Le site n'envoie ni
e-mail ni message lui-même : n8n s'en charge (Discord, Telegram, e-mail…).

Code : `web/src/lib/notify/`. Tables : `app_settings` (réglages), `notification_state` et
`price_alerts.notified_at` ([DATABASE](DATABASE.md)). Sécurité : [SECURITY § Notifications](SECURITY.md#notifications-webhook-sortant).

## Réglages

| Réglage | Détail |
|---|---|
| Adresse du webhook | `http` ou `https`, 500 caractères au plus, sans identifiants (`user:pass@`) ni fragment (`#…`). Vide à l'enregistrement : l'adresse en place est gardée. Jamais réaffichée : la page n'en montre que `schéma://hôte/…` |
| Jeton (facultatif) | envoyé en `Authorization: Bearer <jeton>`, 200 caractères au plus. Vide : le jeton en place est gardé ; « Retirer le jeton » l'efface. Jamais réaffiché |
| Événements envoyés | cases à cocher ; toutes cochées par défaut |
| PC muet au-delà de | 1 à 60 jours sans synchronisation ; 3 par défaut |
| Retirer le webhook | efface l'adresse et le jeton : plus rien n'est envoyé |
| Envoyer un essai | envoie l'événement `test` à l'adresse enregistrée et affiche le statut HTTP reçu ; cinq essais par tranche de cinq minutes |

## Configurer n8n

1. Ajouter un nœud **Webhook** : méthode `POST`, réponse « Immediately ».
2. Pour exiger le jeton : **Authentication → Header Auth**, nom `Authorization`, valeur
   `Bearer <jeton>`, le même jeton que dans **Paramètres**.
3. Copier l'adresse de production du nœud (`…/webhook/…`, pas `…/webhook-test/…`) dans
   **Paramètres → Notifications**, enregistrer, puis **Envoyer un essai**.
4. Aiguiller sur `{{ $json.body.event }}` (nœud **Switch**) ; `{{ $json.body.text }}` est une
   phrase prête à envoyer telle quelle.

Toute réponse `2xx` vaut réception. Une redirection est refusée : elle pourrait emporter le jeton
vers une autre adresse.

## Format

En-têtes : `content-type: application/json`, `user-agent: WoW-AltBoard`, et
`authorization: Bearer …` quand un jeton est enregistré. Corps :

```json
{
  "source": "wow-altboard",
  "event": "level.gained",
  "at": "2026-11-14T12:15:03.120Z",
  "text": "Élodie Brisefer atteint le niveau 26.",
  "data": { "characterId": 1, "character": "Élodie Brisefer", "from": 25, "to": 26 }
}
```

`at` est l'heure de l'envoi ; `data` dépend de l'événement.

| Case | `event` | Quand | `data` |
|---|---|---|---|
| Niveau gagné | `level.gained` | un relevé montre un niveau plus haut que le relevé précédent du même personnage ; un seul événement par personnage et par passage, même pour plusieurs niveaux ou plusieurs relevés | `characterId`, `character`, `from`, `to` |
| Objectif atteint | `goal.reached` | un objectif est daté comme atteint, automatiquement à la synchronisation ou coché à la main ; une fois par atteinte : un objectif à cocher décoché puis recoché est annoncé de nouveau | `goalId`, `goal`, `characterId`, `character`, `achievedAt` |
| Serveur de jeu de nouveau en ligne | `server.online` | le service « jeu » répond (en ligne ou en partie) après au moins deux contrôles hors ligne d'affilée ; les contrôles « inconnu » ne comptent pas | `status` (`online`, `degraded`), `latencyMs`, `checkedAt`, `downSince` |
| PC muet depuis plusieurs jours | `machine.silent` | un PC n'a rien synchronisé depuis le délai réglé ; une fois par silence : il sera de nouveau signalé seulement après une synchronisation puis un nouveau silence | `machineId`, `machine`, `lastSeenAt`, `days` |
| Alerte de prix déclenchée | `price.alert` | le dernier prix d'un objet atteint un seuil posé sur sa fiche ([ECONOMY-ENGINE § Alertes](ECONOMY-ENGINE.md#alertes-de-prix-alertsts)) ; une fois par franchissement : l'alerte se réarme quand le prix repasse de l'autre côté du seuil. Un seuil déjà franchi quand il est posé n'est pas annoncé. Le prix change à chaque relevé reçu (Auctionator, ou scan EZAuctioneer d'un marché relié) | `alertId`, `marketId`, `market`, `itemKey`, `item`, `direction` (`below`, `above`), `thresholdCopper`, `priceCopper`, `day`, `observedAt` (heure du scan, ou `null`), `source` (`auctionator`, `ezauctioneer`), `url` (page de l'objet ; `null` sans `WOW_APP_ORIGIN`) |
| Rapport hebdomadaire | `report.weekly` | le lundi à partir de 9 h (heure de Bruxelles), pour la semaine du lundi au dimanche précédents | `week`, `levels` (`name`, `from`, `to`), `levelsGained`, `goldStart`, `goldEnd`, `goldDelta` (cuivre), `playedSeconds`, `sessions`, `goals` (`character`, `label`) |
| — | `test` | bouton **Envoyer un essai** | `{}` |

Exemple d'alerte : « Alerte de prix : Étoffe de lin à 27 pc, seuil bas 30 pc (PvE · WoW Forever). »

Exemple de rapport : « Semaine du 9 novembre : 2 niveaux gagnés (Élodie Brisefer 24 → 26) ; or :
+2 po 50 pa 0 pc (total 3 po 50 pa 0 pc) ; temps joué : 3 h 50 en 2 sessions ; aucun objectif
atteint. » Le temps joué vient des sessions d'Allemano Ledger : chaque PC ne connaît que les
siennes.

## Fonctionnement

- Un passage par minute, le premier 30 s après le démarrage du serveur ; jamais deux à la fois.
  Un événement part donc dans la minute qui suit la synchronisation ou le contrôle qui le montre.
- **Rien du passé n'est annoncé.** Au tout premier passage, les relevés, contrôles et objectifs
  déjà en base sont marqués comme vus, et les PC déjà muets comme signalés. Sans webhook, les
  passages continuent de marquer ce qu'ils voient : enregistrer une adresse ne déclenche pas une
  rafale d'anciens événements.
- Une case décochée n'est pas rattrapée : ce qui arrive pendant ce temps est perdu pour elle.
- **Pas de nouvel essai.** Un envoi qui échoue (réponse non `2xx`, 10 s sans réponse, adresse
  injoignable) est noté dans le journal du serveur (`notify.failed`) et abandonné.
- Les événements d'un passage partent un par un, dans l'ordre où ils ont été relevés.
- Une seule instance du site est prévue : l'état (`notification_state`) est verrouillé pendant un
  passage, mais deux instances enverraient chacune leurs événements dans la même minute.

## Journal

`notify.sent` et `notify.failed` : type d'événement, statut HTTP, durée et, en cas d'échec, la
raison (`réponse HTTP 500`, `pas de réponse en 10 s`, `webhook injoignable`). Ni l'adresse ni le
jeton. `settings.notify.saved` indique seulement ce qui a changé (`replaced`, `kept`, `removed`),
`settings.notify.removed` le retrait du webhook.
