# notifications-supervision-card

Custom Lovelace card for Home Assistant — manage notification profiles and
supervision dashboards dynamically.

Version: 0.4.0-beta.1

## Prerequisites

- Home Assistant 2024.x or later
- `notifications_manager` custom integration installed in `custom_components/`
  (see repository — HACS integration publication planned)
- `notifications_users.yaml` configured at `/config/notifications_users.yaml`

## Installation via HACS

1. HACS > Custom repositories > add this repository URL > type **Plugin**
2. Enable **Beta updates** in HACS settings to see pre-releases
3. Install **Notifications Supervision Card**
4. Clear browser cache (Ctrl+Shift+R)

## Configuration

### 1. Install notifications_manager

Copy `custom_components/notifications_manager/` to your HA `config/custom_components/`.

### 2. Update configuration.yaml

Add to your `configuration.yaml` (see `examples/configuration.yaml`):

```yaml
notifications_manager: {}
```

If HACS manages the card, the resource is added automatically.
If you deploy the JS manually, also add:

```yaml
frontend:
  extra_module_url:
    - /local/custom-cards/notifications-supervision-card.js?v=0.4.0
```

### 3. Create notifications_users.yaml

Copy `examples/notifications_users.yaml` to `/config/notifications_users.yaml`
and adapt it to your users. Restart Home Assistant.

### 4. Add notify_transverse package (optional but recommended)

Copy `examples/packages/notify_transverse.yaml` to your HA packages folder.
This provides the `script.notify_transverse` service for sending notifications
by role (admin, proprietaire, resident, utilisateur).

### 5. Add dashboard

See `examples/dashboards/notifications-dashboard.yaml` for a complete example.

## Lovelace card reference

### view: settings (requires mode: edit for write access)

Manage notification profiles: edit channels and roles for existing users,
add users from HA persons, remove users.

```yaml
type: custom:notifications-supervision-card
view: settings
mode: edit
```

Access matrix:
- HA admin or module role admin: full edit access
- Module role proprietaire: read-only
- Others: access denied

### view: users

Display all configured notification profiles.

```yaml
type: custom:notifications-supervision-card
view: users
```

### view: audit

Compare HA persons with configured notification profiles.

```yaml
type: custom:notifications-supervision-card
view: audit
ignored_persons:
  - test_user
```

### view: supervision

Monitor notification guard entities (input_boolean.*_notifications).

```yaml
type: custom:notifications-supervision-card
view: supervision
# Optional: filter to one group
group: mqtt
```

## notifications_users.yaml structure

```yaml
version: 1
users:
  - id: jean            # ASCII slug, lowercase, no spaces
    ha_user: jean       # HA account name (hass.user.name)
    label: "Jean"
    email: ""
    email_enabled: false
    push_target: ""     # e.g. notify.mobile_app_my_phone
    push_enabled: false
    roles:
      admin: true
      proprietaire: false
      resident: false
      utilisateur: false
```

Reload without restart: call service `notifications_manager.reload`.

## Troubleshooting

**Card shows setup guide:** `notifications_manager` is not loaded or no user
is configured. Check logs for integration errors.

**Card shows "Access denied":** your HA account is not mapped to a
`notifications_users.yaml` entry with role admin or proprietaire.

**Double load warning in console:** normal if both HACS resource and
`extra_module_url` are active. The card handles double registration gracefully.

**Entities not appearing:** restart HA after modifying `notifications_users.yaml`
or call `notifications_manager.reload`.
