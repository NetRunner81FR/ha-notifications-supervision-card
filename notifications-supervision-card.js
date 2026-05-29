const CARD_NAME = "notifications-supervision-card";
const VERSION = "0.2.1";

// Allowlist des entites modifiables depuis la vue settings/edit.
// Toute entite hors regex est refusee meme si callService est appele.
const SETTINGS_ALLOWLIST =
  /^input_boolean\.(notif_smtp_active|notif_[a-z0-9_]+_(email|push)_enabled|[a-z0-9_]+_notifications)$/;

// Allowlist push target : uniquement input_text de cible push utilisateur
const PUSH_TARGET_ALLOWLIST = /^input_text\.notif_[a-z0-9_]+_push_target$/;

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
      body = this._renderSettings();
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

    if (view === "settings" && this._config.mode === "edit") {
      this._attachSettingsListeners();
    }
  }

  // ── Decouverte ─────────────────────────────────────────────────────────────

  _discoverUsers() {
    return Object.keys(this._hass.states || {})
      .filter(
        (id) =>
          id.startsWith("input_text.notif_") && id.endsWith("_label")
      )
      .map((id) => {
        const slug = id.slice("input_text.notif_".length, -"_label".length);
        return {
          slug,
          label: this._state(id),
          email: this._state(`input_text.notif_${slug}_email`),
          emailEnabled: this._boolState(
            `input_boolean.notif_${slug}_email_enabled`
          ),
          pushTarget: this._state(`input_text.notif_${slug}_push_target`),
          pushEnabled: this._boolState(
            `input_boolean.notif_${slug}_push_enabled`
          ),
          tiers: [
            ["Admin", "tier_admin"],
            ["Propriétaire", "tier_proprietaire"],
            ["Résident", "tier_resident"],
            ["Utilisateur", "tier_utilisateur"],
          ]
            .filter(
              ([, k]) =>
                this._boolState(`input_boolean.notif_${slug}_${k}`) === true
            )
            .map(([name]) => name),
        };
      })
      .filter((u) => this._isUseful(u.label))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
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
        const ok = u.emailEnabled || u.pushEnabled || u.tiers.length > 0;
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
              u.tiers.length ? u.tiers.join(", ") : "Aucun",
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

  _renderSettings() {
    const editable = this._config.mode === "edit";
    const users = this._discoverUsers();
    const mobileApps = this._detectMobileApps();
    const domainIds = this._discoverDomainNotifications();

    const banner = editable
      ? `<div class="banner edit-banner">Mode édition — modifications appliquées immédiatement</div>`
      : `<div class="banner read-banner">Lecture seule — ajoutez <code>mode: edit</code> pour modifier</div>`;

    // Canal global SMTP
    const smtpHtml = this._settingsToggle(
      "input_boolean.notif_smtp_active",
      "Canal email global (SMTP)",
      this._boolState("input_boolean.notif_smtp_active"),
      editable
    );

    // Par utilisateur
    const userTiles = users
      .map(
        (u) => `<article class="tile">
        <div class="tile-head"><strong>${this._escape(u.label)}</strong></div>
        <div class="rows">
          ${this._settingsToggle(
            `input_boolean.notif_${u.slug}_email_enabled`,
            "Email",
            u.emailEnabled,
            editable
          )}
          ${this._settingsPushRow(u, mobileApps, editable)}
        </div>
      </article>`
      )
      .join("");

    // Notifications metier
    const domainHtml = domainIds
      .map((id) => {
        const friendly =
          this._hass.states[id]?.attributes?.friendly_name || id;
        return this._settingsToggle(
          id,
          friendly,
          this._boolState(id),
          editable
        );
      })
      .join("");

    return `
      ${banner}
      <section>
        <h3>Canal global</h3>
        <article class="tile wide"><div class="rows">${smtpHtml}</div></article>
      </section>
      ${
        users.length
          ? `<section><h3>Utilisateurs</h3><div class="grid">${userTiles}</div></section>`
          : ""
      }
      ${
        domainHtml
          ? `<section><h3>Notifications métier</h3><article class="tile wide"><div class="rows">${domainHtml}</div></article></section>`
          : ""
      }`;
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
      `input_boolean.notif_${user.slug}_push_enabled`,
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
          `input_text.notif_${user.slug}_push_target`
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

  // ── Listeners interactifs (settings edit) ─────────────────────────────────

  _attachSettingsListeners() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll("input[data-entity]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const id = e.target.dataset.entity;
        if (SETTINGS_ALLOWLIST.test(id)) {
          this._hass.callService("input_boolean", "toggle", {
            entity_id: id,
          });
        }
      });
    });
    this.shadowRoot
      .querySelectorAll("select.push-select[data-push-entity]")
      .forEach((sel) => {
        sel.addEventListener("change", (e) => {
          const id = e.target.dataset.pushEntity;
          const val = e.target.value;
          if (val && PUSH_TARGET_ALLOWLIST.test(id)) {
            this._hass.callService("input_text", "set_value", {
              entity_id: id,
              value: val,
            });
          }
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
// v0.2.1: fix temperature seuils absents des groupes supervision par defaut
