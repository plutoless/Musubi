const state = {
  route: location.hash.replace("#", "") || "home",
  data: {},
  messageFilters: { app_id: "", device_id: "", status: "", channel: "" },
  auditFilters: { event_type: "", app_id: "", device_id: "" },
};

const title = document.querySelector("#page-title");
const copy = document.querySelector("#page-copy");
const root = document.querySelector("#app");
const refresh = document.querySelector("#refresh");

refresh.addEventListener("click", () => load());
window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "home";
  load();
});

load();

async function load() {
  markActive();
  root.innerHTML = `<div class="panel loading-state">Loading...</div>`;
  try {
    const [devices, apps, messages, audit, capabilities] = await Promise.all([
      api("/v1/devices"),
      api("/v1/apps"),
      api("/v1/messages"),
      api("/v1/audit-events"),
      api("/v1/device-plugin-capabilities"),
    ]);
    state.data = { devices, apps, messages, audit, capabilities };
    render();
  } catch (error) {
    root.innerHTML = `<div class="panel error-state">Control plane data failed to load: ${escapeHtml(error.message)}</div>`;
  }
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json;
}

function render() {
  const [name, id] = state.route.split("/");
  if (name === "devices" && id) return renderDevice(id);
  if (name === "apps" && id) return renderApp(id);
  if (name === "messages" && id) return renderMessage(id);
  if (name === "devices") return renderDevices();
  if (name === "apps") return renderApps();
  if (name === "messages") return renderMessages();
  if (name === "audit") return renderAudit();
  if (name === "settings") return renderSettings();
  return renderHome();
}

function renderHome() {
  setHeader("Home", "Apps can ask. Your machine decides.");
  const devices = state.data.devices.devices;
  const apps = state.data.apps.apps;
  const messages = state.data.messages.messages;
  const onlineDevices = devices.filter((device) => device.status === "online").length;
  const activeApps = apps.filter((app) => app.status === "active").length;
  root.innerHTML = `
    <section class="console-hero">
      <div>
        <p class="eyebrow">Local trust boundary</p>
        <h2>Cloud grants route requests. Local policy still decides execution.</h2>
        <p class="muted">Musubi routes encrypted messages but cannot read task contents. Cloud grants allow an app to ask; local policy on the device still decides whether the request can run.</p>
      </div>
      <div class="hero-status">
        ${statusPill("Devices online", `${onlineDevices}/${devices.length}`)}
        ${statusPill("Active apps", String(activeApps))}
        ${statusPill("Audit trail", `${state.data.audit.audit_events.length} events`)}
      </div>
    </section>
    <section class="metric-strip">
      ${metric("Connected devices", devices.length, "Registered local machines")}
      ${metric("Online now", onlineDevices, "Available for delivery")}
      ${metric("Apps with access", apps.filter((app) => app.authorized_device_count > 0).length, "Have active grants")}
      ${metric("Messages", messages.length, "Encrypted lifecycle records")}
    </section>
    <section class="dashboard-grid">
      ${panel("Setup command", `
        <p class="muted">Install the CLI, register a device, create an app, then grant explicit plugin channels.</p>
        <pre>go run ./cmd/musubi device register --server ${location.origin} --home .musubi/m2</pre>
        <div class="toolbar">
          <button class="primary" data-copy="go run ./cmd/musubi device register --server ${location.origin} --home .musubi/m2">Copy register command</button>
          <button onclick="location.hash='devices'">View devices</button>
          <button onclick="location.hash='apps'">View apps</button>
        </div>
      `, "span-5")}
      ${panel("Recent Messages", messageTable(messages.slice(0, 6)), "span-7")}
    </section>
  `;
  bindCopy();
}

function renderDevices() {
  setHeader("Devices", "Registered machines and their reported local capabilities.");
  const devices = state.data.devices.devices;
  root.innerHTML = `
    <section class="notice">Apps do not access the whole machine. They can only request channels that are granted and allowed by local policy.</section>
    <section class="metric-strip compact">
      ${metric("Registered", devices.length, "Total devices")}
      ${metric("Online", devices.filter((device) => device.status === "online").length, "Connected now")}
      ${metric("Plugins", sum(devices, "plugin_count"), "Reported capabilities")}
      ${metric("Grants", sum(devices, "authorized_app_count"), "Authorized app links")}
    </section>
    ${panel("Devices", deviceTable(devices), "table-panel")}
  `;
}

async function renderDevice(id) {
  setHeader("Device Detail", "Inspect capabilities, authorized apps, local policy context, messages, and audit.");
  const detail = await api(`/v1/devices/${id}`);
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("", `
          ${entityHeader(detail.device.name, "Registered device", badge(detail.device.status))}
          <div class="kv-grid">
            ${kvItem("Device ID", detail.device.id)}
            ${kvItem("Platform", detail.device.platform)}
            ${kvItem("CLI version", detail.device.cli_version)}
            ${kvItem("Workspace", detail.device.workspace_id)}
            ${kvItem("Registered at", fmt(detail.device.created_at))}
            ${kvItem("Last seen", fmt(detail.device.last_seen_at))}
            ${kvItem("Active key", detail.active_key?.id || "none")}
          </div>
          <p class="notice inline">This device keeps its private key locally. Musubi stores only its public key.</p>
        `)}
        ${panel("Capabilities", detail.capabilities.length ? detail.capabilities.map(capabilityCard).join("") : empty("No capabilities reported yet."))}
        ${panel("Authorized Apps", grantTable(detail.grants), "table-panel")}
        ${panel("Recent Messages", messageTable(detail.recent_messages), "table-panel")}
        ${panel("Audit", auditTable(detail.recent_audit_events), "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Local Policy", `
          <p class="muted">${escapeHtml(detail.local_policy.copy)}</p>
          <div class="rail-kv">
            ${kvItem("Default behavior", detail.local_policy.default_behavior)}
            ${kvItem("Policy report", detail.local_policy.status)}
          </div>
        `)}
        ${panel("Danger Zone", `
          <p class="muted">Revoke device blocks future connections and app requests. Historical messages and audit remain.</p>
          <button class="danger" data-revoke-device="${detail.device.id}">Revoke device</button>
        `, "danger-zone")}
      </aside>
    </section>
  `;
  bindActions();
}

function renderApps() {
  setHeader("Apps", "App identities that can request local plugin channels.");
  root.innerHTML = `
    <section class="detail-layout apps-layout">
      <div class="detail-main">
        ${panel("Apps", appTable(state.data.apps.apps), "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Create Grant", grantForm(), "permission-panel")}
      </aside>
    </section>
  `;
  bindActions();
}

async function renderApp(id) {
  setHeader("App Detail", "Inspect app identity, keys, authorized devices, messages, and safety actions.");
  const detail = await api(`/v1/apps/${id}`);
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("", `
          ${entityHeader(detail.app.name, "App identity", badge(detail.app.status))}
          <div class="kv-grid">
            ${kvItem("App ID", detail.app.id)}
            ${kvItem("Type", detail.app.type)}
            ${kvItem("Workspace", detail.app.workspace_id)}
            ${kvItem("Created at", fmt(detail.app.created_at))}
          </div>
        `)}
        ${panel("Keys", `
          <p class="notice inline">Musubi stores app public keys for encryption. Production app private keys should stay with the app runtime, not the Musubi server.</p>
          <div class="kv-grid">
            ${kvItem("Active key", detail.active_key?.id || "none")}
            ${kvItem("Key status", detail.active_key?.status || "none")}
            ${kvItem("Public key fingerprint", fingerprint(detail.active_key?.public_key))}
          </div>
        `)}
        ${panel("Authorized Devices", grantTable(detail.grants), "table-panel")}
        ${panel("Messages", messageTable(detail.recent_messages), "table-panel")}
        ${panel("Audit", auditTable(detail.recent_audit_events), "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Access Summary", `
          <div class="rail-kv">
            ${kvItem("Grants", String(detail.grants.length))}
            ${kvItem("Recent messages", String(detail.recent_messages.length))}
            ${kvItem("Recent audit events", String(detail.recent_audit_events.length))}
          </div>
        `)}
        ${panel("Danger Zone", `
          <p class="muted">Revoke app access blocks future messages and revokes active grants.</p>
          <button class="danger" data-revoke-app="${detail.app.id}">Revoke app</button>
        `, "danger-zone")}
      </aside>
    </section>
  `;
  bindActions();
}

function renderMessages() {
  setHeader("Messages", "Message lifecycle across apps and devices. Payload plaintext is not displayed.");
  const messages = filterRows(state.data.messages.messages, state.messageFilters);
  root.innerHTML = `
    <section class="notice">Payload encrypted end-to-end. Musubi server cannot display task contents.</section>
    ${panel("Messages", `
      ${messageFilters()}
      ${messageTable(messages)}
    `, "table-panel")}
  `;
  bindFilters();
}

async function renderMessage(id) {
  setHeader("Message Detail", "Timeline, routing metadata, crypto metadata, and safe error details.");
  const detail = await api(`/v1/messages/${id}`);
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("", `
          ${entityHeader(detail.message.id, "Message lifecycle", badge(detail.message.status))}
          <div class="kv-grid">
            ${kvItem("App", `${detail.message.app_name || "unknown"} (${detail.message.app_id})`)}
            ${kvItem("Device", `${detail.message.device_name || "unknown"} (${detail.message.device_id})`)}
            ${kvItem("Channel", detail.message.channel)}
            ${kvItem("Created at", fmt(detail.message.created_at))}
            ${kvItem("Duration", detail.message.duration_ms === null ? "unknown" : `${detail.message.duration_ms} ms`)}
          </div>
        `)}
        ${panel("Timeline", `<div class="timeline">${detail.status_events.map((event) => `
          <div class="timeline-row">
            <span>${fmt(event.created_at)}</span>
            ${badge(event.status)}
            <span>${escapeHtml(event.stage || "")}${event.error_message ? `: ${escapeHtml(event.error_message)}` : ""}</span>
          </div>
        `).join("")}</div>`)}
        ${panel("Audit", auditTable(detail.audit_events), "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Crypto", `
          <p class="notice inline">Payload encrypted end-to-end. Musubi server cannot display task contents.</p>
          <div class="rail-kv">
            ${kvItem("Version", detail.crypto.version)}
            ${kvItem("Algorithm", detail.crypto.alg)}
            ${kvItem("Sender key", detail.crypto.sender_key_id)}
            ${kvItem("Recipient key", detail.crypto.recipient_key_id)}
            ${kvItem("Payload size", `${detail.crypto.payload_size} bytes`)}
          </div>
        `)}
      </aside>
    </section>
  `;
}

function renderAudit() {
  setHeader("Audit", "Security-relevant events across the workspace.");
  const auditEvents = filterRows(state.data.audit.audit_events, state.auditFilters);
  root.innerHTML = `
    <section class="notice">Audit events exclude decrypted payloads.</section>
    ${panel("Audit Events", `
      ${auditFilters()}
      ${auditTable(auditEvents)}
    `, "table-panel")}
  `;
  bindFilters();
}

function renderSettings() {
  setHeader("Settings", "M2 keeps workspace ownership simple.");
  root.innerHTML = `
    ${panel("Workspace", `
      <div class="kv-grid">
        ${kvItem("Mode", "single workspace owner")}
        ${kvItem("Enterprise settings", "out of scope for M2")}
      </div>
      <p class="muted">M2 uses a single workspace owner model. Enterprise RBAC, SCIM, billing, and marketplace settings are intentionally out of scope.</p>
    `)}
  `;
}

function metric(label, value, meta = "") {
  return `
    <div class="metric">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    </div>
  `;
}

function statusPill(label, value) {
  return `<div class="status-pill"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function panel(heading, body, className = "") {
  return `
    <section class="panel ${className}">
      ${heading ? `<div class="panel-header"><h2>${escapeHtml(heading)}</h2></div>` : ""}
      ${body}
    </section>
  `;
}

function entityHeader(name, meta, stateMarkup) {
  return `
    <div class="entity-header">
      <div>
        <p class="eyebrow">${escapeHtml(meta)}</p>
        <h2>${escapeHtml(name)}</h2>
      </div>
      ${stateMarkup}
    </div>
  `;
}

function kvItem(label, value) {
  return `
    <div class="kv-item">
      <span>${escapeHtml(label)}</span>
      <strong>${value || ""}</strong>
    </div>
  `;
}

function deviceTable(devices) {
  if (!devices.length) return empty("No devices connected yet. Install the Musubi CLI to register your first local machine.");
  return table(["Device", "Status", "Platform", "CLI Version", "Plugins", "Authorized Apps", "Last Seen", "Actions"], devices.map((device) => [
    resourceCell(device.name, device.id),
    badge(device.status),
    escapeHtml(device.platform || ""),
    mono(device.cli_version || ""),
    mono(String(device.plugin_count)),
    mono(String(device.authorized_app_count)),
    timeCell(device.last_seen_at),
    `<button onclick="location.hash='devices/${device.id}'">View detail</button>`,
  ]));
}

function appTable(apps) {
  if (!apps.length) return empty("No apps created yet.");
  return table(["App", "Type", "Status", "Authorized Devices", "Allowed Channels", "Created At", "Actions"], apps.map((app) => [
    resourceCell(app.name, app.id),
    escapeHtml(app.type),
    badge(app.status),
    mono(String(app.authorized_device_count)),
    mono(String(app.allowed_channel_count)),
    timeCell(app.created_at),
    `<button onclick="location.hash='apps/${app.id}'">View detail</button>`,
  ]));
}

function grantTable(grants) {
  if (!grants.length) return empty("No grants yet.");
  return table(["App", "Device", "Channels", "Queueing", "Status", "Actions"], grants.map((grant) => [
    resourceCell(grant.app?.name || grant.app_id, grant.app_id),
    resourceCell(grant.device?.name || grant.device_id, grant.device_id),
    chips(grant.allowed_channels),
    grant.queueing_allowed ? "enabled" : "disabled",
    badge(grant.status),
    grant.status === "active"
      ? `<div class="toolbar table-actions"><button data-edit-grant="${grant.id}" data-edit-device="${grant.device_id}" data-edit-channels="${escapeHtml(grant.allowed_channels.join(","))}" data-edit-queueing="${grant.queueing_allowed ? "true" : "false"}">Edit</button><button class="danger" data-revoke-grant="${grant.id}">Revoke</button></div>`
      : "",
  ]));
}

function messageTable(messages) {
  if (!messages.length) return empty("No messages yet.");
  return table(["Time", "App", "Device", "Channel", "Status", "Duration", "Message ID"], messages.map((message) => [
    timeCell(message.created_at),
    resourceCell(message.app_name || message.app_id, message.app_id),
    resourceCell(message.device_name || message.device_id, message.device_id),
    mono(message.channel),
    badge(message.status),
    message.duration_ms === null ? "" : mono(`${message.duration_ms} ms`),
    `<button class="id-button" onclick="location.hash='messages/${message.id}'">${escapeHtml(message.id)}</button>`,
  ]));
}

function auditTable(events) {
  if (!events.length) return empty("No audit events yet.");
  return table(["Time", "Event", "Actor", "App", "Device", "Channel", "Message ID"], events.map((event) => [
    timeCell(event.created_at),
    mono(event.event_type),
    mono([event.actor_type, event.actor_id].filter(Boolean).join(":")),
    mono(event.app_id || ""),
    mono(event.device_id || ""),
    mono(event.channel || ""),
    event.message_id ? `<button class="id-button" onclick="location.hash='messages/${event.message_id}'">${escapeHtml(event.message_id)}</button>` : "",
  ]));
}

function messageFilters() {
  const messages = state.data.messages.messages;
  return `
    <div class="filter-bar" aria-label="Message filters">
      ${selectFilter("message-app-filter", "app_id", "App", unique(messages.map((message) => message.app_id)), state.messageFilters.app_id)}
      ${selectFilter("message-device-filter", "device_id", "Device", unique(messages.map((message) => message.device_id)), state.messageFilters.device_id)}
      ${selectFilter("message-status-filter", "status", "Status", unique(messages.map((message) => message.status)), state.messageFilters.status)}
      ${selectFilter("message-channel-filter", "channel", "Channel", unique(messages.map((message) => message.channel)), state.messageFilters.channel)}
    </div>
  `;
}

function auditFilters() {
  const events = state.data.audit.audit_events;
  return `
    <div class="filter-bar" aria-label="Audit filters">
      ${selectFilter("audit-event-filter", "event_type", "Event", unique(events.map((event) => event.event_type)), state.auditFilters.event_type)}
      ${selectFilter("audit-app-filter", "app_id", "App", unique(events.map((event) => event.app_id).filter(Boolean)), state.auditFilters.app_id)}
      ${selectFilter("audit-device-filter", "device_id", "Device", unique(events.map((event) => event.device_id).filter(Boolean)), state.auditFilters.device_id)}
    </div>
  `;
}

function selectFilter(id, field, label, values, selected) {
  return `
    <label>${label}
      <select id="${id}" data-filter-field="${field}">
        <option value="">All</option>
        ${values.map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
      </select>
    </label>
  `;
}

function bindFilters() {
  document.querySelectorAll("[data-filter-field]").forEach((select) => {
    select.addEventListener("change", () => {
      const target = select.id.startsWith("audit-") ? state.auditFilters : state.messageFilters;
      target[select.dataset.filterField] = select.value;
      render();
    });
  });
}

function filterRows(rows, filters) {
  return rows.filter((row) => Object.entries(filters).every(([key, value]) => !value || row[key] === value));
}

function unique(values) {
  return [...new Set(values)].sort();
}

function capabilityCard(capability) {
  return `
    <div class="band capability-card">
      <div class="capability-head">
        <h3>${escapeHtml(capability.plugin_name)}</h3>
        <span>${escapeHtml(capability.plugin_version)}</span>
      </div>
      <div class="permission-grid">
        <div><span class="muted">Channels</span><div class="chips">${chips(capability.channels)}</div></div>
        <div><span class="muted">Requested permissions</span><div class="chips">${chips(capability.permissions)}</div></div>
      </div>
      <p class="muted">Last reported: ${fmt(capability.reported_at)}</p>
    </div>
  `;
}

function grantForm() {
  const apps = state.data.apps.apps.filter((app) => app.status === "active");
  const devices = state.data.devices.devices.filter((device) => device.status !== "revoked");
  const capabilities = state.data.capabilities.capabilities;
  const canCreateGrant = apps.length && devices.length && capabilities.length;
  return `
    <div class="form-grid grant-form">
      <label>App<select id="grant-app">${apps.map((app) => `<option value="${app.id}">${escapeHtml(app.name)} (${app.type})</option>`).join("")}</select></label>
      <label>Device<select id="grant-device">${devices.map((device) => `<option value="${device.id}">${escapeHtml(device.name)} (${device.status})</option>`).join("")}</select></label>
      <label>Plugin<select id="grant-plugin">${[...new Set(capabilities.map((capability) => capability.plugin_name))].map((name) => `<option value="${name}">${escapeHtml(name)}</option>`).join("")}</select></label>
      <div class="channel-editor">
        <h3>Channels</h3>
        <div id="grant-channels" class="checkboxes"></div>
      </div>
      <label class="toggle-line"><input id="grant-queueing" type="checkbox" /> Queueing enabled</label>
      <p class="notice inline">If queueing is disabled, requests fail when the device is offline. This avoids old tasks running unexpectedly when a device reconnects.</p>
      <p class="muted" id="grant-review"></p>
      <button class="primary" id="create-grant" ${canCreateGrant ? "" : "disabled"}>Create grant</button>
    </div>
  `;
}

function bindActions() {
  document.querySelectorAll("[data-edit-grant]").forEach((button) => {
    button.addEventListener("click", () => renderGrantEditor(button));
  });
  document.querySelectorAll("[data-revoke-grant]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/v1/grants/${button.dataset.revokeGrant}/revoke`, { method: "POST" });
      load();
    });
  });
  document.querySelectorAll("[data-revoke-app]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/v1/apps/${button.dataset.revokeApp}/revoke`, { method: "POST" });
      load();
    });
  });
  document.querySelectorAll("[data-revoke-device]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/v1/devices/${button.dataset.revokeDevice}/revoke`, { method: "POST" });
      load();
    });
  });
  const create = document.querySelector("#create-grant");
  if (create) {
    const updateChannels = () => {
      const deviceId = document.querySelector("#grant-device").value;
      const plugin = document.querySelector("#grant-plugin").value;
      const capability = state.data.capabilities.capabilities.find((item) => item.device_id === deviceId && item.plugin_name === plugin);
      const channels = capability?.channels?.filter((channel) => !channel.endsWith(".event")) || [];
      document.querySelector("#grant-channels").innerHTML = channels.length
        ? channels.map((channel) => `
          <label><input type="checkbox" value="${channel}" checked /> ${escapeHtml(channel)}</label>
        `).join("")
        : `<p class="muted empty-state">No runnable channels reported for this device and plugin.</p>`;
      document.querySelector("#grant-review").textContent = plugin
        ? `${plugin} channels will be granted. The server will route encrypted messages but cannot read task contents. Local policy may still deny requests.`
        : "Register a device and report plugin capabilities before creating a grant.";
    };
    document.querySelector("#grant-device").addEventListener("change", updateChannels);
    document.querySelector("#grant-plugin").addEventListener("change", updateChannels);
    updateChannels();
    create.addEventListener("click", async () => {
      const allowed_channels = [...document.querySelectorAll("#grant-channels input:checked")].map((input) => input.value);
      await api("/v1/grants", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: "ws_local",
          app_id: document.querySelector("#grant-app").value,
          device_id: document.querySelector("#grant-device").value,
          allowed_channels,
          queueing_allowed: document.querySelector("#grant-queueing").checked,
        }),
      });
      location.hash = `devices/${document.querySelector("#grant-device").value}`;
      load();
    });
  }
}

function renderGrantEditor(button) {
  document.querySelector("#grant-editor")?.remove();
  const grantId = button.dataset.editGrant;
  const deviceId = button.dataset.editDevice;
  const selected = new Set((button.dataset.editChannels || "").split(",").filter(Boolean));
  const capabilities = state.data.capabilities.capabilities.filter((capability) => capability.device_id === deviceId);
  const channels = [...new Set(capabilities.flatMap((capability) => capability.channels).filter((channel) => !channel.endsWith(".event")))];
  const panel = document.createElement("section");
  panel.className = "panel permission-panel";
  panel.id = "grant-editor";
  panel.innerHTML = `
    <div class="panel-header"><h2>Edit Grant</h2></div>
    <div class="form-grid grant-form">
      <div class="channel-editor">
        <h3>Allowed channels</h3>
        <div class="checkboxes">
          ${channels.map((channel) => `<label><input type="checkbox" value="${channel}" ${selected.has(channel) ? "checked" : ""} /> ${escapeHtml(channel)}</label>`).join("")}
        </div>
      </div>
      <label class="toggle-line"><input id="edit-grant-queueing" type="checkbox" ${button.dataset.editQueueing === "true" ? "checked" : ""} /> Queueing enabled</label>
      <p class="notice inline">This grant allows an app to request specific plugin channels, not access the whole machine. Local policy may still deny this request even when cloud access is granted.</p>
      <div class="toolbar">
        <button class="primary" id="save-grant-edit">Save grant</button>
        <button id="cancel-grant-edit">Cancel</button>
      </div>
    </div>
  `;
  root.prepend(panel);
  panel.querySelector("#cancel-grant-edit").addEventListener("click", () => panel.remove());
  panel.querySelector("#save-grant-edit").addEventListener("click", async () => {
    const allowed_channels = [...panel.querySelectorAll("input[type=checkbox]:checked")]
      .filter((input) => input.id !== "edit-grant-queueing")
      .map((input) => input.value);
    await api(`/v1/grants/${grantId}`, {
      method: "PATCH",
      body: JSON.stringify({
        allowed_channels,
        queueing_allowed: panel.querySelector("#edit-grant-queueing").checked,
      }),
    });
    load();
  });
}

function bindCopy() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => navigator.clipboard.writeText(button.dataset.copy));
  });
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index])}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function resourceCell(name, id) {
  return `<div class="resource-cell"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(id || "")}</span></div>`;
}

function mono(value) {
  return `<span class="mono">${escapeHtml(value)}</span>`;
}

function timeCell(value) {
  return `<time>${fmt(value)}</time>`;
}

function badge(value) {
  return `<span class="badge ${escapeHtml(String(value || "").toLowerCase())}">${escapeHtml(String(value || "unknown"))}</span>`;
}

function chips(values) {
  return (values || []).map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("");
}

function empty(message) {
  return `<p class="muted empty-state">${escapeHtml(message)}</p>`;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function fmt(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString();
}

function fingerprint(value) {
  if (!value) return "none";
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function setHeader(nextTitle, nextCopy) {
  title.textContent = nextTitle;
  copy.textContent = nextCopy;
}

function markActive() {
  document.querySelectorAll("nav a").forEach((link) => {
    link.classList.toggle("active", state.route.startsWith(link.dataset.route));
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
