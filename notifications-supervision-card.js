const VERSION = "0.9.3";

// Allowlist entites modifiables (canaux + roles via notifications_manager, SMTP global).
const SETTINGS_ALLOWLIST =
  /^(switch\.notif_[a-z0-9_]+_(email_enabled|push_enabled|role_(admin|proprietaire|resident|utilisateur))|switch\.notifications_manager_smtp_active|input_boolean\.[a-z0-9_]+_notifications)$/;

// Allowlist push target : text.notif_*_push_target
const PUSH_TARGET_ALLOWLIST = /^text\.notif_[a-z0-9_]+_push_target$/;

// Allowlist email : text.notif_*_email
const EMAIL_ALLOWLIST = /^text\.notif_[a-z0-9_]+_email$/;

// ── Classe de base ─────────────────────────────────────────────────────────────

class NotificationsBaseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._addExpanded = null;
    this._addForm = {};
    this._removeConfirm = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._isUserEditing()) {
      this._render();
    }
  }

  _isUserEditing() {
    const active = this.shadowRoot?.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    const type = (active.type || "").toLowerCase();
    return (tag === "INPUT" && type !== "checkbox" && type !== "radio") || tag === "TEXTAREA";
  }

  _saveScrollPosition() {
    // Cherche le premier élément scrollé dans notre propre shadow root uniquement.
    if (this.shadowRoot) {
      for (const el of this.shadowRoot.querySelectorAll("*")) {
        try { if (el.scrollTop > 0) return { el, top: el.scrollTop }; } catch (_) {}
      }
    }
    return null;
  }

  _restoreScrollPosition(saved) {
    if (!saved) return;
    requestAnimationFrame(() => {
      if (saved.el?.isConnected) {
        saved.el.scrollTop = saved.top;
      }
    });
  }

  // ── Decouverte ───────────────────────────────────────────────────────────────

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

  _resolveSettingsAccess() {
    if (!this._hass) return "none";
    if (this._hass.user?.is_admin) return "write";
    const haName = (this._hass.user?.name || "").toLowerCase();
    if (!haName) return "none";
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
    const configured = new Set([
      ...users.map((u) => this._normalize(u.label)),
      ...users.map((u) => this._normalize(u.slug)),
    ]);
    const ignored = new Set(
      (this._config.ignored_persons || []).map((p) => this._normalize(p))
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

  _hasNotifEntities() {
    return Object.keys(this._hass.states || {}).some(
      (id) => id.startsWith("text.notif_") || id.startsWith("switch.notif_")
    );
  }

  _toSlug(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
  }

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

  // ── Rendus sections ──────────────────────────────────────────────────────────

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
            ${this._row("Email", u.emailEnabled === true ? "Actif" : "Inactif", u.email)}
            ${this._row("Push", u.pushEnabled === true ? "Actif" : "Inactif", u.pushTarget)}
            ${this._row("Niveaux", u.roles.length ? u.roles.join(", ") : "Aucun", "")}
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
      "switch.notifications_manager_smtp_active",
      "Canal email global (SMTP)",
      this._boolState("switch.notifications_manager_smtp_active"),
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
          ${editable
            ? `<div class="row"><input type="email" class="form-input" data-email-entity="text.notif_${this._escape(u.slug)}_email" placeholder="adresse@exemple.fr" value="${this._escape(u.email || "")}"></div>`
            : (u.email ? `<div class="row"><span class="email-display">${this._escape(u.email)}</span></div>` : "")}
          ${this._settingsPushRow(u, mobileApps, editable)}
          ${rolesLabels.map(([name, key]) => this._settingsToggle(
            `switch.notif_${u.slug}_${key}`, name,
            this._boolState(`switch.notif_${u.slug}_${key}`), editable
          )).join("")}
        </div>
      </article>`;
    }).join("");

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
    const slug = this._toSlug(person.name);
    // Verifier via _isUseful/_state pour ignorer les entites stales (unavailable/unknown)
    const slugConflict = this._isUseful(this._state(`text.notif_${slug}_label`));
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

    return `<div class="form-card" data-form-person="${this._escape(person.id)}" data-form-slug="${this._escape(slug)}">
      <div class="form-title">👤 ${this._escape(person.name)} <span class="form-slug-hint">${this._escape(slug)}</span></div>
      ${slugConflict ? `<div class="banner slug-conflict-banner">Un profil avec l'identifiant <code>${this._escape(slug)}</code> existe déjà.</div>` : ""}
      <div class="form-rows">
        <label>Email
          <input type="text" class="form-input" data-field="email" placeholder="adresse@exemple.fr" value="${this._escape(f.email || "")}" ${slugConflict ? "disabled" : ""}>
        </label>
        <label>Push cible
          ${pushOpts}
        </label>
        <div class="roles-row">${rolesHtml}</div>
      </div>
      <div class="form-actions">
        <button class="add-confirm-btn" data-confirm-add="${this._escape(person.id)}" ${slugConflict ? "disabled" : ""}>Confirmer l'ajout</button>
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

  // ── Composants settings ──────────────────────────────────────────────────────

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
    const display = value === true ? "Actif" : value === false ? "Inactif" : "—";
    return this._row(label, display, "");
  }

  _settingsPushRow(user, mobileApps, editable) {
    const toggleHtml = this._settingsToggle(
      `switch.notif_${user.slug}_push_enabled`,
      "Push",
      user.pushEnabled,
      editable
    );
    if (editable && mobileApps.length > 1) {
      const current = user.pushTarget || "";
      const opts = [
        `<option value="" ${!current ? "selected" : ""}>(saisie manuelle)</option>`,
        ...mobileApps.map(
          (app) =>
            `<option value="${this._escape(app)}" ${current === app ? "selected" : ""}>${this._escape(app)}</option>`
        ),
      ].join("");
      return toggleHtml + `<div class="row">
        <span>Cible push</span>
        <select class="push-select" data-push-entity="${this._escape(`text.notif_${user.slug}_push_target`)}">${opts}</select>
      </div>`;
    }
    if (editable && mobileApps.length === 1 && !user.pushTarget) {
      return toggleHtml + `<div class="row hint-row">
        <span>Cible disponible</span>
        <small>${this._escape(mobileApps[0])}</small>
      </div>`;
    }
    return toggleHtml;
  }

  // ── Listeners interactifs ────────────────────────────────────────────────────

  _attachSettingsListeners() {
    if (!this.shadowRoot) return;
    const root = this.shadowRoot;

    root.querySelectorAll("input[data-entity]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const id = e.target.dataset.entity;
        if (SETTINGS_ALLOWLIST.test(id)) {
          const domain = id.startsWith("switch.") ? "switch" : "input_boolean";
          this._hass.callService(domain, "toggle", { entity_id: id });
        }
      });
    });

    root.querySelectorAll("input[data-email-entity]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const id = e.target.dataset.emailEntity;
        const val = e.target.value.trim();
        if (EMAIL_ALLOWLIST.test(id)) {
          this._hass.callService("text", "set_value", { entity_id: id, value: val });
        }
      });
    });

    root.querySelectorAll("select.push-select[data-push-entity]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const id = e.target.dataset.pushEntity;
        const val = e.target.value;
        if (val && PUSH_TARGET_ALLOWLIST.test(id)) {
          this._hass.callService("text", "set_value", { entity_id: id, value: val });
        }
      });
    });

    root.querySelectorAll("[data-remove-user]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._removeConfirm = e.currentTarget.dataset.removeUser;
        this._addExpanded = null;
        this._render();
      });
    });

    root.querySelectorAll("[data-confirm-remove]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const slug = e.currentTarget.dataset.confirmRemove;
        this._hass.callService("notifications_manager", "remove_user", { id: slug });
        this._removeConfirm = null;
        this._render();
      });
    });

    root.querySelectorAll("[data-cancel-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._removeConfirm = null;
        this._render();
      });
    });

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

    root.querySelectorAll(".form-card input[data-field]").forEach((input) => {
      input.addEventListener("input", (e) => {
        this._addForm[e.target.dataset.field] = e.target.value;
      });
    });

    root.querySelectorAll(".add-push-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        this._addForm.pushTarget = e.target.value;
      });
    });

    root.querySelectorAll(".form-card input[data-role]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        if (!this._addForm.roles) this._addForm.roles = {};
        this._addForm.roles[e.target.dataset.role] = e.target.checked;
      });
    });

    root.querySelectorAll("[data-confirm-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = this._addForm;
        const formCard = root.querySelector(".form-card");
        const label = (f.label || "").trim();
        const id = (formCard?.dataset.formSlug || f.id || "").trim();
        const emailInput = root.querySelector(".form-card input[data-field='email']");
        const pushInput = root.querySelector(".form-card input[data-field='pushTarget']");
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

    root.querySelectorAll("[data-cancel-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._addExpanded = null;
        this._addForm = {};
        this._render();
      });
    });
  }

  // ── Utilitaires HTML ─────────────────────────────────────────────────────────

  _wrapCard(title, body) {
    return `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card">
          <div class="head">
            <span class="card-title">${this._escape(title)}</span>
            <span class="version">v${VERSION}</span>
          </div>
          ${body}
        </div>
      </ha-card>`;
  }

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

  // ── Utilitaires donnees ──────────────────────────────────────────────────────

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
    return String(v || "").trim().toLowerCase();
  }

  _escape(v) {
    return String(v ?? "").replace(
      /[&<>'"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
    );
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

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
      .form-title{font-weight:700;font-size:13px;margin-bottom:10px;display:flex;align-items:baseline;gap:8px}
      .form-slug-hint{font-size:11px;font-weight:400;color:var(--secondary-text-color);font-family:monospace}
      .form-rows{display:grid;gap:8px;margin-bottom:12px}
      .form-rows label{font-size:12px;color:var(--secondary-text-color);display:grid;gap:3px}
      .form-input{border:1px solid var(--divider-color);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--card-background-color);color:var(--primary-text-color);width:100%;box-sizing:border-box}
      .email-display{font-size:11px;color:var(--secondary-text-color)}
      .form-input.invalid{border-color:var(--error-color,#e53935)}
      .slug-error{color:var(--error-color,#e53935);font-size:11px;margin-left:6px}
      .slug-conflict-banner{background:rgba(229,57,53,.08);color:var(--error-color,#e53935);border-radius:6px;padding:6px 10px;font-size:12px;margin-bottom:10px}
      .slug-conflict-banner code{background:rgba(229,57,53,.12);padding:1px 4px;border-radius:3px;font-size:11px}
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

// ── Carte : Utilisateurs (lecture seule) ──────────────────────────────────────

class NotificationsUsersCard extends NotificationsBaseCard {
  static getStubConfig() {
    return {
      type: "custom:notifications-users-card",
      ignored_persons: [],
    };
  }

  setConfig(config) {
    this._config = {
      title: config.title || null,
      ignored_persons: Array.isArray(config.ignored_persons) ? config.ignored_persons : [],
    };
    this._render();
  }

  getCardSize() { return 4; }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const scroll = this._saveScrollPosition();
    const title = this._config.title || "Utilisateurs notifications";
    this.shadowRoot.innerHTML = this._wrapCard(title, this._renderUsers(this._discoverUsers()));
    this._restoreScrollPosition(scroll);
  }
}

// ── Carte : Paramètres / Gestion (édition CRUD) ───────────────────────────────

class NotificationsSettingsCard extends NotificationsBaseCard {
  static getStubConfig() {
    return {
      type: "custom:notifications-settings-card",
      ignored_persons: [],
    };
  }

  setConfig(config) {
    this._config = {
      title: config.title || null,
      ignored_persons: Array.isArray(config.ignored_persons) ? config.ignored_persons : [],
      mode: "edit",
    };
    this._render();
  }

  getCardSize() { return 6; }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const scroll = this._saveScrollPosition();
    const title = this._config.title || "Paramètres notifications";
    const body = this._hasNotifEntities()
      ? this._renderSettings(this._discoverUsers())
      : this._renderSetupGuide();
    this.shadowRoot.innerHTML = this._wrapCard(title, body);
    this._attachSettingsListeners();
    this._restoreScrollPosition(scroll);
  }
}

// ── Carte : Audit couverture HA ───────────────────────────────────────────────

class NotificationsAuditCard extends NotificationsBaseCard {
  static getStubConfig() {
    return {
      type: "custom:notifications-audit-card",
      ignored_persons: [],
    };
  }

  setConfig(config) {
    this._config = {
      title: config.title || null,
      ignored_persons: Array.isArray(config.ignored_persons) ? config.ignored_persons : [],
    };
    this._render();
  }

  getCardSize() { return 3; }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const scroll = this._saveScrollPosition();
    const title = this._config.title || "Audit couverture HA";
    const users = this._discoverUsers();
    this.shadowRoot.innerHTML = this._wrapCard(title, this._renderAudit(this._auditPersons(users)));
    this._restoreScrollPosition(scroll);
  }
}

// ── Carte : Supervision (+ rétrocompat view: xxx) ────────────────────────────

class NotificationsSupervisionCard extends NotificationsBaseCard {
  static getStubConfig() {
    return {
      type: "custom:notifications-supervision-card",
    };
  }

  setConfig(config) {
    const hasSections =
      Array.isArray(config.sections) || typeof config.sections === "string";
    const hasView = typeof config.view === "string" && config.view.length > 0;

    this._config = {
      view: hasView ? config.view : hasSections ? "legacy" : "supervision",
      sections: hasSections
        ? Array.isArray(config.sections) ? config.sections : [String(config.sections)]
        : ["users", "audit", "supervision"],
      group: config.group || null,
      mode: config.mode === "edit" ? "edit" : "read",
      title: config.title || null,
      ignored_persons: Array.isArray(config.ignored_persons) ? config.ignored_persons : [],
      supervision_groups: config.supervision_groups || null,
    };
    this._render();
  }

  getCardSize() {
    const sizes = { users: 4, audit: 3, supervision: 5, settings: 5, legacy: 10 };
    return sizes[this._config.view] ?? 5;
  }

  _autoTitle() {
    if (this._config.title) return this._config.title;
    const map = {
      users: "Utilisateurs notifications",
      audit: "Audit couverture HA",
      supervision: this._config.group ? `Supervision – ${this._config.group}` : "Supervision",
      settings: "Paramètres notifications",
      legacy: "Notifications / Supervision",
    };
    return map[this._config.view] ?? "Supervision";
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const view = this._config.view;
    const scroll = this._saveScrollPosition();
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
    } else if (view === "settings") {
      body = this._hasNotifEntities()
        ? this._renderSettings(this._discoverUsers())
        : this._renderSetupGuide();
    } else {
      body = this._renderSupervision(this._discoverSupervision());
    }

    this.shadowRoot.innerHTML = this._wrapCard(this._autoTitle(), body);
    if (view === "settings") this._attachSettingsListeners();
    this._restoreScrollPosition(scroll);
  }
}

// ── Enregistrement ────────────────────────────────────────────────────────────

const CARDS = [
  {
    cls: NotificationsUsersCard,
    type: "notifications-users-card",
    name: "Notifications – Utilisateurs",
    description: "Vue synthétique des profils utilisateurs notifications.",
  },
  {
    cls: NotificationsSettingsCard,
    type: "notifications-settings-card",
    name: "Notifications – Paramètres",
    description: "Gestion CRUD des utilisateurs et paramètres notifications.",
  },
  {
    cls: NotificationsAuditCard,
    type: "notifications-audit-card",
    name: "Notifications – Audit",
    description: "Audit de couverture des personnes HA sans profil notifications.",
  },
  {
    cls: NotificationsSupervisionCard,
    type: "notifications-supervision-card",
    name: "Notifications – Supervision",
    description: "Supervision des groupes de notifications et entités métier.",
  },
];

window.customCards = window.customCards || [];

for (const { cls, type, name, description } of CARDS) {
  if (!customElements.get(type)) {
    customElements.define(type, cls);
  }
  if (!window.customCards.find((c) => c.type === type)) {
    window.customCards.push({ type, name, description, preview: true });
  }
}

console.info(
  `%cnotifications-cards v${VERSION} loaded (4 cards)`,
  "color:#03a9f4;font-weight:bold;background:#e3f2fd;padding:2px 6px;border-radius:4px"
);
