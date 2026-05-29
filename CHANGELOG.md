# Changelog

## 0.2.1

- Fix : ajout de `input_number.temperature_anomalie_seuil_haut` et
  `input_number.temperature_anomalie_seuil_bas` dans le groupe Temperatures
  des groupes supervision par defaut (absents de la v0.2.0).
- Fix : label groupe portails aligne sur l'historique : "Portails / Garage".

## 0.2.0

- Architecture modulaire : parametre `view` remplace `sections`.
- Vues disponibles : `users`, `audit`, `supervision`, `settings`.
- Retrocompatibilite : `sections` reste supporte (mode `legacy`).
- Vue `settings` en mode lecture par defaut.
- Vue `settings` avec `mode: edit` : activation/desactivation des helpers
  notification via regex allowlist (`input_boolean.notif_smtp_active`,
  `notif_<slug>_email_enabled`, `notif_<slug>_push_enabled`,
  `<domaine>_notifications`).
- Detection automatique des services `notify.mobile_app_*` disponibles
  (dropdown si plusieurs, hint si un seul).
- Filtrage supervision par `group` (exemple : `group: mqtt`).
- Titre automatique court par vue, surcharge possible via `title`.
- Groupes supervision avec identifiant `id` pour le filtrage.
- Console navigateur : log colore avec version.
- Dashboard bis mis a jour avec 4 tuiles agenceables.

## 0.1.2

- Premiere version SANDBOX.
