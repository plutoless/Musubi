const state = {
  route: location.hash.replace("#", "") || "home",
  data: emptyData(),
  createdApiKey: null,
  pagination: {},
  messageFilters: { app_id: "", device_id: "", status: "", channel: "" },
  auditFilters: { event_type: "", app_id: "", device_id: "" },
};

const title = document.querySelector("#page-title");
const copy = document.querySelector("#page-copy");
const root = document.querySelector("#app");
const refresh = document.querySelector("#refresh");
const PAGINATED_ROUTE_KEYS = [
  "devices",
  "apps",
  "apps.devices",
  "apps.capabilities",
  "developerApps",
  "authorizedApps",
  "plugins",
  "messages",
  "audit",
  "home.messages",
  "home.audit",
];

refresh.addEventListener("click", () => load());
window.addEventListener("hashchange", () => {
  const nextRoute = location.hash.replace("#", "") || "home";
  if (state.route !== nextRoute) resetAllPagination();
  state.route = nextRoute;
  load();
});

load();

async function load() {
  markActive();
  root.innerHTML = `<div class="panel loading-state">Loading...</div>`;
  try {
    state.data = { ...emptyData(), ...(await loadRouteData()) };
    await render();
    bindPaginationControls();
  } catch (error) {
    root.innerHTML = `<div class="panel error-state">Control plane data failed to load: ${escapeHtml(error.message)}</div>`;
  }
}

async function loadRouteData() {
  const [name, id] = state.route.split("/");
  if (state.route === "apps/new" || name === "settings") return {};
  if (state.route === "apps/authorized") return { authorizedApps: await pagedApi("/v1/authorized-apps", "authorizedApps") };
  if (name === "consent" && id) return { consentDetail: await api(`/v1/consent-requests/${id}`) };
  if (name === "plugins" && id) return { pluginDetail: await api(`/v1/plugins/${id}`) };
  if (name === "devices" && id) return { deviceDetail: await api(`/v1/devices/${id}`) };
  if (name === "apps" && id) return { appDetail: await api(`/v1/apps/${id}`) };
  if (name === "messages" && id) return { messageDetail: await api(`/v1/messages/${id}`) };
  if (name === "devices") return { devices: await pagedApi("/v1/devices", "devices") };
  if (name === "apps") {
    const [apps, devices, capabilities] = await Promise.all([
      pagedApi("/v1/apps", "apps"),
      pagedApi("/v1/devices", "apps.devices"),
      pagedApi("/v1/device-plugin-capabilities", "apps.capabilities"),
    ]);
    return { apps, devices, capabilities };
  }
  if (name === "developer") return { apps: await pagedApi("/v1/apps", "developerApps") };
  if (name === "plugins") {
    const [plugins, pluginPolicy] = await Promise.all([
      pagedApi("/v1/plugins", "plugins"),
      api("/v1/workspace/plugin-policy"),
    ]);
    return { plugins, pluginPolicy };
  }
  if (name === "messages") return { messages: await pagedApi("/v1/messages", "messages", activeFilterParams(state.messageFilters)) };
  if (name === "audit") return { audit: await pagedApi("/v1/audit-events", "audit", activeFilterParams(state.auditFilters)) };

  const [devices, apps, messages, audit] = await Promise.all([
    api("/v1/devices"),
    api("/v1/apps"),
    pagedApi("/v1/messages", "home.messages"),
    pagedApi("/v1/audit-events", "home.audit"),
  ]);
  return { devices, apps, messages, audit };
}

function pagedApi(path, key, extraParams = {}) {
  const page = paginationFor(key);
  const params = new URLSearchParams({ limit: String(page.limit) });
  if (page.cursor) params.set("cursor", page.cursor);
  for (const [name, value] of Object.entries(extraParams)) {
    if (value) params.set(name, value);
  }
  return api(`${path}?${params.toString()}`);
}

function paginationFor(key) {
  state.pagination[key] ??= { limit: 100, cursor: null, history: [] };
  return state.pagination[key];
}

function resetAllPagination() {
  for (const key of PAGINATED_ROUTE_KEYS) {
    resetPagination(key);
  }
}

function resetPagination(key) {
  const page = paginationFor(key);
  page.cursor = null;
  page.history = [];
}

function activeFilterParams(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

function emptyData() {
  return {
    devices: { devices: [] },
    apps: { apps: [] },
    messages: { messages: [] },
    audit: { audit_events: [] },
    capabilities: { capabilities: [] },
    authorizedApps: { authorized_apps: [], apps: [] },
    plugins: { plugins: [] },
    pluginPolicy: { policy: defaultPluginPolicy() },
    consentDetail: null,
    pluginDetail: null,
    deviceDetail: null,
    appDetail: null,
    messageDetail: null,
  };
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

async function render() {
  const [name, id] = state.route.split("/");
  if (state.route === "apps/new") return renderNewApp();
  if (state.route === "apps/authorized") return renderAuthorizedApps();
  if (name === "consent" && id) return renderConsent(id);
  if (name === "plugins" && id) return renderPlugin(id);
  if (name === "devices" && id) return renderDevice(id);
  if (name === "apps" && id) return renderApp(id);
  if (name === "messages" && id) return renderMessage(id);
  if (name === "devices") return renderDevices();
  if (name === "apps") return renderApps();
  if (name === "developer") return renderDeveloper();
  if (name === "plugins") return renderPlugins();
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
    ${panel("Devices", `${deviceTable(devices)}${paginationControls("devices", state.data.devices)}`, "table-panel")}
  `;
}

function renderDevice(id) {
  setHeader("Device Detail", "Inspect capabilities, authorized apps, local policy context, messages, and audit.");
  const detail = state.data.deviceDetail;
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
        ${panel("Apps", `
          <div class="panel-tools"><button class="primary" onclick="location.hash='apps/new'">New user-owned app</button></div>
          ${appTable(state.data.apps.apps)}
          ${paginationControls("apps", state.data.apps)}
        `, "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Create Grant", grantForm(), "permission-panel")}
      </aside>
    </section>
  `;
  bindActions();
}

function renderNewApp() {
  setHeader("New App", "Create a user-owned app identity from the CLI, then grant it explicit channels.");
  const server = location.origin;
  const command = `go run ./cmd/musubi app create "My Automation" --server ${server} --home .musubi/m3 --workspace ws_local --type user_owned --generate-key-local --env`;
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("Create User-owned App", `
          <p class="notice inline">The CLI generates the app private key locally. Musubi stores the app public key and an API key hash only.</p>
          <pre>${escapeHtml(command)}</pre>
          <div class="toolbar">
            <button class="primary" data-copy="${escapeHtml(command)}">Copy command</button>
            <button onclick="location.hash='apps'">Back to apps</button>
          </div>
        `)}
        ${panel("Next Step", `
          <p class="muted">After the app appears in this list, create a grant for only the device and plugin channels it should be allowed to request.</p>
        `)}
      </div>
      <aside class="detail-rail">
        ${panel("SDK Environment", `
          <div class="rail-kv">
            ${kvItem("MUSUBI_API_BASE_URL", server)}
            ${kvItem("MUSUBI_APP_ID", "printed by CLI")}
            ${kvItem("MUSUBI_API_KEY", "printed once")}
            ${kvItem("MUSUBI_APP_PRIVATE_KEY", "stored locally")}
          </div>
        `)}
      </aside>
    </section>
  `;
  bindCopy();
}

function renderDeveloper() {
  setHeader("Developer", "Register third-party apps and declare the plugin channels they request.");
  const server = location.origin;
  const snippet = `# Create a developer profile and publisher
curl -X POST ${server}/v1/developers -H 'Content-Type: application/json' \\
  --data '{"name":"Local Developer","email":"dev@example.test"}'

curl -X POST ${server}/v1/publishers -H 'Content-Type: application/json' \\
  --data '{"developer_id":"devacct_001","display_name":"Example Tools","website":"https://example.test"}'

# Register a third-party app, then declare plugin channels
curl -X POST ${server}/v1/developer/apps -H 'Content-Type: application/json' \\
  --data '{"workspace_id":"ws_local","name":"Example Third-party App","type":"third_party","publisher_id":"pub_001","public_key":"BASE64_X25519_PUBLIC_KEY"}'

curl -X POST ${server}/v1/developer/apps/app_001/permission-declarations -H 'Content-Type: application/json' \\
  --data '{"plugin_name":"codex","channels":["codex.task.create"],"reason":"Create approved local coding tasks"}'`;
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("Third-party App Registration", `
          <p class="notice inline">Third-party apps must identify their publisher and declare requested plugin channels before a user can consent.</p>
          <pre>${escapeHtml(snippet)}</pre>
          <button data-copy="${escapeHtml(snippet)}">Copy developer flow</button>
        `)}
        ${panel("Registered Apps", `${appTable(state.data.apps.apps)}${paginationControls("developerApps", state.data.apps)}`, "table-panel")}
      </div>
      <aside class="detail-rail">
        ${panel("Consent Request", `
          <p class="muted">After an app declares channels, create a consent request and send the user to <span class="mono">#consent/{id}</span>.</p>
          <div class="rail-kv">
            ${kvItem("Encryption", "Payload encrypted end-to-end")}
            ${kvItem("Local policy", "Device remains final authority")}
            ${kvItem("Revoke", "User can revoke grants any time")}
          </div>
        `)}
      </aside>
    </section>
  `;
  bindCopy();
}

function renderConsent(id) {
  setHeader("Consent", "Review app identity, publisher, requested permissions, and local device scope.");
  const detail = state.data.consentDetail;
  const app = detail.app;
  const request = detail.consent_request;
  const devices = detail.devices || [];
  const requestedChannels = request.requested_capabilities.flatMap((capability) => capability.channels);
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("", `
          ${entityHeader(app.name, "Third-party app consent", badge(request.status))}
          <div class="kv-grid">
            ${kvItem("App ID", app.id)}
            ${kvItem("Publisher", app.publisher?.display_name || "Unverified publisher")}
            ${kvItem("Trust status", app.trust_status || "unverified")}
            ${kvItem("Review status", app.review_status || "not submitted")}
          </div>
          <p class="notice inline">Payload encrypted end-to-end. Musubi routes requests but cannot read task contents; local policy on the selected device can still deny execution.</p>
        `)}
        ${panel("Requested Access", `
          <div class="permission-grid">
            ${request.requested_capabilities.map((capability) => `
              <div class="band">
                <h3>${escapeHtml(capability.plugin)}</h3>
                <div class="chips">${chips(capability.channels)}</div>
                <p class="muted">${escapeHtml(capability.reason || "No reason provided.")}</p>
              </div>
            `).join("")}
          </div>
        `)}
      </div>
      <aside class="detail-rail">
        ${panel("Approve Scope", `
          <div class="form-grid">
            <label>Device<select id="consent-device">${devices.map((device) => `<option value="${device.id}">${escapeHtml(device.name || device.id)} (${device.status})</option>`).join("")}</select></label>
            <div class="channel-editor">
              <h3>Channels</h3>
              <div class="checkboxes">
                ${requestedChannels.map((channel) => `<label><input type="checkbox" value="${escapeHtml(channel)}" checked /> ${escapeHtml(channel)}</label>`).join("")}
              </div>
            </div>
            <label class="toggle-line"><input id="consent-queueing" type="checkbox" /> Queue when device is offline</label>
            <button class="primary" id="approve-consent" ${request.status === "pending" ? "" : "disabled"}>Approve grant</button>
          </div>
          <p class="muted">You can revoke this app or individual grants from Authorized Apps after approval.</p>
        `, "permission-panel")}
      </aside>
    </section>
  `;
  document.querySelector("#approve-consent")?.addEventListener("click", async () => {
    const allowed_channels = [...document.querySelectorAll(".checkboxes input:checked")].map((input) => input.value);
    await api(`/v1/consent-requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        device_id: document.querySelector("#consent-device").value,
        allowed_channels,
        queueing_allowed: document.querySelector("#consent-queueing").checked,
      }),
    });
    location.hash = "apps/authorized";
    load();
  });
}

function renderAuthorizedApps() {
  setHeader("Authorized Apps", "Third-party app grants, publisher identity, reports, and revoke controls.");
  const rows = state.data.authorizedApps.authorized_apps || [];
  root.innerHTML = `
    <section class="notice">Authorized app grants can be revoked without deleting message or audit history.</section>
    ${panel("Third-party Apps", `${authorizedAppTable(rows)}${paginationControls("authorizedApps", state.data.authorizedApps)}`, "table-panel")}
  `;
  bindActions();
}

function renderPlugins() {
  setHeader("Plugins", "Registry packages, signatures, trust level, and workspace install policy.");
  const plugins = state.data.plugins.plugins || [];
  const policy = state.data.pluginPolicy.policy || defaultPluginPolicy();
  root.innerHTML = `
    <section class="metric-strip compact">
      ${metric("Registry plugins", plugins.length, "Available locally")}
      ${metric("Signature required", policy.require_signature ? "yes" : "no", "Default install gate")}
      ${metric("Allowed trust", policy.allowed_trust_levels.join(", "), "Workspace policy")}
      ${metric("Blocked plugins", policy.blocked_plugins.length, "Explicit denials")}
    </section>
    ${panel("Registry", `${pluginTable(plugins)}${paginationControls("plugins", state.data.plugins)}`, "table-panel")}
  `;
}

function defaultPluginPolicy() {
  return {
    require_signature: true,
    allowed_trust_levels: ["official", "verified"],
    blocked_plugins: [],
  };
}

function renderPlugin(name) {
  setHeader("Plugin Detail", "Inspect manifest, publisher trust, signature metadata, and install command.");
  const detail = state.data.pluginDetail;
  const plugin = detail.plugin;
  const installCommand = `go run ./cmd/musubi plugin install ${plugin.name} --server ${location.origin} --home .musubi/m4 --version ${plugin.version} --yes`;
  root.innerHTML = `
    <section class="detail-layout">
      <div class="detail-main">
        ${panel("", `
          ${entityHeader(plugin.name, "Registry plugin", badge(plugin.signature_status))}
          <div class="kv-grid">
            ${kvItem("Version", plugin.version)}
            ${kvItem("Publisher", `${plugin.publisher.name} (${plugin.publisher.trust})`)}
            ${kvItem("Digest", plugin.package_digest)}
            ${kvItem("Signing key", plugin.signing_key_id)}
          </div>
        `)}
        ${panel("Manifest", `
          <div class="permission-grid">
            <div><span class="muted">Channels</span><div class="chips">${chips(plugin.manifest.channels)}</div></div>
            <div><span class="muted">Permissions</span><div class="chips">${chips(plugin.manifest.permissions)}</div></div>
          </div>
        `)}
      </div>
      <aside class="detail-rail">
        ${panel("Install", `
          <pre>${escapeHtml(installCommand)}</pre>
          <button data-copy="${escapeHtml(installCommand)}">Copy install command</button>
        `)}
      </aside>
    </section>
  `;
  bindCopy();
}

function renderApp(id) {
  setHeader("App Detail", "Inspect app identity, keys, authorized devices, messages, and safety actions.");
  const detail = state.data.appDetail;
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
        ${panel("API Keys", `
          <p class="notice inline">API key secrets are shown only when created. The server stores hashes and prefixes.</p>
          ${state.createdApiKey?.appId === detail.app.id ? `
            <div class="band revealed-secret">
              <p class="muted">New API key secret</p>
              <pre>${escapeHtml(state.createdApiKey.secret)}</pre>
              <button data-copy="${escapeHtml(state.createdApiKey.secret)}">Copy secret</button>
            </div>
          ` : ""}
          <div class="toolbar panel-tools">
            <button class="primary" data-create-api-key="${detail.app.id}">Create API key</button>
          </div>
          ${apiKeyTable(detail.api_keys || [])}
        `, "table-panel")}
        ${panel("SDK Quickstart", sdkQuickstart(detail), "sdk-panel")}
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
  bindCopy();
}

function renderMessages() {
  setHeader("Messages", "Message lifecycle across apps and devices. Payload plaintext is not displayed.");
  const messages = state.data.messages.messages;
  root.innerHTML = `
    <section class="notice">Payload encrypted end-to-end. Musubi server cannot display task contents.</section>
    ${panel("Messages", `
      ${messageFilters()}
      ${messageTable(messages)}
      ${paginationControls("messages", state.data.messages)}
    `, "table-panel")}
  `;
  bindFilters();
}

function renderMessage(id) {
  setHeader("Message Detail", "Timeline, routing metadata, crypto metadata, and safe error details.");
  const detail = state.data.messageDetail;
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
  const auditEvents = state.data.audit.audit_events;
  root.innerHTML = `
    <section class="notice">Audit events exclude decrypted payloads.</section>
    ${panel("Audit Events", `
      ${auditFilters()}
      ${auditTable(auditEvents)}
      ${paginationControls("audit", state.data.audit)}
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
  return table(["App", "Type", "Trust", "Status", "Authorized Devices", "Allowed Channels", "Created At", "Actions"], apps.map((app) => [
    resourceCell(app.name, app.id),
    escapeHtml(app.type),
    badge(app.trust_status || app.publisher?.verification_status || "local"),
    badge(app.status),
    mono(String(app.authorized_device_count)),
    mono(String(app.allowed_channel_count)),
    timeCell(app.created_at),
    `<button onclick="location.hash='apps/${app.id}'">View detail</button>`,
  ]));
}

function authorizedAppTable(rows) {
  if (!rows.length) return empty("No third-party apps are authorized yet.");
  return table(["App", "Publisher", "Trust", "Grants", "Reports", "Actions"], rows.map((row) => [
    resourceCell(row.app.name, row.app.id),
    escapeHtml(row.app.publisher?.display_name || "Unverified publisher"),
    badge(row.app.trust_status || "unverified"),
    mono(String(row.grants.filter((grant) => grant.status === "active").length)),
    mono(String(row.reports.length)),
    `<div class="toolbar table-actions"><button onclick="location.hash='apps/${row.app.id}'">View</button><button data-report-app="${row.app.id}">Report</button><button class="danger" data-revoke-app="${row.app.id}">Revoke</button></div>`,
  ]));
}

function pluginTable(plugins) {
  if (!plugins.length) return empty("No registry plugins available.");
  return table(["Plugin", "Publisher", "Trust", "Signature", "Channels", "Permissions", "Actions"], plugins.map((plugin) => [
    resourceCell(plugin.name, plugin.version),
    escapeHtml(plugin.publisher?.name || "unknown"),
    badge(plugin.publisher?.trust || "unknown"),
    badge(plugin.signature_status),
    chips(plugin.manifest?.channels || []),
    chips(plugin.manifest?.permissions || []),
    `<button onclick="location.hash='plugins/${plugin.name}'">View detail</button>`,
  ]));
}

function apiKeyTable(keys) {
  if (!keys.length) return empty("No API keys yet.");
  return table(["Key", "Status", "Created At", "Last Used", "Actions"], keys.map((key) => [
    resourceCell(key.name || key.id, `${key.prefix}...`),
    badge(key.status),
    timeCell(key.created_at),
    timeCell(key.last_used_at),
    key.status === "active" ? `<button class="danger" data-revoke-api-key="${key.id}">Revoke</button>` : "",
  ]));
}

function sdkQuickstart(detail) {
  const appId = detail.app.id;
  const server = location.origin;
  const snippet = `import { MusubiApp, echoPayload } from "./sdk/app-js/src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: "${server}",
  appId: "${appId}",
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
  appKeyId: "${detail.active_key?.id || "appkey_001"}",
});

const [device] = await musubi.devices.listGranted();
const invocation = await musubi.invoke({
  deviceId: device.id,
  channel: "echo.echo",
  payload: echoPayload("hello from the SDK"),
});
console.log(await invocation.result());`;
  return `
    <p class="muted">Use an API key secret and the locally held app private key from the CLI output.</p>
    <pre>${escapeHtml(snippet)}</pre>
    <button data-copy="${escapeHtml(snippet)}">Copy SDK snippet</button>
  `;
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
  const options = unique([selected, ...values].filter(Boolean));
  return `
    <label>${label}
      <select id="${id}" data-filter-field="${field}">
        <option value="">All</option>
        ${options.map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
      </select>
    </label>
  `;
}

function bindFilters() {
  document.querySelectorAll("[data-filter-field]").forEach((select) => {
    select.addEventListener("change", () => {
      const target = select.id.startsWith("audit-") ? state.auditFilters : state.messageFilters;
      const pageKey = select.id.startsWith("audit-") ? "audit" : "messages";
      target[select.dataset.filterField] = select.value;
      resetPagination(pageKey);
      load();
    });
  });
}

function paginationControls(key, response) {
  const page = paginationFor(key);
  const hasPrevious = page.history.length > 0;
  const hasNext = Boolean(response?.next_cursor);
  return `
    <div class="pagination-bar" data-pagination-key="${escapeHtml(key)}">
      <button data-page-prev="${escapeHtml(key)}" ${hasPrevious ? "" : "disabled"}>Previous</button>
      <label>Rows
        <select data-page-limit="${escapeHtml(key)}">
          ${[25, 50, 100, 200].map((limit) => `<option value="${limit}" ${page.limit === limit ? "selected" : ""}>${limit}</option>`).join("")}
        </select>
      </label>
      <button data-page-next="${escapeHtml(key)}" data-next-cursor="${escapeHtml(response?.next_cursor || "")}" ${hasNext ? "" : "disabled"}>Next</button>
    </div>
  `;
}

function bindPaginationControls() {
  document.querySelectorAll("[data-page-prev]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = paginationFor(button.dataset.pagePrev);
      page.cursor = page.history.pop() || null;
      load();
    });
  });
  document.querySelectorAll("[data-page-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.nextCursor;
      if (!next) return;
      const page = paginationFor(button.dataset.pageNext);
      page.history.push(page.cursor);
      page.cursor = next;
      load();
    });
  });
  document.querySelectorAll("[data-page-limit]").forEach((select) => {
    select.addEventListener("change", () => {
      const page = paginationFor(select.dataset.pageLimit);
      page.limit = Number(select.value);
      page.cursor = null;
      page.history = [];
      load();
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
  const manifest = capability.manifest || {};
  return `
    <div class="band capability-card">
      <div class="capability-head">
        <h3>${escapeHtml(capability.plugin_name)}</h3>
        <span>${escapeHtml(capability.plugin_version)}</span>
      </div>
      <div class="toolbar">
        ${badge(manifest.trust_level || "local")}
        ${badge(manifest.signature_status || "unreported")}
        ${manifest.install_source ? `<span class="chip">${escapeHtml(manifest.install_source)}</span>` : ""}
      </div>
      <div class="permission-grid">
        <div><span class="muted">Channels</span><div class="chips">${chips(capability.channels)}</div></div>
        <div><span class="muted">Requested permissions</span><div class="chips">${chips(capability.permissions)}</div></div>
      </div>
      ${manifest.publisher_name ? `<p class="muted">Publisher: ${escapeHtml(manifest.publisher_name)}</p>` : ""}
      <p class="muted">Last reported: ${fmt(capability.reported_at)}</p>
    </div>
  `;
}

function grantForm() {
  const apps = state.data.apps.apps.filter((app) => app.status === "active");
  const devices = state.data.devices.devices.filter((device) => device.status !== "revoked");
  const capabilities = state.data.capabilities.capabilities;
  const canCreateGrant = apps.length && devices.length && capabilities.length;
  const pluginOptions = [...new Set(capabilities.map((capability) => capability.plugin_name))];
  const missingGrantInputs = [];
  if (!apps.length) missingGrantInputs.push("active apps");
  if (!devices.length) missingGrantInputs.push("online devices");
  if (!pluginOptions.length) missingGrantInputs.push("reported plugin capabilities");
  const grantPageWarning = missingGrantInputs.length
    ? `No grant input is available on the currently loaded page (${missingGrantInputs.join(", ")}).`
      + " Use the page controls or increase page size to load more rows."
    : "";
  return `
    <div class="form-grid grant-form">
      <label>App<select id="grant-app">${apps.map((app) => `<option value="${app.id}">${escapeHtml(app.name)} (${app.type})</option>`).join("")}</select></label>
      <label>Device<select id="grant-device">${devices.map((device) => `<option value="${device.id}">${escapeHtml(device.name)} (${device.status})</option>`).join("")}</select></label>
      <label>Plugin<select id="grant-plugin">${pluginOptions.map((name) => `<option value="${name}">${escapeHtml(name)}</option>`).join("")}</select></label>
      <div class="channel-editor">
        <h3>Channels</h3>
        <div id="grant-channels" class="checkboxes"></div>
      </div>
      <label class="toggle-line"><input id="grant-queueing" type="checkbox" /> Queueing enabled</label>
      <p class="notice inline">If queueing is disabled, requests fail when the device is offline. This avoids old tasks running unexpectedly when a device reconnects.</p>
      ${grantPageWarning ? `<p class="notice inline">${escapeHtml(grantPageWarning)}</p>` : ""}
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
  document.querySelectorAll("[data-create-api-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const response = await api(`/v1/apps/${button.dataset.createApiKey}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ name: "Control plane key" }),
      });
      state.createdApiKey = { appId: button.dataset.createApiKey, secret: response.api_key };
      await load();
    });
  });
  document.querySelectorAll("[data-revoke-api-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const appId = state.route.split("/")[1];
      await api(`/v1/apps/${appId}/api-keys/${button.dataset.revokeApiKey}/revoke`, { method: "POST" });
      state.createdApiKey = null;
      load();
    });
  });
  document.querySelectorAll("[data-report-app]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/v1/apps/${button.dataset.reportApp}/report`, {
        method: "POST",
        body: JSON.stringify({ reason: "user_reported", description: "Reported from local control plane" }),
      });
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
  const links = [...document.querySelectorAll("nav a")];
  const activeRoute = links
    .map((link) => link.dataset.route)
    .filter((route) => state.route === route || state.route.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];
  links.forEach((link) => {
    link.classList.toggle("active", link.dataset.route === activeRoute);
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
