class NotificationsSupervisionCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: "custom:notifications-supervision-card",
      sections: ["users", "audit", "supervision"],
      ignored_persons: ["test_user", "tester_rec"]
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = {
      title: "Notifications / Supervision",
      sections: ["users", "audit", "supervision"],
      ignored_persons: [],
      ...config,
    };
    if (!Array.isArray(this._config.sections)) {
      this._config.sections = [String(this._config.sections || "users")];
    }
    if (!Array.isArray(this._config.ignored_persons)) {
      this._config.ignored_persons = [];
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 5;
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    const sections = new Set(this._config.sections || []);
    const users = this._discoverUsers();
    const audit = this._auditPersons(users);
    const supervision = this._discoverSupervision();

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="card">
          <div class="head">
            <div>
              <h2>${this._escape(this._config.title)}</h2>
              <p>${users.length} utilisateur(s) notification · ${supervision.length} bloc(s) supervision</p>
            </div>
            <span class="version">v0.1.1</span>
          </div>
          ${sections.has("users") ? this._renderUsers(users) : ""}
          ${sections.has("audit") ? this._renderAudit(audit) : ""}
          ${sections.has("supervision") ? this._renderSupervision(supervision) : ""}
        </div>
      </ha-card>
    `;
  }

  _discoverUsers() {
    const states = this._hass.states || {};
    return Object.keys(states)
      .filter((entityId) => entityId.startsWith("input_text.notif_") && entityId.endsWith("_label"))
      .map((entityId) => {
        const slug = entityId.replace("input_text.notif_", "").replace("_label", "");
        const label = this._state(entityId);
        return {
          slug,
          label,
          email: this._state(`input_text.notif_${slug}_email`),
          emailEnabled: this._boolState(`input_boolean.notif_${slug}_email_enabled`),
          pushTarget: this._state(`input_text.notif_${slug}_push_target`),
          pushEnabled: this._boolState(`input_boolean.notif_${slug}_push_enabled`),
          tiers: [
            ["Admin", `input_boolean.notif_${slug}_tier_admin`],
            ["Propriétaire", `input_boolean.notif_${slug}_tier_proprietaire`],
            ["Résident", `input_boolean.notif_${slug}_tier_resident`],
            ["Utilisateur", `input_boolean.notif_${slug}_tier_utilisateur`],
          ].filter(([, id]) => this._boolState(id) === true).map(([name]) => name),
        };
      })
      .filter((user) => this._isUseful(user.label))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }

  _auditPersons(users) {
    const configured = new Set(users.map((u) => this._normalize(u.label)));
    const ignored = new Set((this._config.ignored_persons || []).map((p) => this._normalize(p)));
    const persons = Object.entries(this._hass.states || {})
      .filter(([entityId]) => entityId.startsWith("person."))
      .map(([entityId, state]) => ({
        entityId,
        name: state.attributes?.friendly_name || state.attributes?.name || entityId.replace("person.", ""),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const missing = [];
    const ignoredPersons = [];
    for (const person of persons) {
      const keys = [this._normalize(person.name), this._normalize(person.entityId), this._normalize(person.entityId.replace("person.", ""))];
      if (keys.some((k) => ignored.has(k))) {
        ignoredPersons.push(person);
      } else if (!keys.some((k) => configured.has(k))) {
        missing.push(person);
      }
    }
    return { persons, missing, ignored: ignoredPersons };
  }

  _discoverSupervision() {
    const groups = this._config.supervision_groups || this._defaultSupervisionGroups();
    return groups.map((group) => {
      const entities = (group.entities || []).filter((entityId) => this._hass.states[entityId]);
      return { ...group, entities };
    }).filter((group) => group.entities.length > 0);
  }

  _defaultSupervisionGroups() {
    return [
      { title: "Inondation", icon: "mdi:water-alert", entities: ["input_boolean.inondation_notifications", "input_text.inondation_last_event"] },
      { title: "Portails", icon: "mdi:gate", entities: ["input_boolean.portail_notifications", "input_text.portail_last_event"] },
      { title: "MQTT", icon: "mdi:server-network", entities: ["input_boolean.mqtt_watchdog_notifications", "binary_sensor.mqtt_broker_hors_ligne", "input_text.mqtt_watchdog_last_event"] },
      { title: "Zigbee", icon: "mdi:zigbee", entities: ["input_boolean.zigbee_watchdog_notifications", "input_number.zigbee_watchdog_battery_seuil", "input_text.zigbee_watchdog_last_event"] },
      { title: "Températures", icon: "mdi:thermometer-alert", entities: ["input_boolean.temperature_anomalie_notifications", "binary_sensor.temperature_anomalie_detectee", "input_text.temperature_anomalie_last_event"] },
      { title: "RPi5", icon: "mdi:raspberry-pi", entities: ["input_boolean.rpi5_monitoring_notifications", "sensor.rpi5_health_status", "input_text.rpi5_monitoring_last_event"] },
      { title: "Veilleuse Axel", icon: "mdi:lightbulb-night", entities: ["counter.veilleuse_axel_nuit"] },
      { title: "Backup HA", icon: "mdi:backup-restore", entities: ["sensor.backup_last_successful_automatic_backup"] },
    ];
  }

  _renderUsers(users) {
    if (!users.length) return this._section("Utilisateurs", `<div class="empty">Aucun utilisateur notification détecté.</div>`);
    const html = users.map((user) => {
      const complete = user.emailEnabled || user.pushEnabled || user.tiers.length > 0;
      return `<article class="tile">
        <div class="tile-head"><strong>${this._escape(user.label)}</strong>${this._badge(complete ? "OK" : "Incomplet", complete ? "ok" : "warn")}</div>
        <div class="rows">
          ${this._row("Email", user.emailEnabled === true ? "Actif" : "Inactif", user.email)}
          ${this._row("Push", user.pushEnabled === true ? "Actif" : "Inactif", user.pushTarget)}
          ${this._row("Niveaux", user.tiers.length ? user.tiers.join(", ") : "Aucun", "")}
        </div>
      </article>`;
    }).join("");
    return this._section("Utilisateurs", `<div class="grid">${html}</div>`);
  }

  _renderAudit(audit) {
    const status = audit.missing.length === 0 ? this._badge("OK", "ok") : this._badge("À vérifier", "warn");
    const missing = audit.missing.length ? audit.missing.map((p) => `<li>${this._escape(p.name)}</li>`).join("") : `<li>Aucune personne HA visible sans notification.</li>`;
    const ignored = audit.ignored.length ? audit.ignored.map((p) => `<li>${this._escape(p.name)}</li>`).join("") : `<li>Aucune exclusion active.</li>`;
    return this._section("Audit", `<article class="tile wide"><div class="tile-head"><strong>Couverture personnes HA</strong>${status}</div><div class="audit"><div><h4>À traiter</h4><ul>${missing}</ul></div><div><h4>Ignorées</h4><ul>${ignored}</ul></div></div></article>`);
  }

  _renderSupervision(groups) {
    if (!groups.length) return this._section("Supervision", `<div class="empty">Aucun bloc supervision disponible.</div>`);
    const html = groups.map((group) => `<article class="tile"><div class="tile-head"><strong>${this._escape(group.title)}</strong>${this._badge("Visible", "ok")}</div><div class="rows">${group.entities.map((id) => this._entityRow(id)).join("")}</div></article>`).join("");
    return this._section("Supervision", `<div class="grid">${html}</div>`);
  }

  _section(title, content) { return `<section><h3>${this._escape(title)}</h3>${content}</section>`; }
  _entityRow(entityId) {
    const state = this._hass.states[entityId];
    const name = state?.attributes?.friendly_name || entityId;
    return this._row(name, this._state(entityId), "");
  }
  _row(label, value, detail) {
    const safeDetail = this._isUseful(detail) ? `<small>${this._escape(detail)}</small>` : "";
    return `<div class="row"><span>${this._escape(label)}</span><b>${this._escape(value)}</b>${safeDetail}</div>`;
  }
  _badge(text, kind) { return `<span class="badge ${kind}">${this._escape(text)}</span>`; }
  _state(entityId) {
    const value = this._hass.states?.[entityId]?.state;
    return this._isUseful(value) ? String(value) : "";
  }
  _boolState(entityId) {
    const value = this._hass.states?.[entityId]?.state;
    if (value === "on") return true;
    if (value === "off") return false;
    return null;
  }
  _isUseful(value) { return value !== undefined && value !== null && !["", "unknown", "unavailable", "none"].includes(String(value).trim().toLowerCase()); }
  _normalize(value) { return String(value || "").trim().toLowerCase(); }
  _escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }
  _styles() { return `
    .card{padding:16px}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}h2{font-size:20px;margin:0}p{color:var(--secondary-text-color);margin:4px 0 0}h3{font-size:16px;margin:18px 0 8px}.version{color:var(--secondary-text-color);font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.tile{border:1px solid var(--divider-color);border-radius:12px;padding:12px;background:var(--card-background-color)}.wide{grid-column:1/-1}.tile-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.badge{border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600}.badge.ok{background:rgba(76,175,80,.16);color:var(--success-color,#43a047)}.badge.warn{background:rgba(255,152,0,.16);color:var(--warning-color,#fb8c00)}.rows{display:grid;gap:6px}.row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:baseline}.row span{color:var(--secondary-text-color);min-width:0;overflow:hidden;text-overflow:ellipsis}.row b{font-weight:600;text-align:right}.row small{grid-column:1/-1;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis}.audit{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.audit h4{margin:6px 0}.audit ul{margin:0;padding-left:18px}.empty{color:var(--secondary-text-color);padding:8px 0}@media(max-width:520px){.card{padding:12px}.grid{grid-template-columns:1fr}.row{grid-template-columns:1fr}.row b{text-align:left}.head{align-items:flex-start}h2{font-size:18px}}
  `; }
}

if (!customElements.get("notifications-supervision-card")) {
  customElements.define("notifications-supervision-card", NotificationsSupervisionCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: "notifications-supervision-card",
  name: "Notifications Supervision Card",
  description: "Carte dynamique pour les notifications et la supervision Home Assistant."
});
console.info("notifications-supervision-card v0.1.1 loaded");
