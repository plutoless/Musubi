type RequestJsonFn = (url: string) => Promise<any>;

interface PagedResponseOptions {
  requestJson?: RequestJsonFn;
  requireNextCursor?: boolean;
  validateRow?: (row: any) => void;
  idForRow?: (row: any) => string;
}

export async function assertPagedResponse(url: string, key: string, options: PagedResponseOptions = {}) {
  const requestJson = options.requestJson ?? defaultRequestJson;
  const idForRow = options.idForRow ?? ((row: any) => row?.id ?? row?.message_id ?? "");
  const firstUrl = new URL(url);
  firstUrl.searchParams.set("limit", "1");
  const first = await requestJson(firstUrl.toString());
  const firstRows = assertArray(first, key, `${key} first page`);
  if (first.limit !== 1) throw new Error(`${key} first page did not echo limit=1`);
  if (firstRows.length !== 1) throw new Error(`${key} first page did not honor limit=1 (received ${firstRows.length})`);
  firstRows.forEach((row) => options.validateRow?.(row));
  if (options.requireNextCursor && typeof first.next_cursor !== "string") {
    throw new Error(`${key} first page did not return next_cursor`);
  }
  if (first.next_cursor !== null && first.next_cursor !== undefined && typeof first.next_cursor !== "string") {
    throw new Error(`${key} next_cursor must be string or null`);
  }
  if (!first.next_cursor) return first;

  const secondUrl = new URL(url);
  secondUrl.searchParams.set("limit", "1");
  secondUrl.searchParams.set("cursor", first.next_cursor);
  const second = await requestJson(secondUrl.toString());
  const secondRows = assertArray(second, key, `${key} second page`);
  if (second.limit !== 1) throw new Error(`${key} second page did not echo limit=1`);
  if (secondRows.length !== 1) throw new Error(`${key} second page did not honor limit=1 (received ${secondRows.length})`);
  secondRows.forEach((row) => options.validateRow?.(row));
  const firstId = idForRow(firstRows[0]);
  const secondId = idForRow(secondRows[0]);
  if (firstId && secondId && firstId === secondId) {
    throw new Error(`${key} pagination cursor returned duplicated row`);
  }
  return first;
}

export function assertDeviceDetail(body: any, deviceId: string) {
  if (body?.device?.id !== deviceId) throw new Error(`device detail did not include device ${deviceId}`);
  if (!body.active_key?.id || body.active_key.device_id !== deviceId) throw new Error("device detail missing active_key");
  assertArray(body, "capabilities", "device detail");
  assertArray(body, "grants", "device detail");
  assertArray(body, "recent_messages", "device detail");
  assertArray(body, "recent_audit_events", "device detail");
  if (!body.local_policy || typeof body.local_policy !== "object") throw new Error("device detail missing local_policy");
  if (!body.local_policy.status || !body.local_policy.default_behavior || !body.local_policy.copy) {
    throw new Error("device detail local_policy missing UI fields");
  }
}

export function assertAppDetail(body: any, appId: string) {
  if (body?.app?.id !== appId) throw new Error(`app detail did not include app ${appId}`);
  if (!body.active_key?.id || body.active_key.app_id !== appId) throw new Error("app detail missing active_key");
  assertArray(body, "api_keys", "app detail");
  assertArray(body, "grants", "app detail");
  assertArray(body, "recent_messages", "app detail");
  assertArray(body, "recent_audit_events", "app detail");
}

export function assertMessageDetail(body: any, messageId: string, plaintextNeedles: string[] = []) {
  if (body?.message?.id !== messageId && body?.message_id !== messageId) {
    throw new Error(`message detail did not include message ${messageId}`);
  }
  assertArray(body, "status_events", "message detail");
  assertArray(body, "audit_events", "message detail");
  if (!body.crypto?.sender_key_id || !body.crypto?.recipient_key_id) throw new Error("message detail missing crypto metadata");
  const serialized = JSON.stringify(body);
  for (const needle of plaintextNeedles) {
    if (needle && serialized.includes(needle)) throw new Error(`message detail leaked plaintext needle ${needle}`);
  }
}

export function assertPluginDetail(body: any, expectedName?: string, expectedVersion?: string) {
  const plugin = body?.plugin;
  if (!plugin?.name) throw new Error("plugin detail missing plugin.name");
  if (expectedName && plugin.name !== expectedName) throw new Error(`plugin detail expected ${expectedName}, received ${plugin.name}`);
  if (expectedVersion && plugin.version !== expectedVersion) throw new Error(`plugin detail expected version ${expectedVersion}, received ${plugin.version}`);
  if (!plugin.version || !plugin.manifest || !plugin.package_digest) throw new Error("plugin detail missing registry fields");
  if (!Array.isArray(plugin.manifest.channels)) throw new Error("plugin detail missing manifest channels");
  if (!Array.isArray(plugin.manifest.permissions)) throw new Error("plugin detail missing manifest permissions");
  if (!plugin.signature_status) throw new Error("plugin detail missing signature_status");
}

export function assertPluginPolicy(body: any) {
  const policy = body?.policy;
  if (!policy || typeof policy !== "object") throw new Error("plugin policy missing policy");
  if (typeof policy.require_signature !== "boolean") throw new Error("plugin policy missing require_signature");
  if (!Array.isArray(policy.allowed_trust_levels)) throw new Error("plugin policy missing allowed_trust_levels");
  if (!Array.isArray(policy.allowed_plugins)) throw new Error("plugin policy missing allowed_plugins");
  if (!Array.isArray(policy.blocked_plugins)) throw new Error("plugin policy missing blocked_plugins");
  if (typeof policy.require_approval_for_permission_increase !== "boolean") {
    throw new Error("plugin policy missing require_approval_for_permission_increase");
  }
}

export function assertConsentDetail(body: any, consentId: string, expectedStatus = "pending") {
  if (body?.consent_request?.id !== consentId) throw new Error(`consent detail did not include consent ${consentId}`);
  if (body.consent_request.status !== expectedStatus) throw new Error(`consent detail expected ${expectedStatus}, received ${body.consent_request.status}`);
  if (!body.app?.id) throw new Error("consent detail missing app");
  if (!body.publisher?.id) throw new Error("consent detail missing publisher");
  assertArray(body, "permission_declarations", "consent detail");
  assertArray(body, "devices", "consent detail");
  assertArray(body, "eligible_devices", "consent detail");
  assertArray(body, "capabilities", "consent detail");
}

export function assertApiKeyList(body: any, appId: string) {
  const rows = assertArray(body, "api_keys", "api key list");
  if (typeof body.limit !== "number") throw new Error("api key list missing limit");
  for (const row of rows) {
    if (row.app_id !== appId) throw new Error("api key list row omitted app_id");
    if (!row.id || !row.prefix || !row.status || !row.created_at) throw new Error("api key list row missing metadata");
    if ("key_hash" in row || "api_key" in row) throw new Error("api key list exposed secret material");
  }
}

function assertArray(body: any, key: string, label: string): any[] {
  if (!Array.isArray(body?.[key])) throw new Error(`${label} missing ${key} array`);
  return body[key];
}

async function defaultRequestJson(url: string): Promise<any> {
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
