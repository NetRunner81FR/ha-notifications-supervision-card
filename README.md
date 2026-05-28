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
