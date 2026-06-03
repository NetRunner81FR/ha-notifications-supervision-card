const CARD_NAME = "notifications-supervision-card";
const VERSION = "0.4.0";

// Allowlist entites modifiables (canaux + roles via notifications_manager, SMTP global).
const SETTINGS_ALLOWLIST =
  /^(switch\.notif_[a-z0-9_]+_(email_enabled|push_enabled|role_(admin|proprietaire|resident|utilisateur))|input_boolean\.notif_smtp_active|input_boolean\.[a-z0-9_]+_notifications)$/;

// Allowlist push target : text.notif_*_push_target (notifications_manager v1+)
const PUSH_TARGET_ALLOWLIST = /^text\.notif_[a-z0-9_]+_push_target$/;

class NotificationsSupervisionCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: `custom:${CARD_NAME}`,
      view: "users",
      ignored_persons: ["test_user", "tester_rec"],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    // Etat formulaire add/remove (persiste entre les renders hass)
    this._addExpanded = null;  // slug person en cours d'ajout
    this._addForm = {};        // valeurs du formulaire {label,id,email,pushTarget,roles}
    this._removeConfirm = null; // slug user en attente de confirmation suppression
  }

  setConfig(config) {
    const hasSections =
      Array.isArray(config.sections) || typeof config.sections === "string";
    const hasView = typeof config.view === "string" && config.view.length > 0;

    this._config = {
      // Nouveau parametre view ; si absent mais sections present -> mode legacy
      view: hasView ? config.view : hasSections ? "legacy" : "users",
      // Mode legacy : sections conservees pour retro-compat
      sections: hasSections
        ? Array.isArray(config.sections)
          ? config.sections
          : [String(config.sections)]
        : ["users", "audit", "supervision"],
      // Filtre optionnel pour supervision (ex: group: mqtt)
      group: config.group || null,
      // Mode edit uniquement dans view: settings
      mode: config.mode === "edit" ? "edit" : "read",
      // Titre personnalise (remplace l'auto-titre)
      title: config.title || null,
      // Personnes HA a exclure de l'audit
      ignored_persons: Array.isArray(config.ignored_persons)
        ? config.ignored_persons
        : [],
      // Groupes supervision personnalises
      supervision_groups: config.supervision_groups || null,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const sizes = {
      users: 4,
      audit: 3,
      supervision: 5,
      settings: 5,
      legacy: 10,
    };
    return sizes[this._config.view] ?? 5;
  }

  // ── Titre automatique par vue ──────────────────────────────────────────────

  _autoTitle() {
    if (this._config.title) return this._config.title;
    const map = {
      users: "Utilisateurs notifications",
      audit: "Audit couverture HA",
      supervision:
        this._config.group
          ? `Supervision – ${this._config.group}`
          : "Supervision",
      settings: "Paramètres notifications",
      legacy: "Notifications / Supervision",
    };
    return map[this._config.view] ?? "Notifications / Supervision";
  }

  // ── Rendu principal ────────────────────────────────────────────────────────

  _render() {
    if (!this.shadowRoot || !this._hass) return;

    const view = this._config.view;
    let body = "";

    if (view === "legacy") {
      const sections = new Set(this._config.sections);
      const users = this._discoverUsers();
      if (sections.has("users")) body += this._renderUsers(users);
      if (sections.has("audit")) body += this._renderAudit(this._auditPersons(users));
      if (sections.has("supervision")) body += this._renderSupervision(this._discoverSupervision());
    } else if (view === "users") {
      body = this._renderUsers(this._discoverUsers());
    } else if (view === "audit") {
      body = this._renderAudit(this._auditPersons(this._discoverUsers()));
    } else if (view === "supervision") {
      body = this._renderSupervision(this._discoverSupervision());
    } else if (view === "settings") {
      if (!this._hasNotifEntities()) {
        body = this._renderSetupGuide();
      } else {
        const users = this._discoverUsers();
        body = this._renderSettings(users);
      }
    } else {
      body = `<div class="empty">Vue inconnue : ${this._escape(view)}</div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card">
          <div class="head">
            <span class="card-title">${this._escape(this._autoTitle())}</span>
            <span class="version">v${VERSION}</span>
          </div>
          ${body}
        </div>
      </ha-card>`;

    if (view === "settings") {
      this._attachSettingsListeners();
    }
  }

  // ── Decouverte ─────────────────────────────────────────────────────────────

  _discoverUsers() {
    return Object.keys(this._hass.states || {})
      .filter((id) => id.startsWith("text.notif_") && id.endsWith("_label"))
      .map((id) => {
        const slug = id.slice("text.notif_".length, -"_label".length);
        return {
          slug,
          label: this._state(id),
          email: this._state(`text.notif_${slug}_email`),
          emailEnabled: this._boolState(`switch.notif_${slug}_email_enabled`),
          pushTarget: this._state(`text.notif_${slug}_push_target`),
          pushEnabled: this._boolState(`switch.notif_${slug}_push_enabled`),
          roles: [
            ["Admin", "role_admin"],
            ["Propriétaire", "role_proprietaire"],
            ["Résident", "role_resident"],
            ["Utilisateur", "role_utilisateur"],
          ]
            .filter(([, k]) => this._boolState(`switch.notif_${slug}_${k}`) === true)
            .map(([name]) => name),
        };
      })
      .filter((u) => this._isUseful(u.label))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }

  // Resout le niveau d acces a la vue settings pour l utilisateur HA courant.
  // Retourne "write", "read" ou "none".
  _resolveSettingsAccess() {
    if (!this._hass) return "none";
    if (this._hass.user?.is_admin) return "write";
    const haName = (this._hass.user?.name || "").toLowerCase();
    if (!haName) return "none";
    // Chercher un profil dont ha_user correspond au compte HA courant
    const slug = Object.keys(this._hass.states || {})
      .filter((id) => id.startsWith("text.notif_") && id.endsWith("_label"))
      .map((id) => id.slice("text.notif_".length, -"_label".length))
      .find((s) => {
        const label = (this._state(`text.notif_${s}_label`) || "").toLowerCase();
        return label === haName || s === haName.replace(/[^a-z0-9]/g, "_");
      });
    if (!slug) return "none";
    if (this._boolState(`switch.notif_${slug}_role_admin`) === true) return "write";
    if (this._boolState(`switch.notif_${slug}_role_proprietaire`) === true) return "read";
    return "none";
  }

  _auditPersons(users) {
    const configured = new Set(users.map((u) => this._normalize(u.label)));
    const ignored = new Set(
      this._config.ignored_persons.map((p) => this._normalize(p))
    );
    const persons = Object.entries(this._hass.states || {})
      .filter(([id]) => id.startsWith("person."))
      .map(([id, s]) => ({
        id,
        name: s.attributes?.friendly_name || id.slice(7),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));

    const missing = [];
    const ignoredList = [];
    for (const p of persons) {
      const keys = [
        this._normalize(p.name),
        this._normalize(p.id),
        this._normalize(p.id.slice(7)),
      ];
      if (keys.some((k) => ignored.has(k))) {
        ignoredList.push(p);
      } else if (!keys.some((k) => configured.has(k))) {
        missing.push(p);
      }
    }
    return { persons, missing, ignored: ignoredList };
  }

  // Vrai si notifications_manager est charge (au moins une entite notif existe)
  _hasNotifEntities() {
    return Object.keys(this._hass.states || {}).some(
      (id) => id.startsWith("text.notif_") || id.startsWith("switch.notif_")
    );
  }

  // Derive un slug ASCII depuis un friendly_name
  _toSlug(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
  }

  // Vrai si le slug correspond au compte HA courant (protection anti-lockout)
  _isSelf(slug) {
    if (!this._hass.user) return false;
    const haName = (this._hass.user.name || "").toLowerCase();
    const label = (this._state(`text.notif_${slug}_label`) || "").toLowerCase();
    return label === haName || slug === haName.replace(/[^a-z0-9]/g, "_");
  }

  _discoverSupervision() {
    const groups =
      this._config.supervision_groups || this._defaultSupervisionGroups();
    const filtered = this._config.group
      ? groups.filter(
          (g) =>
            this._normalize(g.id ?? g.title) ===
            this._normalize(this._config.group)
        )
      : groups;
    return filtered
      .map((g) => ({
        ...g,
        entities: (g.entities || []).filter((id) => this._hass.states[id]),
      }))
      .filter((g) => g.entities.length > 0);
  }

  _defaultSupervisionGroups() {
    return [
      {
        id: "inondation",
        title: "Inondation",
        icon: "mdi:water-alert",
        entities: [
          "input_boolean.inondation_notifications",
          "input_text.inondation_last_event",
        ],
      },
      {
        id: "portails",
        title: "Portails / Garage",
        icon: "mdi:gate",
        entities: [
          "input_boolean.portail_notifications",
          "input_text.portail_last_event",
        ],
      },
      {
        id: "mqtt",
        title: "MQTT",
        icon: "mdi:server-network",
        entities: [
          "input_boolean.mqtt_watchdog_notifications",
          "binary_sensor.mqtt_broker_hors_ligne",
          "input_text.mqtt_watchdog_last_event",
        ],
      },
      {
        id: "zigbee",
        title: "Zigbee",
        icon: "mdi:zigbee",
        entities: [
          "input_boolean.zigbee_watchdog_notifications",
          "input_number.zigbee_watchdog_battery_seuil",
          "input_text.zigbee_watchdog_last_event",
        ],
      },
      {
        id: "temperatures",
        title: "Températures",
        icon: "mdi:thermometer-alert",
        entities: [
          "input_boolean.temperature_anomalie_notifications",
          "binary_sensor.temperature_anomalie_detectee",
          "input_number.temperature_anomalie_seuil_haut",
          "input_number.temperature_anomalie_seuil_bas",
          "input_text.temperature_anomalie_last_event",
        ],
      },
      {
        id: "rpi5",
        title: "RPi5",
        icon: "mdi:raspberry-pi",
        entities: [
          "input_boolean.rpi5_monitoring_notifications",
          "sensor.rpi5_health_status",
          "input_text.rpi5_monitoring_last_event",
        ],
      },
      {
        id: "veilleuse",
        title: "Veilleuse Axel",
        icon: "mdi:lightbulb-night",
        entities: ["counter.veilleuse_axel_nuit"],
      },
      {
        id: "backup",
        title: "Backup HA",
        icon: "mdi:backup-restore",
        entities: ["sensor.backup_last_successful_automatic_backup"],
      },
    ];
  }

  _discoverDomainNotifications() {
    return Object.keys(this._hass.states || {})
      .filter(
        (id) =>
          id.startsWith("input_boolean.") &&
          id.endsWith("_notifications") &&
          !id.startsWith("input_boolean.notif_") &&
          SETTINGS_ALLOWLIST.test(id)
      )
      .sort();
  }

  _detectMobileApps() {
    const notify = this._hass.services?.notify ?? {};
    return Object.keys(notify)
      .filter((k) => k.startsWith("mobile_app_"))
      .map((k) => `notify.${k}`)
      .sort();
  }

  // ── Rendus sections ────────────────────────────────────────────────────────

  _renderUsers(users) {
    if (!users.length) {
      return `<div class="empty">Aucun utilisateur notification détecté.</div>`;
    }
    const tiles = users
      .map((u) => {
        const ok = u.emailEnabled || u.pushEnabled || u.roles.length > 0;
        return `<article class="tile">
          <div class="tile-head">
            <strong>${this._escape(u.label)}</strong>
            ${this._badge(ok ? "OK" : "Incomplet", ok ? "ok" : "warn")}
          </div>
          <div class="rows">
            ${this._row(
              "Email",
              u.emailEnabled === true ? "Actif" : "Inactif",
              u.email
            )}
            ${this._row(
              "Push",
              u.pushEnabled === true ? "Actif" : "Inactif",
              u.pushTarget
            )}
            ${this._row(
              "Niveaux",
              u.roles.length ? u.roles.join(", ") : "Aucun",
              ""
            )}
          </div>
        </article>`;
      })
      .join("");
    return `<div class="grid">${tiles}</div>`;
  }

  _renderAudit(audit) {
    const ok = audit.missing.length === 0;
    const missingHtml = audit.missing.length
      ? audit.missing.map((p) => `<li>${this._escape(p.name)}</li>`).join("")
      : `<li>Aucune personne non couverte.</li>`;
    const ignoredHtml = audit.ignored.length
      ? audit.ignored.map((p) => `<li>${this._escape(p.name)}</li>`).join("")
      : `<li>Aucune exclusion active.</li>`;
    return `<article class="tile wide">
      <div class="tile-head">
        <strong>Couverture personnes HA</strong>
        ${this._badge(ok ? "OK" : "À vérifier", ok ? "ok" : "warn")}
      </div>
      <div class="audit">
        <div><h4>À traiter</h4><ul>${missingHtml}</ul></div>
        <div><h4>Ignorées</h4><ul>${ignoredHtml}</ul></div>
      </div>
    </article>`;
  }

  _renderSupervision(groups) {
    if (!groups.length) {
      return `<div class="empty">Aucun bloc supervision disponible.</div>`;
    }
    const tiles = groups
      .map(
        (g) => `<article class="tile">
        <div class="tile-head">
          <strong>${this._escape(g.title)}</strong>
          ${this._badge("Visible", "ok")}
        </div>
        <div class="rows">
          ${g.entities.map((id) => this._entityRow(id)).join("")}
        </div>
      </article>`
      )
      .join("");
    return `<div class="grid">${tiles}</div>`;
  }

  _renderSettings(users) {
    const access = this._resolveSettingsAccess();
    if (access === "none") {
      return `<div class="banner read-banner">Accès non autorisé.</div>`;
    }
    const editable = access === "write" && this._config.mode === "edit";
    const mobileApps = this._detectMobileApps();
    const domainIds = this._discoverDomainNotifications();

    const banner = editable
      ? `<div class="banner edit-banner">Mode édition — modifications appliquées immédiatement</div>`
      : access === "write"
        ? `<div class="banner read-banner">Lecture seule — ajoutez <code>mode: edit</code> pour modifier.</div>`
        : `<div class="banner read-banner">Lecture seule (rôle propriétaire).</div>`;

    const smtpHtml = this._settingsToggle(
      "input_boolean.notif_smtp_active",
      "Canal email global (SMTP)",
      this._boolState("input_boolean.notif_smtp_active"),
      editable
    );

    const rolesLabels = [
      ["Admin", "role_admin"],
      ["Propriétaire", "role_proprietaire"],
      ["Résident", "role_resident"],
      ["Utilisateur", "role_utilisateur"],
    ];

    const userTiles = users.map((u) => {
      if (editable && this._removeConfirm === u.slug) {
        return this._renderRemoveConfirm(u);
      }
      const removeBtn = editable && !this._isSelf(u.slug)
        ? `<button class="danger-btn" data-remove-user="${this._escape(u.slug)}">Retirer</button>`
        : "";
      return `<article class="tile">
        <div class="tile-head">
          <strong>${this._escape(u.label)}</strong>
          ${removeBtn}
        </div>
        <div class="rows">
          ${this._settingsToggle(`switch.notif_${u.slug}_email_enabled`, "Email", u.emailEnabled, editable)}
          ${this._settingsPushRow(u, mobileApps, editable)}
          ${rolesLabels.map(([name, key]) => this._settingsToggle(
            `switch.notif_${u.slug}_${key}`, name,
            this._boolState(`switch.notif_${u.slug}_${key}`), editable
          )).join("")}
        </div>
      </article>`;
    }).join("");

    // Personnes sans profil (section add)
    const audit = this._auditPersons(users);
    let unconfiguredHtml = "";
    if (editable) {
      if (audit.missing.length === 0) {
        unconfiguredHtml = `<p class="empty">✅ Toutes les personnes HA visibles ont un profil notifications.</p>`;
      } else {
        unconfiguredHtml = audit.missing.map((p) => {
          if (this._addExpanded === p.id) {
            return this._renderAddForm(p);
          }
          return `<div class="person-row">
            <span>👤 ${this._escape(p.name)}</span>
            <button class="add-btn" data-add-person="${this._escape(p.id)}" data-person-name="${this._escape(p.name)}">+ Ajouter</button>
          </div>`;
        }).join("");
      }
    }

    const domainHtml = domainIds.map((id) => {
      const friendly = this._hass.states[id]?.attributes?.friendly_name || id;
      return this._settingsToggle(id, friendly, this._boolState(id), editable);
    }).join("");

    return `
      ${banner}
      <section>
        <h3>Canal global</h3>
        <article class="tile wide"><div class="rows">${smtpHtml}</div></article>
      </section>
      ${users.length || editable
        ? `<section>
            <h3>Utilisateurs configurés</h3>
            ${users.length ? `<div class="grid">${userTiles}</div>` : `<p class="empty">Aucun utilisateur configuré.</p>`}
           </section>`
        : ""}
      ${editable
        ? `<section>
            <h3>Personnes sans profil</h3>
            <article class="tile wide"><div class="person-list">${unconfiguredHtml}</div></article>
           </section>`
        : ""}
      ${domainHtml
        ? `<section><h3>Notifications métier</h3><article class="tile wide"><div class="rows">${domainHtml}</div></article></section>`
        : ""}`;
  }

  _renderSetupGuide() {
    return `<div class="setup-guide">
      <div class="setup-icon">⚙️</div>
      <h3>Configuration requise</h3>
      <p>L'intégration <code>notifications_manager</code> n'est pas chargée
      ou aucun utilisateur n'est encore configuré.</p>
      <ol>
        <li>Installez <code>notifications_manager</code> (HACS ou manuel dans <code>custom_components/</code>)</li>
        <li>Ajoutez <code>notifications_manager: {}</code> à <code>configuration.yaml</code></li>
        <li>Créez <code>notifications_users.yaml</code> (voir <code>examples/</code> du dépôt HACS)</li>
        <li>Redémarrez Home Assistant</li>
      </ol>
      <p class="setup-hint">Documentation complète dans le README du dépôt HACS.</p>
    </div>`;
  }

  _renderAddForm(person) {
    const f = this._addForm;
    const defaultLabel = f.label !== undefined ? f.label : person.name;
    const defaultId = f.id !== undefined ? f.id : this._toSlug(person.name);
    const slugValid = /^[a-z0-9][a-z0-9_]{0,29}$/.test(defaultId);
    const rolesLabels = [
      ["Admin", "admin"], ["Propriétaire", "proprietaire"],
      ["Résident", "resident"], ["Utilisateur", "utilisateur"],
    ];
    const rolesHtml = rolesLabels.map(([name, key]) => {
      const checked = f.roles?.[key] ? "checked" : "";
      return `<label class="role-check">
        <input type="checkbox" data-role="${key}" ${checked}> ${this._escape(name)}
      </label>`;
    }).join("");

    const mobileApps = this._detectMobileApps();
    const pushOpts = mobileApps.length > 1
      ? `<select class="push-select add-push-select">
          <option value="">(saisie manuelle)</option>
          ${mobileApps.map((a) => `<option value="${this._escape(a)}" ${f.pushTarget === a ? "selected" : ""}>${this._escape(a)}</option>`).join("")}
         </select>`
      : `<input type="text" class="form-input" data-field="pushTarget" placeholder="notify.mobile_app_..." value="${this._escape(f.pushTarget || (mobileApps[0] || ""))}">`;

    return `<div class="form-card" data-form-person="${this._escape(person.id)}">
      <div class="form-title">👤 ${this._escape(person.name)}</div>
      <div class="form-rows">
        <label>Libellé
          <input type="text" class="form-input" data-field="label" value="${this._escape(defaultLabel)}">
        </label>
        <label>Slug (id) ${slugValid ? "" : `<span class="slug-error">invalide</span>`}
          <input type="text" class="form-input slug-input ${slugValid ? "" : "invalid"}" data-field="id" value="${this._escape(defaultId)}" placeholder="ex: jean_marc">
        </label>
        <label>Email
          <input type="text" class="form-input" data-field="email" placeholder="adresse@exemple.fr" value="${this._escape(f.email || "")}">
        </label>
        <label>Push cible
          ${pushOpts}
        </label>
        <div class="roles-row">${rolesHtml}</div>
      </div>
      <div class="form-actions">
        <button class="add-confirm-btn" data-confirm-add="${this._escape(person.id)}" ${slugValid ? "" : "disabled"}>Confirmer l'ajout</button>
        <button class="cancel-btn" data-cancel-add="${this._escape(person.id)}">Annuler</button>
      </div>
    </div>`;
  }

  _renderRemoveConfirm(user) {
    return `<article class="tile tile-danger">
      <div class="tile-head"><strong>${this._escape(user.label)}</strong></div>
      <p class="danger-msg">Supprimer ce profil ? Cette action retire toutes les entités de cet utilisateur.</p>
      <div class="form-actions">
        <button class="danger-confirm-btn" data-confirm-remove="${this._escape(user.slug)}">Confirmer la suppression</button>
        <button class="cancel-btn" data-cancel-remove="${this._escape(user.slug)}">Annuler</button>
      </div>
    </article>`;
  }

  // ── Composants settings ────────────────────────────────────────────────────

  _settingsToggle(entityId, label, value, editable) {
    const allowed = SETTINGS_ALLOWLIST.test(entityId);
    if (editable && allowed) {
      const checked = value === true ? "checked" : "";
      return `<div class="row toggle-row">
        <span>${this._escape(label)}</span>
        <label class="toggle" title="${this._escape(entityId)}">
          <input type="checkbox" data-entity="${this._escape(entityId)}" ${checked}>
          <span class="slider"></span>
        </label>
      </div>`;
    }
    const display =
      value === true ? "Actif" : value === false ? "Inactif" : "—";
    return this._row(label, display, "");
  }

  _settingsPushRow(user, mobileApps, editable) {
    // Toggle push enabled
    const toggleHtml = this._settingsToggle(
      `switch.notif_${user.slug}_push_enabled`,
      "Push",
      user.pushEnabled,
      editable
    );
    // Si mode edit et plusieurs mobile_app disponibles : select de cible
    if (editable && mobileApps.length > 1) {
      const current = user.pushTarget || "";
      const opts = [
        `<option value="" ${!current ? "selected" : ""}>(saisie manuelle)</option>`,
        ...mobileApps.map(
          (app) =>
            `<option value="${this._escape(app)}" ${
              current === app ? "selected" : ""
            }>${this._escape(app)}</option>`
        ),
      ].join("");
      const selectHtml = `<div class="row">
        <span>Cible push</span>
        <select class="push-select" data-push-entity="${this._escape(
          `text.notif_${user.slug}_push_target`
        )}">${opts}</select>
      </div>`;
      return toggleHtml + selectHtml;
    }
    // Un seul mobile_app : afficher comme hint
    if (editable && mobileApps.length === 1 && !user.pushTarget) {
      return (
        toggleHtml +
        `<div class="row hint-row">
          <span>Cible disponible</span>
          <small>${this._escape(mobileApps[0])}</small>
        </div>`
      );
    }
    return toggleHtml;
  }

  // ── Listeners interactifs (settings) ─────────────────────────────────────

  _attachSettingsListeners() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;

    // Toggles entites existantes
    root.querySelectorAll("input[data-entity]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const id = e.target.dataset.entity;
        if (SETTINGS_ALLOWLIST.test(id)) {
          const domain = id.startsWith("switch.") ? "switch" : "input_boolean";
          this._hass.callService(domain, "toggle", { entity_id: id });
        }
      });
    });

    // Select push cible utilisateur existant
    root.querySelectorAll("select.push-select[data-push-entity]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const id = e.target.dataset.pushEntity;
        const val = e.target.value;
        if (val && PUSH_TARGET_ALLOWLIST.test(id)) {
          this._hass.callService("text", "set_value", { entity_id: id, value: val });
        }
      });
    });

    // Bouton Retirer : afficher confirmation
    root.querySelectorAll("[data-remove-user]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._removeConfirm = e.currentTarget.dataset.removeUser;
        this._addExpanded = null;
        this._render();
      });
    });

    // Bouton Confirmer suppression
    root.querySelectorAll("[data-confirm-remove]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const slug = e.currentTarget.dataset.confirmRemove;
        this._hass.callService("notifications_manager", "remove_user", { id: slug });
        this._removeConfirm = null;
        this._render();
      });
    });

    // Bouton Annuler suppression
    root.querySelectorAll("[data-cancel-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._removeConfirm = null;
        this._render();
      });
    });

    // Bouton + Ajouter : ouvrir formulaire
    root.querySelectorAll("[data-add-person]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const personId = e.currentTarget.dataset.addPerson;
        const personName = e.currentTarget.dataset.personName || "";
        this._addExpanded = personId;
        this._addForm = {
          label: personName,
          id: this._toSlug(personName),
          email: "",
          pushTarget: this._detectMobileApps()[0] || "",
          roles: {},
        };
        this._removeConfirm = null;
        this._render();
      });
    });

    // Inputs du formulaire d'ajout : mettre a jour _addForm
    root.querySelectorAll(".form-card input[data-field]").forEach((input) => {
      input.addEventListener("input", (e) => {
        this._addForm[e.target.dataset.field] = e.target.value;
        // Re-render uniquement pour valider le slug (disable/enable bouton)
        if (e.target.dataset.field === "id") this._render();
      });
    });

    // Select push dans formulaire d'ajout
    root.querySelectorAll(".add-push-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        this._addForm.pushTarget = e.target.value;
      });
    });

    // Checkboxes roles dans formulaire d'ajout
    root.querySelectorAll(".form-card input[data-role]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        if (!this._addForm.roles) this._addForm.roles = {};
        this._addForm.roles[e.target.dataset.role] = e.target.checked;
      });
    });

    // Bouton Confirmer l'ajout
    root.querySelectorAll("[data-confirm-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = this._addForm;
        // Lire les valeurs actuelles depuis le DOM avant d'appeler le service
        const labelInput = root.querySelector(".form-card input[data-field='label']");
        const idInput = root.querySelector(".form-card input[data-field='id']");
        const emailInput = root.querySelector(".form-card input[data-field='email']");
        const pushInput = root.querySelector(".form-card input[data-field='pushTarget']");
        const label = (labelInput?.value || f.label || "").trim();
        const id = (idInput?.value || f.id || "").trim();
        const email = (emailInput?.value || f.email || "").trim();
        const pushTarget = (pushInput?.value || f.pushTarget || "").trim()
          || root.querySelector(".add-push-select")?.value || "";

        if (!id || !/^[a-z0-9][a-z0-9_]{0,29}$/.test(id)) return;

        const roles = {};
        root.querySelectorAll(".form-card input[data-role]").forEach((cb) => {
          roles[cb.dataset.role] = cb.checked;
        });

        this._hass.callService("notifications_manager", "add_user", {
          id, label,
          email, email_enabled: Boolean(email),
          push_target: pushTarget, push_enabled: Boolean(pushTarget),
          roles,
        });
        this._addExpanded = null;
        this._addForm = {};
        this._render();
      });
    });

    // Bouton Annuler ajout
    root.querySelectorAll("[data-cancel-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._addExpanded = null;
        this._addForm = {};
        this._render();
      });
    });
  }

  // ── Utilitaires HTML ───────────────────────────────────────────────────────

  _entityRow(entityId) {
    const s = this._hass.states[entityId];
    const name = s?.attributes?.friendly_name || entityId;
    return this._row(name, this._state(entityId), "");
  }

  _row(label, value, detail) {
    const det = this._isUseful(detail)
      ? `<small>${this._escape(detail)}</small>`
      : "";
    return `<div class="row">
      <span>${this._escape(label)}</span>
      <b>${this._escape(value)}</b>
      ${det}
    </div>`;
  }

  _badge(text, kind) {
    return `<span class="badge ${kind}">${this._escape(text)}</span>`;
  }

  // ── Utilitaires donnees ────────────────────────────────────────────────────

  _state(entityId) {
    const v = this._hass.states?.[entityId]?.state;
    return this._isUseful(v) ? String(v) : "";
  }

  _boolState(entityId) {
    const v = this._hass.states?.[entityId]?.state;
    if (v === "on") return true;
    if (v === "off") return false;
    return null;
  }

  _isUseful(v) {
    return (
      v !== undefined &&
      v !== null &&
      !["", "unknown", "unavailable", "none"].includes(
        String(v).trim().toLowerCase()
      )
    );
  }

  _normalize(v) {
    return String(v || "")
      .trim()
      .toLowerCase();
  }

  _escape(v) {
    return String(v ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
    );
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  _styles() {
    return `
      .card{padding:16px}
      .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
      .card-title{font-size:15px;font-weight:700;color:var(--primary-text-color)}
      .version{color:var(--secondary-text-color);font-size:11px;white-space:nowrap;flex-shrink:0}
      h3{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--secondary-text-color);margin:16px 0 8px}
      h4{font-size:12px;font-weight:600;margin:4px 0 6px}
      section:first-of-type h3{margin-top:0}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
      .tile{border:1px solid var(--divider-color);border-radius:12px;padding:12px;background:var(--card-background-color)}
      .wide{grid-column:1/-1}
      .tile-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
      .badge{border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap}
      .badge.ok{background:rgba(76,175,80,.15);color:var(--success-color,#43a047)}
      .badge.warn{background:rgba(255,152,0,.15);color:var(--warning-color,#fb8c00)}
      .rows{display:grid;gap:6px}
      .row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;font-size:13px}
      .row span{color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .row b{font-weight:600;text-align:right;white-space:nowrap}
      .row small{grid-column:1/-1;color:var(--secondary-text-color);font-size:11px;overflow:hidden;text-overflow:ellipsis}
      .audit{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
      .audit ul{margin:0;padding-left:16px;font-size:13px;line-height:1.6}
      .empty{color:var(--secondary-text-color);padding:8px 0;font-size:13px}
      .banner{border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:14px}
      .edit-banner{background:rgba(33,150,243,.1);color:var(--info-color,#1e88e5)}
      .read-banner{background:rgba(0,0,0,.04);color:var(--secondary-text-color)}
      .read-banner code{background:rgba(0,0,0,.08);padding:1px 5px;border-radius:4px;font-size:11px}
      .toggle-row{align-items:center}
      .hint-row{align-items:baseline;opacity:.7}
      .toggle{position:relative;display:inline-flex;width:38px;height:22px;flex-shrink:0;cursor:pointer}
      .toggle input{opacity:0;width:0;height:0;position:absolute}
      .slider{position:absolute;inset:0;background:var(--divider-color,#ccc);border-radius:22px;transition:.2s}
      .slider::before{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
      input:checked+.slider{background:var(--primary-color,#03a9f4)}
      input:checked+.slider::before{transform:translateX(16px)}
      select.push-select{border:1px solid var(--divider-color);border-radius:6px;padding:3px 6px;font-size:12px;background:var(--card-background-color);color:var(--primary-text-color);max-width:160px}
      .add-btn{background:var(--primary-color,#03a9f4);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
      .add-btn:hover{opacity:.85}
      .danger-btn{background:transparent;color:var(--error-color,#e53935);border:1px solid var(--error-color,#e53935);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer}
      .danger-btn:hover{background:rgba(229,57,53,.08)}
      .danger-confirm-btn{background:var(--error-color,#e53935);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
      .cancel-btn{background:transparent;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
      .add-confirm-btn{background:var(--primary-color,#03a9f4);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
      .add-confirm-btn:disabled{opacity:.4;cursor:default}
      .person-list{display:grid;gap:8px}
      .person-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;font-size:13px}
      .tile-danger{border-color:var(--error-color,#e53935);background:rgba(229,57,53,.04)}
      .danger-msg{font-size:12px;color:var(--secondary-text-color);margin:6px 0 10px}
      .form-card{border:1px solid var(--primary-color,#03a9f4);border-radius:12px;padding:12px;background:var(--card-background-color)}
      .form-title{font-weight:700;font-size:13px;margin-bottom:10px}
      .form-rows{display:grid;gap:8px;margin-bottom:12px}
      .form-rows label{font-size:12px;color:var(--secondary-text-color);display:grid;gap:3px}
      .form-input{border:1px solid var(--divider-color);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--card-background-color);color:var(--primary-text-color);width:100%;box-sizing:border-box}
      .form-input.invalid{border-color:var(--error-color,#e53935)}
      .slug-error{color:var(--error-color,#e53935);font-size:11px;margin-left:6px}
      .roles-row{display:flex;gap:10px;flex-wrap:wrap}
      .role-check{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:var(--primary-text-color)}
      .form-actions{display:flex;gap:8px;flex-wrap:wrap}
      .setup-guide{padding:16px;text-align:center}
      .setup-icon{font-size:32px;margin-bottom:8px}
      .setup-guide h3{font-size:14px;font-weight:700;margin:0 0 8px}
      .setup-guide p{font-size:13px;color:var(--secondary-text-color);margin:6px 0}
      .setup-guide ol{text-align:left;display:inline-block;font-size:13px;line-height:1.8;padding-left:20px}
      .setup-guide code{background:rgba(0,0,0,.08);padding:1px 5px;border-radius:4px;font-size:11px}
      .setup-hint{font-size:11px;font-style:italic}
      @media(max-width:520px){
        .card{padding:10px}
        .grid{grid-template-columns:1fr}
        .row{grid-template-columns:1fr auto}
        h3{font-size:10px}
        .card-title{font-size:14px}
      }
    `;
  }
}

if (!customElements.get(CARD_NAME)) {
  customElements.define(CARD_NAME, NotificationsSupervisionCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === CARD_NAME)) {
  window.customCards.push({
    type: CARD_NAME,
    name: "Notifications Supervision Card",
    description:
      "Carte dynamique modulaire pour les notifications et la supervision Home Assistant.",
    preview: true,
  });
}

console.info(
  `%c${CARD_NAME} v${VERSION} loaded`,
  "color:#03a9f4;font-weight:bold;background:#e3f2fd;padding:2px 6px;border-radius:4px"
);
// v0.3.0: notifications_manager integration — switch/text entities, role-based access
