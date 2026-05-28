# Notifications Supervision Card

Custom card Lovelace pour afficher dynamiquement les utilisateurs notifications
et les blocs de supervision Home Assistant.

## Installation HACS

V1 cible : depot HACS de type Dashboard plugin.

## Utilisation

```yaml
type: custom:notifications-supervision-card
sections:
  - users
  - audit
  - supervision
ignored_persons:
  - test_user
  - tester_rec
```

## Securite

La carte est en lecture seule : elle lit `hass.states`, ne lance aucun service
Home Assistant et ne contient aucun secret.


## Parametrage Home Assistant attendu

Cette carte HACS affiche et pilote a terme des helpers Home Assistant existants.
Elle n'installe pas le backend notification a elle seule. Le package HA doit
fournir :

- `script.notify_transverse` ;
- `input_boolean.notif_smtp_active` ;
- `input_text.notif_<slug>_label` ;
- `input_text.notif_<slug>_email` ;
- `input_boolean.notif_<slug>_email_enabled` ;
- `input_text.notif_<slug>_push_target` ;
- `input_boolean.notif_<slug>_push_enabled` ;
- les helpers de tiers `notif_<slug>_tier_*`.

### SMTP

Le service email attendu est `notify.notify_smtp`. Il doit etre configure dans
Home Assistant avec des secrets locaux, jamais dans Git.

### Push mobile_app

Le service push attendu est actuellement stocke sous forme de texte dans
`input_text.notif_<slug>_push_target`, au format `notify.mobile_app_<device>`.
Une prochaine version pourra proposer une selection des services
`notify.mobile_app_*` disponibles : un choix si plusieurs appareils existent,
proposition automatique si un seul appareil est detecte.

## Roadmap V1.x

- Decouper la carte en vues/tuiles agenceables : `users`, `audit`,
  `supervision`, `settings`.
- Eviter toute carte monolithique tout en longueur.
- Ajouter une vue `settings` permettant d'activer/desactiver explicitement les
  notifications via allowlist de helpers.
- Conserver la vue `supervision` en lecture seule.
