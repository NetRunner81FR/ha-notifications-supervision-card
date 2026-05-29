# Notifications Supervision Card

Custom card Lovelace pour afficher et parametrer dynamiquement les utilisateurs
notifications et les blocs de supervision Home Assistant.
Cette feature s'appuie sur des développements propriétaires et des modules non mis à disposition. Ce n'est pas destiné à être utilisé par le grand public

## Installation HACS

Type : Dashboard plugin.
Depot GitHub : `https://github.com/NetRunner81FR/ha-notifications-supervision-card`

## Utilisation

### Vue utilisateurs

```yaml
type: custom:notifications-supervision-card
view: users
ignored_persons:
  - test_user
  - tester_rec
```

### Vue audit personnes HA

```yaml
type: custom:notifications-supervision-card
view: audit
ignored_persons:
  - test_user
```

### Vue supervision (tous les groupes)

```yaml
type: custom:notifications-supervision-card
view: supervision
```

### Vue supervision (groupe unique)

```yaml
type: custom:notifications-supervision-card
view: supervision
group: mqtt
```

Valeurs de `group` disponibles par defaut :
`inondation`, `portails`, `mqtt`, `zigbee`, `temperatures`, `rpi5`,
`veilleuse`, `backup`.

### Vue parametres (lecture)

```yaml
type: custom:notifications-supervision-card
view: settings
```

### Vue parametres (edition)

```yaml
type: custom:notifications-supervision-card
view: settings
mode: edit
```

La vue `settings` avec `mode: edit` permet d'activer ou desactiver les helpers
de notification via une allowlist stricte. La vue `supervision` reste toujours
en lecture seule.

### Mode legacy (retrocompatibilite v0.1.x)

```yaml
type: custom:notifications-supervision-card
sections:
  - users
  - audit
  - supervision
ignored_persons:
  - test_user
```

## Securite

- `supervision` : lecture seule, aucun appel de service.
- `settings` / `mode: edit` : uniquement `input_boolean.callService` et
  `input_text.set_value` sur entites correspondant a la regex allowlist.
- Aucun appel reseau externe.
- Aucun secret embarque.
- Aucune commande PROD.

## Parametrage Home Assistant attendu

La carte HACS affiche et pilote des helpers existants. Le package HA doit
fournir :

- `script.notify_transverse`
- `input_boolean.notif_smtp_active`
- `input_text.notif_<slug>_label`
- `input_text.notif_<slug>_email`
- `input_boolean.notif_<slug>_email_enabled`
- `input_text.notif_<slug>_push_target`
- `input_boolean.notif_<slug>_push_enabled`
- `input_boolean.notif_<slug>_tier_*`

### SMTP

Service attendu : `notify.notify_smtp`, configure avec secrets locaux, jamais
dans Git.

### Push mobile_app

Cible stockee dans `input_text.notif_<slug>_push_target` au format
`notify.mobile_app_<device>`. En vue `settings` + `mode: edit`, si des services
`notify.mobile_app_*` sont detectes, un dropdown de selection est propose.

## Publication d'une nouvelle version

Les versions HACS doivent etre publiees sous forme de GitHub Release.

```bash
git add .
git commit -m "feat: release vX.Y.Z"
git push origin main
git push github main
git tag vX.Y.Z
git push github vX.Y.Z
git push origin vX.Y.Z
```

Puis creer la release GitHub `vX.Y.Z` sur :

```
https://github.com/NetRunner81FR/ha-notifications-supervision-card/releases
```

Apres publication, utiliser `Update information` dans HACS puis installer la
nouvelle version en SANDBOX avant toute promotion.

Procedure complete : `docs/procedures/composants-hacs-custom.md`
