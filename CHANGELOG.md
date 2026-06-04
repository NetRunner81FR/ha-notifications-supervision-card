# Changelog

## 0.5.3

- Correction : version interne et comportement stable apres serie de patches 0.5.x.
- Correction : rendu correct en RECETTE avec HACS (ressource /hacsfiles/).
- Correction : roles utilisateur correctement identifies (utilisateur vs resident).

## 0.5.2

- Fix : detection de conflit d'id lors de l'ajout d'un utilisateur (add_user).

## 0.5.1

- Fix : formulaire d'ajout simplifie, champs email et push_target optionnels.

## 0.5.0

- Architecture : split en 4 cartes independantes (view: users/audit/supervision/settings).
- Chaque vue peut etre utilisee independamment dans un dashboard Lovelace.
- Suppression de lovelace.resources manuel : HACS gere la ressource.

## 0.4.1

- Fix : audit slug normalise, champ email editable.

## 0.4.0

- Nouveau : vue settings avec ajout d'utilisateurs depuis la card.
- Nouveau : suppression d'utilisateurs avec confirmation inline.
- Nouveau : guide de setup si notifications_manager n'est pas charge.
- Nouveau : slug auto-derive depuis le friendly_name HA.
- Nouveau : protection anti-suppression de son propre compte.
- Nouveau : examples/ complets (configuration.yaml, notifications_users.yaml, notify_transverse.yaml, dashboard).
- README standalone : installation et configuration sans acces au depot factory.

## 0.3.1

- Fix : crash _renderUsers quand u.tiers est absent.

## 0.3.0

- Migration vers notifications_manager (integration Python) : entites switch.* et text.*.
- Vue settings avec acces par role (admin vs autres).
- notify_transverse v2.0 : decouverte via text.notif_*_label.
- Services add_user, update_user, remove_user depuis la card.

## 0.2.1

- Fix : ajout de input_number.temperature_anomalie_seuil_haut et
  input_number.temperature_anomalie_seuil_bas dans le groupe Temperatures
  des groupes supervision par defaut (absents de la v0.2.0).
- Fix : label groupe portails aligne sur l'historique : Portails / Garage.

## 0.2.0

- Architecture modulaire : parametre view remplace sections.
- Vues disponibles : users, audit, supervision, settings.
- Retrocompatibilite : sections reste supporte (mode legacy).
- Vue settings en mode lecture par defaut.
- Vue settings avec mode: edit : activation/desactivation des helpers notification.
- Detection automatique des services notify.mobile_app_* disponibles.
- Filtrage supervision par group.
- Console navigateur : log colore avec version.

## 0.1.2

- Premiere version SANDBOX.
