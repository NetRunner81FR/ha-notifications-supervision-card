# notifications-supervision-card

Custom Lovelace card for Home Assistant — notifications supervision and user settings.

Requires `custom_components/notifications_manager` (v1.0+) from the homeassistant-factory project.

## Version

v0.3.0-beta.1

## Installation via HACS

1. HACS > Custom repositories > add this repo > type Plugin
2. Enable "Beta updates" to see pre-releases
3. Install "Notifications Supervision Card"
4. Add the card to your dashboard

## Lovelace usage

```yaml
type: custom:notifications-supervision-card
view: users
```

```yaml
type: custom:notifications-supervision-card
view: settings
```

```yaml
type: custom:notifications-supervision-card
view: supervision
group: temperatures
```

## Access matrix

| Profile | Read | Write |
| --- | --- | --- |
| HA admin | yes | yes |
| module role admin | yes | yes |
| module role proprietaire | yes | no |
| module role resident | no | no |
| module role utilisateur | no | no |

## Prerequisites

- `custom_components/notifications_manager` installed and loaded
- `notifications_users.yaml` configured per environment
- `script.notify_transverse` v2.0+
