import {
  IDS,
  type MessageEnvelope,
  type MessageState,
  type DeviceStatusUpdate,
  type ResultEnvelope,
  allowedChannels,
  visibleEnvelopeLog,
} from "../../../packages/protocol/src/index.ts";
import { createHash, generateKeyPairSync, pbkdf2Sync, randomBytes, sign, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type DeviceSocket = ServerWebSocket<{ deviceId: string }>;

interface StoredMessage {
  envelope: MessageEnvelope;
  status: MessageState;
  result?: ResultEnvelope;
  result_events: ResultEnvelope[];
  history: MessageState[];
  created_at: string;
  updated_at: string;
  error_code?: string;
  error_message?: string;
}

interface DeviceRecord {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  display_name?: string;
  description?: string;
  platform: string;
  cli_version: string;
  status: "offline" | "online" | "revoked";
  created_at: string;
  last_seen_at?: string;
  last_capability_report_at?: string;
  revoked_at?: string;
  revoked_by?: string;
}

interface DeviceKeyRecord {
  id: string;
  device_id: string;
  public_key: string;
  auth_public_key?: string;
  status: "active" | "retired" | "revoked";
  created_at: string;
}

interface AppRecord {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  type: "first_party" | "user_owned" | "third_party";
  status: "draft" | "active" | "disabled" | "revoked" | "suspended";
  publisher_id?: string;
  website?: string;
  privacy_policy_url?: string;
  terms_url?: string;
  trust_status?: "unverified" | "verified" | "official" | "suspicious" | "blocked";
  review_status?: "not_submitted" | "in_review" | "approved" | "rejected" | "changes_requested";
  created_at: string;
  updated_at?: string;
  disabled_at?: string;
  disabled_by?: string;
  revoked_at?: string;
  revoked_by?: string;
}

interface AppKeyRecord {
  id: string;
  app_id: string;
  public_key: string;
  status: "active" | "retired" | "revoked";
  created_at: string;
}

interface AppApiKeyRecord {
  id: string;
  app_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
  revoked_by?: string;
}

interface GrantRecord {
  id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  name?: string;
  description?: string;
  allowed_channels: string[];
  queueing_allowed: boolean;
  created_from_consent_request_id?: string;
  created_at: string;
  updated_at?: string;
  revoked_at?: string;
  revoked_by?: string;
}

interface AuditEventRecord {
  id: string;
  workspace_id: string;
  actor_type: string;
  actor_id?: string;
  event_type: string;
  app_id?: string;
  device_id?: string;
  message_id?: string;
  channel?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface DevicePluginCapabilityRecord {
  id: string;
  workspace_id: string;
  device_id: string;
  plugin_name: string;
  plugin_version: string;
  channels: string[];
  permissions: string[];
  manifest: Record<string, unknown>;
  reported_at: string;
}

interface MessageStatusEventRecord {
  id: string;
  message_id: string;
  workspace_id: string;
  status: MessageState;
  stage?: string;
  error_code?: string;
  error_message?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface DeveloperRecord {
  id: string;
  owner_user_id: string;
  name: string;
  email?: string;
  status: "active" | "suspended";
  created_at: string;
  verified_at?: string;
  suspended_at?: string;
}

interface PublisherRecord {
  id: string;
  developer_id: string;
  display_name: string;
  website?: string;
  support_email?: string;
  privacy_policy_url?: string;
  terms_url?: string;
  logo_url?: string;
  verification_status: "unverified" | "verified" | "suspended";
  created_at: string;
  updated_at?: string;
}

interface PermissionDeclarationRecord {
  id: string;
  app_id: string;
  plugin_name: string;
  channels: string[];
  reason?: string;
  queueing_requested: boolean;
  created_at: string;
  updated_at?: string;
}

interface ConsentRequestRecord {
  id: string;
  app_id: string;
  user_id?: string;
  state?: string;
  redirect_uri?: string;
  requested_capabilities: Array<{ plugin: string; channels: string[]; reason?: string }>;
  status: "pending" | "approved" | "cancelled" | "expired";
  kind?: "third_party" | "native_pkce";
  workspace_id?: string;
  code_challenge?: string;
  code_challenge_method?: "S256";
  app_public_key?: string;
  selected_device_id?: string;
  authorization_code_hash?: string;
  authorization_code_used_at?: string;
  created_at: string;
  completed_at?: string;
  expires_at?: string;
  grant_id?: string;
}

interface AppSessionTokenRecord {
  id: string;
  token_hash: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  app_key_id?: string;
  status: "active" | "revoked";
  created_at: string;
  expires_at: string;
  last_used_at?: string;
  revoked_at?: string;
  revoked_by?: string;
}

interface UserRecord {
  id: string;
  email?: string;
  name?: string;
  password_hash?: string;
  password_salt?: string;
  created_at: string;
  updated_at?: string;
}

interface UserSessionRecord {
  id: string;
  token_hash: string;
  user_id: string;
  workspace_id: string;
  status: "active" | "revoked";
  created_at: string;
  expires_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

interface DeviceRegistrationTokenRecord {
  id: string;
  token_hash: string;
  user_id: string;
  workspace_id: string;
  status: "active" | "used" | "revoked";
  created_at: string;
  expires_at: string;
  used_at?: string;
  used_device_id?: string;
  revoked_at?: string;
}

interface AdminSessionRecord {
  id: string;
  token_hash: string;
  user_id: string;
  status: "active" | "revoked";
  created_at: string;
  expires_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

interface AppAbuseReportRecord {
  id: string;
  app_id: string;
  reporter_user_id?: string;
  reason: string;
  description?: string;
  status: "open" | "resolved";
  created_at: string;
  resolved_at?: string;
}

interface WorkspacePluginPolicyRecord {
  require_signature: boolean;
  allowed_trust_levels: string[];
  allowed_plugins: string[];
  blocked_plugins: string[];
  require_approval_for_permission_increase: boolean;
  updated_at?: string;
}

interface RegistryPluginVersion {
  version: string;
  manifest: Record<string, unknown>;
  package_url: string;
  package_digest: string;
  signed_payload: string;
  signature: string;
  signing_key_id: string;
  signature_status?: "verified" | "invalid" | "unsigned";
}

interface RelayStateSnapshot {
  messages?: StoredMessage[];
  devices?: DeviceRecord[];
  deviceKeys?: DeviceKeyRecord[];
  apps?: AppRecord[];
  appKeys?: AppKeyRecord[];
  appApiKeys?: AppApiKeyRecord[];
  grants?: GrantRecord[];
  capabilities?: DevicePluginCapabilityRecord[];
  developers?: DeveloperRecord[];
  publishers?: PublisherRecord[];
  permissionDeclarations?: PermissionDeclarationRecord[];
  consentRequests?: ConsentRequestRecord[];
  appSessionTokens?: AppSessionTokenRecord[];
  users?: UserRecord[];
  userSessions?: UserSessionRecord[];
  deviceRegistrationTokens?: DeviceRegistrationTokenRecord[];
  adminSessions?: AdminSessionRecord[];
  abuseReports?: AppAbuseReportRecord[];
  pluginInstallReports?: DevicePluginCapabilityRecord[];
  auditEvents?: AuditEventRecord[];
  messageStatusEvents?: MessageStatusEventRecord[];
  workspacePluginPolicy?: WorkspacePluginPolicyRecord;
}

export function startRelay(options: { hostname?: string; port?: number } = {}) {
  const statePath = process.env.MUSUBI_RELAY_STATE_PATH;
  const initialState = loadRelayState(statePath);
  const messages = new Map<string, StoredMessage>((initialState.messages ?? []).map((item) => [item.envelope.message_id, item]));
  const devices = new Map<string, DeviceRecord>((initialState.devices ?? []).map((item) => [item.id, item]));
  const deviceKeys = new Map<string, DeviceKeyRecord>((initialState.deviceKeys ?? []).map((item) => [item.id, item]));
  const apps = new Map<string, AppRecord>((initialState.apps ?? []).map((item) => [item.id, item]));
  const appKeys = new Map<string, AppKeyRecord>((initialState.appKeys ?? []).map((item) => [item.id, item]));
  const appApiKeys = new Map<string, AppApiKeyRecord>((initialState.appApiKeys ?? []).map((item) => [item.id, item]));
  const grants = new Map<string, GrantRecord>((initialState.grants ?? []).map((item) => [item.id, item]));
  const capabilities: DevicePluginCapabilityRecord[] = [...(initialState.capabilities ?? [])];
  const developers = new Map<string, DeveloperRecord>((initialState.developers ?? []).map((item) => [item.id, item]));
  const publishers = new Map<string, PublisherRecord>((initialState.publishers ?? []).map((item) => [item.id, item]));
  const permissionDeclarations: PermissionDeclarationRecord[] = [...(initialState.permissionDeclarations ?? [])];
  const consentRequests = new Map<string, ConsentRequestRecord>((initialState.consentRequests ?? []).map((item) => [item.id, item]));
  const appSessionTokens = new Map<string, AppSessionTokenRecord>((initialState.appSessionTokens ?? []).map((item) => [item.id, item]));
  const users = new Map<string, UserRecord>((initialState.users ?? []).map((item) => [item.id, item]));
  if (!users.has("user_local")) {
    users.set("user_local", { id: "user_local", email: "user_local@example.test", name: "Local User", created_at: new Date().toISOString() });
  }
  const userSessions = new Map<string, UserSessionRecord>((initialState.userSessions ?? []).map((item) => [item.id, item]));
  const deviceRegistrationTokens = new Map<string, DeviceRegistrationTokenRecord>((initialState.deviceRegistrationTokens ?? []).map((item) => [item.id, item]));
  const adminSessions = new Map<string, AdminSessionRecord>((initialState.adminSessions ?? []).map((item) => [item.id, item]));
  const abuseReports: AppAbuseReportRecord[] = [...(initialState.abuseReports ?? [])];
  const pluginInstallReports: DevicePluginCapabilityRecord[] = [...(initialState.pluginInstallReports ?? [])];
  const auditEvents: AuditEventRecord[] = [...(initialState.auditEvents ?? [])];
  const messageStatusEvents: MessageStatusEventRecord[] = [...(initialState.messageStatusEvents ?? [])];
  const pluginSigningKey = generateKeyPairSync("ed25519");
  const pluginSigningKeyId = "pluginkey_musubi_local";
  const workspacePluginPolicy: WorkspacePluginPolicyRecord = initialState.workspacePluginPolicy ?? {
    require_signature: true,
    allowed_trust_levels: ["official", "verified"],
    allowed_plugins: ["echo", "hermes", "codex"],
    blocked_plugins: [],
    require_approval_for_permission_increase: true,
  };
  let deviceSocket: DeviceSocket | undefined;

  function persistState() {
    if (!statePath) return;
    const snapshot: RelayStateSnapshot = {
      messages: [...messages.values()],
      devices: [...devices.values()].map((device) => device.status === "online" ? { ...device, status: "offline" } : device),
      deviceKeys: [...deviceKeys.values()],
      apps: [...apps.values()],
      appKeys: [...appKeys.values()],
      appApiKeys: [...appApiKeys.values()],
      grants: [...grants.values()],
      capabilities,
      developers: [...developers.values()],
      publishers: [...publishers.values()],
      permissionDeclarations,
      consentRequests: [...consentRequests.values()],
      appSessionTokens: [...appSessionTokens.values()],
      users: [...users.values()],
      userSessions: [...userSessions.values()],
      deviceRegistrationTokens: [...deviceRegistrationTokens.values()],
      adminSessions: [...adminSessions.values()],
      abuseReports,
      pluginInstallReports,
      auditEvents,
      messageStatusEvents,
      workspacePluginPolicy,
    };
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  }

  function transition(messageId: string, status: MessageState, fields: { error_code?: string; error_message?: string } = {}) {
    const item = messages.get(messageId);
    if (!item) return;
    item.status = status;
    item.history.push(status);
    item.updated_at = new Date().toISOString();
    item.error_code = fields.error_code;
    item.error_message = fields.error_message;
    recordStatusEvent(item, status, fields);
    audit("system", undefined, `message.${status}`, {
      workspace_id: item.envelope.workspace_id,
      app_id: item.envelope.app_id,
      device_id: item.envelope.device_id,
      message_id: messageId,
      channel: item.envelope.channel,
      metadata: {
        status,
        ciphertext_bytes: Buffer.byteLength(item.envelope.ciphertext, "utf8"),
        ...(fields.error_code ? { error_code: fields.error_code } : {}),
        ...(fields.error_message ? { error_message: fields.error_message } : {}),
      },
    });
    console.log("[relay] status", { message_id: messageId, status });
  }

  function recordStatusEvent(item: StoredMessage, status: MessageState, fields: { error_code?: string; error_message?: string } = {}) {
    messageStatusEvents.push({
      id: `mse_${String(messageStatusEvents.length + 1).padStart(6, "0")}`,
      message_id: item.envelope.message_id,
      workspace_id: item.envelope.workspace_id,
      status,
      stage: statusToStage(status),
      error_code: fields.error_code,
      error_message: fields.error_message,
      metadata: {
        channel: item.envelope.channel,
        ciphertext_bytes: Buffer.byteLength(item.envelope.ciphertext, "utf8"),
      },
      created_at: new Date().toISOString(),
    });
  }

  function statusToStage(status: MessageState) {
    if (status === "created" || status === "validated") return "authorization";
    if (status === "queued" || status === "delivered") return "routing";
    if (status === "received" || status === "processing") return "device";
    if (status === "completed" || status === "failed" || status === "cancelled") return "terminal";
    return "lifecycle";
  }

  function audit(
    actorType: string,
    actorId: string | undefined,
    eventType: string,
    fields: {
      workspace_id: string;
      app_id?: string;
      device_id?: string;
      message_id?: string;
      channel?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    auditEvents.push({
      id: `audit_${String(auditEvents.length + 1).padStart(6, "0")}`,
      workspace_id: fields.workspace_id,
      actor_type: actorType,
      actor_id: actorId,
      event_type: eventType,
      app_id: fields.app_id,
      device_id: fields.device_id,
      message_id: fields.message_id,
      channel: fields.channel,
      metadata: fields.metadata ?? {},
      created_at: new Date().toISOString(),
    });
    persistState();
  }

  function authorize(envelope: MessageEnvelope): string | undefined {
    if (
      envelope.workspace_id === IDS.workspaceId &&
      envelope.app_id === IDS.appId &&
      envelope.device_id === IDS.deviceId
    ) {
      return allowedChannels.has(envelope.channel) ? undefined : "channel denied";
    }

    return checkGrant(envelope.workspace_id, envelope.app_id, envelope.device_id, envelope.channel);
  }

  function appApiKeyView(key: AppApiKeyRecord) {
    return {
      id: key.id,
      app_id: key.app_id,
      name: key.name,
      prefix: key.prefix,
      status: key.status,
      created_at: key.created_at,
      last_used_at: key.last_used_at,
      revoked_at: key.revoked_at,
    };
  }

  function hashAppApiKey(secret: string) {
    return createHash("sha256").update(secret).digest("hex");
  }

  function hashSecret(secret: string) {
    return createHash("sha256").update(secret).digest("hex");
  }

  function randomBase64Url(byteLength: number) {
    return randomBytes(byteLength).toString("base64url");
  }

  function normalizeEmail(email?: string) {
    return String(email ?? "").trim().toLowerCase();
  }

  function deriveUserPasswordHash(password: string, salt: string) {
    return pbkdf2Sync(password, salt, 100_000, 32, "sha256").toString("hex");
  }

  function verifyUserPassword(password: string, salt: string, expectedHash: string) {
    const actual = Buffer.from(deriveUserPasswordHash(password, salt), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  function readBearer(req: Request): string | undefined {
    const header = req.headers.get("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
  }

  type AppAuth =
    | { kind: "api_key"; app: AppRecord; apiKey: AppApiKeyRecord }
    | { kind: "native_session"; app: AppRecord; session: AppSessionTokenRecord };

  function authenticateAppRequest(req: Request): AppAuth | Response {
    const secret = readBearer(req);
    if (!secret) return Response.json({ error: "missing app credential" }, { status: 401 });
    const keyHash = hashSecret(secret);
    const apiKey = [...appApiKeys.values()].find((key) => key.key_hash === keyHash);
    if (apiKey?.status === "active") {
      const app = apps.get(apiKey.app_id);
      if (!app || app.status !== "active") return Response.json({ error: "app denied" }, { status: 403 });
      apiKey.last_used_at = new Date().toISOString();
      return { kind: "api_key", app, apiKey };
    }

    const session = [...appSessionTokens.values()].find((item) => item.token_hash === keyHash);
    if (!session || session.status !== "active") return Response.json({ error: "invalid app credential" }, { status: 401 });
    if (Date.parse(session.expires_at) <= Date.now()) return Response.json({ error: "app session expired" }, { status: 401 });
    const app = apps.get(session.app_id);
    if (!app || app.status !== "active") return Response.json({ error: "app denied" }, { status: 403 });
    session.last_used_at = new Date().toISOString();
    return { kind: "native_session", app, session };
  }

  function rejectAppApiKeyOnControlPlane(req: Request): Response | undefined {
    if (!readBearer(req)) return undefined;
    return Response.json({ error: "app runtime credentials cannot manage control plane resources" }, { status: 403 });
  }

  function parseCookies(req: Request): Record<string, string> {
    const cookie = req.headers.get("cookie") ?? "";
    const parsed: Record<string, string> = {};
    for (const part of cookie.split(";")) {
      const index = part.indexOf("=");
      if (index > 0) parsed[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return parsed;
  }

  function authenticateAdminRequest(req: Request): AdminSessionRecord | Response {
    const token = parseCookies(req).musubi_admin_session;
    if (!token) return Response.json({ error: "admin session required" }, { status: 401 });
    const session = [...adminSessions.values()].find((item) => item.token_hash === hashSecret(token));
    if (!session || session.status !== "active") return Response.json({ error: "admin session required" }, { status: 401 });
    if (Date.parse(session.expires_at) <= Date.now()) return Response.json({ error: "admin session expired" }, { status: 401 });
    session.last_used_at = new Date().toISOString();
    return session;
  }

  function authenticateUserRequest(req: Request): UserSessionRecord | Response {
    const token = parseCookies(req).musubi_user_session;
    if (!token) return Response.json({ error: "user session required" }, { status: 401 });
    const session = [...userSessions.values()].find((item) => item.token_hash === hashSecret(token));
    if (!session || session.status !== "active") return Response.json({ error: "user session required" }, { status: 401 });
    if (Date.parse(session.expires_at) <= Date.now()) return Response.json({ error: "user session expired" }, { status: 401 });
    session.last_used_at = new Date().toISOString();
    return session;
  }

  function optionalUserSession(req: Request): UserSessionRecord | undefined {
    const session = authenticateUserRequest(req);
    return session instanceof Response ? undefined : session;
  }

  function effectiveUser(req: Request): { id: string; workspace_id: string; authenticated: boolean } {
    const session = optionalUserSession(req);
    return session
      ? { id: session.user_id, workspace_id: session.workspace_id, authenticated: true }
      : { id: "user_local", workspace_id: "ws_local", authenticated: false };
  }

  function requireUser(req: Request): UserSessionRecord | Response {
    const rejected = rejectAppApiKeyOnControlPlane(req);
    if (rejected) return rejected;
    return authenticateUserRequest(req);
  }

  function userCookie(token: string, maxAgeSeconds: number) {
    return `musubi_user_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }

  function requireAdmin(req: Request): Response | undefined {
    const rejected = rejectAppApiKeyOnControlPlane(req);
    if (rejected) return rejected;
    const admin = authenticateAdminRequest(req);
    return admin instanceof Response ? admin : undefined;
  }

  function adminCookie(token: string, maxAgeSeconds: number) {
    return `musubi_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }

  function checkGrant(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const denied = grantDenied(workspaceId, appId, deviceId, channel);
    return denied;
  }

  function grantDenied(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const app = apps.get(appId);
    if (!app || app.status !== "active") return app?.status === "suspended" ? "app suspended" : "app denied";
    if (app.trust_status === "blocked") return "app blocked";
    const publisher = publisherView(app.publisher_id);
    if (publisher?.verification_status === "suspended") return "publisher suspended";
    if (app.type === "third_party" && !declaresChannel(app.id, channel)) return "undeclared channel denied";
    const device = devices.get(deviceId);
    if (!device) return "device denied";
    if (device.status === "revoked") return "device revoked";
    const activeAppKey = [...appKeys.values()].find((key) => key.app_id === appId && key.status === "active");
    if (!activeAppKey) return "app key denied";
    const activeDeviceKey = [...deviceKeys.values()].find((key) => key.device_id === deviceId && key.status === "active");
    if (!activeDeviceKey) return "device key denied";
    const activeGrant = [...grants.values()].find(
      (grant) =>
        grant.workspace_id === workspaceId &&
        grant.app_id === appId &&
        grant.device_id === deviceId &&
        !grant.revoked_at,
    );
    if (!activeGrant) return "grant denied";
    if (!activeGrant.allowed_channels.includes(channel)) return "channel denied";
    return undefined;
  }

  function activeGrantFor(workspaceId: string, appId: string, deviceId: string, channel: string): GrantRecord | undefined {
    return [...grants.values()].find(
      (grant) =>
        grant.workspace_id === workspaceId &&
        grant.app_id === appId &&
        grant.device_id === deviceId &&
        !grant.revoked_at &&
        grant.allowed_channels.includes(channel),
    );
  }

  function sessionGrantDenied(auth: AppAuth | undefined, workspaceId: string, deviceId: string, channel: string): string | undefined {
    if (!auth || auth.kind !== "native_session") return undefined;
    if (workspaceId !== auth.session.workspace_id) return "workspace denied";
    const device = devices.get(deviceId);
    if (!device || device.owner_user_id !== auth.session.user_id) return "device denied";
    return checkGrant(workspaceId, auth.app.id, deviceId, channel);
  }

  function canReadMessage(auth: AppAuth | undefined, item: StoredMessage): string | undefined {
    if (!auth) return undefined;
    if (item.envelope.app_id !== auth.app.id) return "not found";
    if (auth.kind === "native_session") {
      return sessionGrantDenied(auth, item.envelope.workspace_id, item.envelope.device_id, item.envelope.channel);
    }
    return undefined;
  }

  function declaresChannel(appId: string, channel: string) {
    const appDeclarations = permissionDeclarations.filter((declaration) => declaration.app_id === appId);
    if (appDeclarations.length === 0) return false;
    return appDeclarations.some((declaration) => declaration.channels.includes(channel));
  }

  function publisherView(publisherId?: string) {
    return publisherId ? publishers.get(publisherId) : undefined;
  }

  function callbackUrl(base: string, state: string | undefined, status: string, grantId?: string) {
    const url = new URL(base);
    url.searchParams.set("status", status);
    if (state) url.searchParams.set("state", state);
    if (grantId) url.searchParams.set("grant_id", grantId);
    return url.toString();
  }

  function nativeCallbackUrl(base: string, state: string | undefined, code: string) {
    const url = new URL(base);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return url.toString();
  }

  function appView(app: AppRecord) {
    const activeGrants = [...grants.values()].filter((grant) => grant.app_id === app.id && !grant.revoked_at);
    return {
      ...app,
      publisher: publisherView(app.publisher_id),
      permission_declarations: permissionDeclarations.filter((item) => item.app_id === app.id),
      authorized_device_count: new Set(activeGrants.map((grant) => grant.device_id)).size,
      allowed_channel_count: new Set(activeGrants.flatMap((grant) => grant.allowed_channels)).size,
    };
  }

  function registryVersion(name: string, version = "latest"): RegistryPluginVersion | undefined {
    const latestByName: Record<string, string> = { echo: "0.1.0", hermes: "0.1.0", codex: "0.3.0", "community-signed": "1.0.0", "community-unsigned": "1.0.0" };
    const resolved = version === "latest" ? latestByName[name] : version;
    const base: Record<string, RegistryPluginVersion | undefined> = {
      "codex@0.2.5": signedPlugin("codex", "0.2.5", "official", ["codex.task.create", "codex.task.cancel", "codex.task.status"], ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"]),
      "codex@0.3.0": signedPlugin("codex", "0.3.0", "official", ["codex.task.create", "codex.task.cancel", "codex.task.status"], ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound", "fs.write.any"]),
      "codex@tampered": signedPlugin("codex", "tampered", "official", ["codex.task.create"], ["process.spawn"], "invalid"),
      "echo@0.1.0": signedPlugin("echo", "0.1.0", "official", ["echo.echo", "echo.ping"], ["status.report"]),
      "hermes@0.1.0": signedPlugin("hermes", "0.1.0", "official", ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"], ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"]),
      "community-signed@1.0.0": signedPlugin("community-signed", "1.0.0", "community", ["community.run"], ["process.spawn"]),
      "community-unsigned@1.0.0": unsignedPlugin("community-unsigned", "1.0.0", "community", ["community.run"], ["process.spawn.any"]),
    };
    return base[`${name}@${resolved}`];
  }

  function signedPlugin(name: string, version: string, trust: string, channels: string[], permissions: string[], signatureStatus: "verified" | "invalid" = "verified"): RegistryPluginVersion {
    const manifest = pluginManifestV2(name, version, trust, channels, permissions);
    const signedPayload = `${name}|${version}|${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    const signature = sign(null, Buffer.from(signedPayload), pluginSigningKey.privateKey).toString("base64");
    return {
      version,
      manifest,
      package_url: `registry://plugins/${name}/${version}`,
      package_digest: `sha256:${createHash("sha256").update(signedPayload).digest("hex")}`,
      signed_payload: signedPayload,
      signature: signatureStatus === "invalid" ? `${signature.slice(0, -2)}xx` : signature,
      signing_key_id: pluginSigningKeyId,
      signature_status: signatureStatus,
    };
  }

  function unsignedPlugin(name: string, version: string, trust: string, channels: string[], permissions: string[]): RegistryPluginVersion {
    const manifest = pluginManifestV2(name, version, trust, channels, permissions);
    const signedPayload = `${name}|${version}|${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
    return {
      version,
      manifest,
      package_url: `registry://plugins/${name}/${version}`,
      package_digest: `sha256:${createHash("sha256").update(signedPayload).digest("hex")}`,
      signed_payload: signedPayload,
      signature: "",
      signing_key_id: pluginSigningKeyId,
      signature_status: "unsigned",
    };
  }

  function pluginManifestV2(name: string, version: string, trust: string, channels: string[], permissions: string[]) {
    return {
      name,
      version,
      publisher: { id: trust === "official" ? "plugpub_musubi" : "plugpub_community", name: trust === "official" ? "Musubi" : "Community", trust },
      description: `${name} plugin package`,
      runtime: "bun",
      entry: `bun run plugins/${name}/src/main.ts`,
      channels,
      event_channels: channels.some((channel) => channel.includes("codex")) ? ["codex.task.event"] : channels.some((channel) => channel.includes("hermes")) ? ["hermes.task.event"] : [],
      permissions,
      config_schema: {},
    };
  }

  function registryPluginResponse(name: string, version = "latest") {
    const resolved = registryVersion(name, version);
    if (!resolved) return undefined;
    const manifest = resolved.manifest as any;
    return {
      plugin: {
        name,
        version: resolved.version,
        publisher: manifest.publisher,
        manifest: resolved.manifest,
        package_url: resolved.package_url,
        package_digest: resolved.package_digest,
        signed_payload: resolved.signed_payload,
        signature: resolved.signature,
        signing_key_id: resolved.signing_key_id,
        signing_public_key: Buffer.from(pluginSigningKey.publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64"),
        signature_status: resolved.signature_status,
      },
    };
  }

  function isExpired(envelope: MessageEnvelope): boolean {
    const candidate = envelope as MessageEnvelope & {
      created_at?: string;
      expires_at?: string;
      ttl_seconds?: number;
    };
    const now = Date.now();
    if (candidate.expires_at && Date.parse(candidate.expires_at) <= now) return true;
    const createdAt = candidate.created_at ?? candidate.metadata?.created_at;
    const ttlSeconds = candidate.ttl_seconds ?? candidate.metadata?.ttl_seconds;
    if (!createdAt || !ttlSeconds || ttlSeconds <= 0) return false;
    return Date.parse(createdAt) + ttlSeconds * 1000 <= now;
  }

  async function handleCreateMessage(req: Request): Promise<Response> {
    const appAuth = readBearer(req) ? authenticateAppRequest(req) : undefined;
    if (appAuth instanceof Response) return appAuth;
    const envelope = (await req.json()) as MessageEnvelope;
    if (appAuth && !envelope.app_id) {
      envelope.app_id = appAuth.app.id;
      envelope.workspace_id ||= appAuth.app.workspace_id;
    }
    if (!envelope.app_id) {
      return Response.json({ message_id: envelope.message_id, status: "failed", error: "app id required" }, { status: 400 });
    }
    if (appAuth && envelope.app_id !== appAuth.app.id) {
      return Response.json({ message_id: envelope.message_id, status: "failed", error: "app id mismatch" }, { status: 403 });
    }
    const sessionDenied = sessionGrantDenied(appAuth, envelope.workspace_id, envelope.device_id, envelope.channel);
    if (sessionDenied) {
      return Response.json({ message_id: envelope.message_id, status: "failed", error: sessionDenied }, { status: 403 });
    }
    messages.set(envelope.message_id, {
      envelope,
      status: "created",
      result_events: [],
      history: ["created"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    recordStatusEvent(messages.get(envelope.message_id)!, "created");
    audit("app", envelope.app_id, "message.created", {
      workspace_id: envelope.workspace_id,
      app_id: envelope.app_id,
      device_id: envelope.device_id,
      message_id: envelope.message_id,
      channel: envelope.channel,
      metadata: { ciphertext_bytes: Buffer.byteLength(envelope.ciphertext, "utf8") },
    });
    console.log("[relay] message created", visibleEnvelopeLog(envelope));

    if (isExpired(envelope)) {
      transition(envelope.message_id, "expired", { error_code: "MESSAGE_EXPIRED", error_message: "message expired" });
      return Response.json({ message_id: envelope.message_id, status: "expired", error: "message expired" }, { status: 410 });
    }

    const denied = authorize(envelope);
    if (denied) {
      transition(envelope.message_id, "failed", { error_code: "AUTHORIZATION_DENIED", error_message: denied });
      return Response.json(
        { message_id: envelope.message_id, status: "failed", error: denied },
        { status: 403 },
      );
    }

    transition(envelope.message_id, "validated");
    if (!deviceSocket) {
      const grant = activeGrantFor(envelope.workspace_id, envelope.app_id, envelope.device_id, envelope.channel);
      if (grant?.queueing_allowed) {
        transition(envelope.message_id, "queued");
        return Response.json({ message_id: envelope.message_id, status: "queued" });
      }
      transition(envelope.message_id, "failed", { error_code: "DEVICE_OFFLINE", error_message: "device offline" });
      return Response.json(
        { message_id: envelope.message_id, status: "failed", error: "device offline" },
        { status: 409 },
      );
    }

    deviceSocket.send(JSON.stringify(envelope));
    transition(envelope.message_id, "delivered");
    return Response.json({ message_id: envelope.message_id, status: "delivered" });
  }

  async function handleCreateAppApiKey(req: Request, appId: string): Promise<Response> {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    if (app.status !== "active") return Response.json({ error: "app revoked" }, { status: 409 });
    const body = await req.json().catch(() => ({})) as { name?: string };
    const suffix = String(appApiKeys.size + 1).padStart(3, "0");
    const id = `appapikey_${suffix}`;
    const secret = `musubi_app_sk_${randomBytes(24).toString("base64url")}`;
    const key: AppApiKeyRecord = {
      id,
      app_id: appId,
      name: body.name || "Default API key",
      prefix: secret.slice(0, 18),
      key_hash: hashAppApiKey(secret),
      status: "active",
      created_at: new Date().toISOString(),
    };
    appApiKeys.set(id, key);
    audit("user", "user_local", "app_api_key.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_api_key_id: id, prefix: key.prefix },
    });
    return Response.json({ api_key: secret, key: appApiKeyView(key) });
  }

  function handleListAppApiKeys(appId: string, url: URL): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const rows = [...appApiKeys.values()]
      .filter((key) => key.app_id === appId)
      .map(appApiKeyView)
      .sort((a, b) => a.id.localeCompare(b.id));
    const { page, next_cursor, limit } = paginate(rows, url);
    return Response.json({
      api_keys: page,
      next_cursor,
      limit,
    });
  }

  function handleRevokeAppApiKey(appId: string, apiKeyId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const key = appApiKeys.get(apiKeyId);
    if (!key || key.app_id !== appId) return Response.json({ error: "not found" }, { status: 404 });
    key.status = "revoked";
    key.revoked_at = new Date().toISOString();
    key.revoked_by = "user_local";
    audit("user", "user_local", "app_api_key.revoked", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_api_key_id: key.id },
    });
    return Response.json({ key: appApiKeyView(key) });
  }

  async function handleRegisterDevice(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      workspace_id: string;
      device_name: string;
      platform: string;
      cli_version: string;
      public_key: string;
      auth_public_key?: string;
      registration_token?: string;
    };
    const registrationToken = body.registration_token ? deviceRegistrationTokens.get([...deviceRegistrationTokens.values()]
      .find((token) => token.token_hash === hashSecret(body.registration_token!))?.id ?? "") : undefined;
    if (body.registration_token) {
      if (!registrationToken || registrationToken.status !== "active" || Date.parse(registrationToken.expires_at) <= Date.now() || registrationToken.used_at) {
        return Response.json({ error: "device registration token denied" }, { status: 403 });
      }
    }
    const ownerUserId = registrationToken?.user_id ?? "user_local";
    const workspaceId = registrationToken?.workspace_id ?? body.workspace_id ?? "ws_local";
    const suffix = String(devices.size + 1).padStart(3, "0");
    const deviceId = `dev_${suffix}`;
    const keyId = `devkey_${suffix}`;
    const now = new Date().toISOString();
    const device: DeviceRecord = {
      id: deviceId,
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      name: body.device_name,
      platform: body.platform,
      cli_version: body.cli_version,
      status: "offline",
      created_at: now,
      last_capability_report_at: undefined,
    };
    const key: DeviceKeyRecord = {
      id: keyId,
      device_id: deviceId,
      public_key: body.public_key,
      auth_public_key: body.auth_public_key,
      status: "active",
      created_at: now,
    };
    devices.set(deviceId, device);
    deviceKeys.set(keyId, key);
    if (registrationToken) {
      registrationToken.status = "used";
      registrationToken.used_at = now;
      registrationToken.used_device_id = deviceId;
    }
    audit("user", ownerUserId, "device.registered", {
      workspace_id: workspaceId,
      device_id: deviceId,
      metadata: { device_key_id: keyId, platform: body.platform, registration_token_id: registrationToken?.id },
    });
    console.log("[relay] device registered", {
      device_id: deviceId,
      device_key_id: keyId,
      workspace_id: workspaceId,
      public_key_bytes: body.public_key.length,
    });
    return Response.json({
      device_id: deviceId,
      device_key_id: keyId,
      relay_url: `ws://${server.hostname}:${server.port}/v1/devices/${deviceId}/connect`,
    });
  }

  async function handleDeviceConnect(req: Request, server: Server, deviceId: string): Promise<Response | undefined> {
    if (deviceId === IDS.deviceId) {
      const upgraded = server.upgrade(req, { data: { deviceId } });
      return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
    }

    const denied = await verifyDeviceConnection(req, deviceId);
    if (denied) return new Response(denied, { status: 401 });
    const upgraded = server.upgrade(req, { data: { deviceId } });
    return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
  }

  async function verifyDeviceConnection(req: Request, deviceId: string): Promise<string | undefined> {
    const device = devices.get(deviceId);
    if (!device) return "unknown device";
    if (device.status === "revoked") return "device revoked";
    const activeKey = [...deviceKeys.values()].find(
      (key) => key.device_id === deviceId && key.status === "active",
    );
    if (!activeKey?.auth_public_key) return "missing active auth key";
    const url = new URL(req.url);
    const ts = url.searchParams.get("ts");
    const sig = url.searchParams.get("sig");
    if (!ts || !sig) return "missing signature";
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
      return "stale signature";
    }
    const publicKey = await crypto.subtle.importKey(
      "raw",
      Buffer.from(activeKey.auth_public_key, "base64"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const canonical = `GET\n/v1/devices/${deviceId}/connect\n${ts}`;
    const ok = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      Buffer.from(sig, "base64"),
      new TextEncoder().encode(canonical),
    );
    return ok ? undefined : "invalid signature";
  }

  async function handleCreateApp(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      workspace_id: string;
      name: string;
      type: "first_party" | "user_owned" | "third_party";
      public_key?: string;
      publisher_id?: string;
      description?: string;
      website?: string;
      privacy_policy_url?: string;
      terms_url?: string;
    };
    const suffix = String(apps.size + 1).padStart(3, "0");
    const appId = `app_${suffix}`;
    const keyId = body.public_key ? `appkey_${suffix}` : undefined;
    const now = new Date().toISOString();
    const app: AppRecord = {
      id: appId,
      workspace_id: body.workspace_id ?? "ws_local",
      name: body.name,
      description: body.description,
      type: body.type ?? "first_party",
      status: "active",
      publisher_id: body.publisher_id,
      website: body.website,
      privacy_policy_url: body.privacy_policy_url,
      terms_url: body.terms_url,
      trust_status: body.type === "third_party" ? "unverified" : "official",
      review_status: body.type === "third_party" ? "approved" : "approved",
      created_at: now,
    };
    apps.set(appId, app);
    if (body.public_key && keyId) {
      const key: AppKeyRecord = {
        id: keyId,
        app_id: appId,
        public_key: body.public_key,
        status: "active",
        created_at: now,
      };
      appKeys.set(keyId, key);
    }
    audit("user", "user_local", "app.created", {
      workspace_id: app.workspace_id,
      app_id: appId,
      metadata: { app_key_id: keyId, type: app.type },
    });
    if (app.type === "third_party") {
      audit("developer", app.publisher_id, "third_party_app.created", {
        workspace_id: app.workspace_id,
        app_id: app.id,
        metadata: { app_key_id: keyId, publisher_id: app.publisher_id },
      });
    }
    console.log("[relay] app created", {
      app_id: appId,
      app_key_id: keyId,
      workspace_id: app.workspace_id,
      public_key_bytes: body.public_key?.length ?? 0,
    });
    return Response.json({ app_id: appId, app_key_id: keyId, status: app.status, trust_status: app.trust_status });
  }

  async function handleCreateDeveloper(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { name?: string; email?: string };
    const id = `devacct_${String(developers.size + 1).padStart(3, "0")}`;
    const developer: DeveloperRecord = {
      id,
      owner_user_id: "user_local",
      name: body.name || "Local Developer",
      email: body.email,
      status: "active",
      created_at: new Date().toISOString(),
    };
    developers.set(id, developer);
    audit("user", "user_local", "developer.created", { workspace_id: "ws_local", metadata: { developer_id: id } });
    return Response.json({ developer });
  }

  async function handleUpdateDeveloper(req: Request, developerId: string): Promise<Response> {
    const developer = developers.get(developerId);
    if (!developer) return Response.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<DeveloperRecord>;
    if (body.name !== undefined) developer.name = body.name;
    if (body.email !== undefined) developer.email = body.email;
    if (body.status === "active" || body.status === "suspended") {
      developer.status = body.status;
      if (body.status === "suspended") developer.suspended_at = new Date().toISOString();
    }
    audit("user", "user_local", developer.status === "suspended" ? "developer.suspended" : "developer.updated", { workspace_id: "ws_local", metadata: { developer_id: developer.id } });
    return Response.json({ developer });
  }

  async function handleCreatePublisher(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as {
      developer_id?: string;
      display_name?: string;
      website?: string;
      support_email?: string;
      privacy_policy_url?: string;
      terms_url?: string;
    };
    if (!body.developer_id || !developers.has(body.developer_id)) return Response.json({ error: "developer denied" }, { status: 400 });
    const id = `pub_${String(publishers.size + 1).padStart(3, "0")}`;
    const publisher: PublisherRecord = {
      id,
      developer_id: body.developer_id,
      display_name: body.display_name || "Unverified Publisher",
      website: body.website,
      support_email: body.support_email,
      privacy_policy_url: body.privacy_policy_url,
      terms_url: body.terms_url,
      verification_status: "unverified",
      created_at: new Date().toISOString(),
    };
    publishers.set(id, publisher);
    audit("user", "user_local", "publisher.created", { workspace_id: "ws_local", metadata: { publisher_id: id } });
    return Response.json({ publisher });
  }

  async function handleAdminLogin(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { username?: string; password?: string };
    const expectedUsername = process.env.MUSUBI_ADMIN_USERNAME ?? "admin";
    const expectedPassword = process.env.MUSUBI_ADMIN_PASSWORD ?? "musubi-admin-local";
    if (body.username !== expectedUsername || body.password !== expectedPassword) {
      return Response.json({ error: "invalid admin credentials" }, { status: 401 });
    }
    const secret = `musubi_admin_${randomBytes(24).toString("base64url")}`;
    const now = new Date();
    const session: AdminSessionRecord = {
      id: `adminsess_${String(adminSessions.size + 1).padStart(3, "0")}`,
      token_hash: hashSecret(secret),
      user_id: "admin_local",
      status: "active",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
    };
    adminSessions.set(session.id, session);
    audit("admin", "admin_local", "admin.login", { workspace_id: "ws_local", metadata: { session_id: session.id } });
    return Response.json(
      { admin: { id: "admin_local", username: expectedUsername }, expires_at: session.expires_at },
      { headers: { "Set-Cookie": adminCookie(secret, 12 * 60 * 60) } },
    );
  }

  function handleAdminMe(req: Request): Response {
    const session = authenticateAdminRequest(req);
    if (session instanceof Response) return session;
    return Response.json({
      admin: {
        id: session.user_id,
        username: process.env.MUSUBI_ADMIN_USERNAME ?? "admin",
      },
      session: {
        id: session.id,
        expires_at: session.expires_at,
        last_used_at: session.last_used_at,
      },
    });
  }

  function handleAdminLogout(req: Request): Response {
    const token = parseCookies(req).musubi_admin_session;
    if (token) {
      const session = [...adminSessions.values()].find((item) => item.token_hash === hashSecret(token));
      if (session && session.status === "active") {
        session.status = "revoked";
        session.revoked_at = new Date().toISOString();
        audit("admin", session.user_id, "admin.logout", { workspace_id: "ws_local", metadata: { session_id: session.id } });
      }
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": adminCookie("", 0) } });
  }

  async function handleUserSignup(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { email?: string; name?: string; password?: string; workspace_id?: string };
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!email || !email.includes("@")) return Response.json({ error: "valid email required" }, { status: 400 });
    if (password.length < 8) return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
    if ([...users.values()].some((user) => normalizeEmail(user.email) === email)) {
      return Response.json({ error: "user already exists" }, { status: 409 });
    }
    const salt = randomBase64Url(16);
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: `user_${String(users.size + 1).padStart(3, "0")}`,
      email,
      name: body.name || email,
      password_salt: salt,
      password_hash: deriveUserPasswordHash(password, salt),
      created_at: now,
      updated_at: now,
    };
    users.set(user.id, user);
    audit("user", user.id, "user.created", { workspace_id: body.workspace_id || "ws_local", metadata: { user_id: user.id, email } });
    return createUserSessionResponse(user, body.workspace_id || "ws_local");
  }

  async function handleUserLogin(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { email?: string; password?: string; workspace_id?: string };
    const email = normalizeEmail(body.email);
    const user = [...users.values()].find((item) => normalizeEmail(item.email) === email);
    if (!user?.password_hash || !user.password_salt || !verifyUserPassword(String(body.password ?? ""), user.password_salt, user.password_hash)) {
      return Response.json({ error: "invalid user credentials" }, { status: 401 });
    }
    return createUserSessionResponse(user, body.workspace_id || "ws_local");
  }

  function createUserSessionResponse(user: UserRecord, workspaceId: string): Response {
    const secret = `musubi_user_${randomBase64Url(24)}`;
    const now = new Date();
    const session: UserSessionRecord = {
      id: `usersess_${String(userSessions.size + 1).padStart(3, "0")}`,
      token_hash: hashSecret(secret),
      user_id: user.id,
      workspace_id: workspaceId,
      status: "active",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    userSessions.set(session.id, session);
    audit("user", user.id, "user.login", { workspace_id: workspaceId, metadata: { session_id: session.id } });
    return Response.json(
      {
        user: { id: user.id, email: user.email, name: user.name, workspace_id: workspaceId },
        session: { id: session.id, expires_at: session.expires_at },
      },
      { headers: { "Set-Cookie": userCookie(secret, 7 * 24 * 60 * 60) } },
    );
  }

  function handleUserMe(req: Request): Response {
    const session = authenticateUserRequest(req);
    if (session instanceof Response) return session;
    const user = users.get(session.user_id);
    if (!user) return Response.json({ error: "user session required" }, { status: 401 });
    return Response.json({
      user: { id: user.id, email: user.email, name: user.name, workspace_id: session.workspace_id },
      session: { id: session.id, expires_at: session.expires_at, last_used_at: session.last_used_at },
    });
  }

  function handleUserLogout(req: Request): Response {
    const token = parseCookies(req).musubi_user_session;
    if (token) {
      const session = [...userSessions.values()].find((item) => item.token_hash === hashSecret(token));
      if (session && session.status === "active") {
        session.status = "revoked";
        session.revoked_at = new Date().toISOString();
        audit("user", session.user_id, "user.logout", { workspace_id: session.workspace_id, metadata: { session_id: session.id } });
      }
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": userCookie("", 0) } });
  }

  async function handleCreateDeviceRegistrationToken(req: Request): Promise<Response> {
    const session = requireUser(req);
    if (session instanceof Response) return session;
    const body = await req.json().catch(() => ({})) as { workspace_id?: string };
    const workspaceId = body.workspace_id || session.workspace_id || "ws_local";
    const secret = `musubi_devreg_${randomBase64Url(24)}`;
    const now = new Date();
    const token: DeviceRegistrationTokenRecord = {
      id: `devreg_${String(deviceRegistrationTokens.size + 1).padStart(3, "0")}`,
      token_hash: hashSecret(secret),
      user_id: session.user_id,
      workspace_id: workspaceId,
      status: "active",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    };
    deviceRegistrationTokens.set(token.id, token);
    audit("user", session.user_id, "device_registration_token.created", { workspace_id: workspaceId, metadata: { token_id: token.id } });
    return Response.json({
      registration_token: secret,
      registration_token_id: token.id,
      workspace_id: workspaceId,
      expires_at: token.expires_at,
      expires_in: 15 * 60,
    });
  }

  async function handleUpdatePublisher(req: Request, publisherId: string): Promise<Response> {
    const publisher = publishers.get(publisherId);
    if (!publisher) return Response.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<PublisherRecord>;
    for (const field of ["display_name", "website", "support_email", "privacy_policy_url", "terms_url", "logo_url"] as const) {
      if (body[field] !== undefined) publisher[field] = body[field] as string | undefined;
    }
    if (body.verification_status === "unverified" || body.verification_status === "verified" || body.verification_status === "suspended") {
      publisher.verification_status = body.verification_status;
    }
    publisher.updated_at = new Date().toISOString();
    const eventType = publisher.verification_status === "verified"
      ? "publisher.verified"
      : publisher.verification_status === "suspended"
        ? "publisher.suspended"
        : "publisher.updated";
    audit("user", "user_local", eventType, { workspace_id: "ws_local", metadata: { publisher_id: publisher.id } });
    return Response.json({ publisher });
  }

  async function handleCreateDeveloperApp(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const response = await handleCreateApp(new Request("http://local", {
      method: "POST",
      body: JSON.stringify({ ...body, workspace_id: body.workspace_id ?? "ws_local", type: "third_party" }),
      headers: { "Content-Type": "application/json" },
    }));
    if (!response.ok) return response;
    const appBody = await response.json();
    const apiKeyResponse = await handleCreateAppApiKey(new Request("http://local", {
      method: "POST",
      body: JSON.stringify({ name: "Developer backend key" }),
      headers: { "Content-Type": "application/json" },
    }), appBody.app_id);
    const apiKeyBody = await apiKeyResponse.json();
    return Response.json({ ...appBody, api_key: apiKeyBody.api_key, api_key_record: apiKeyBody.key });
  }

  async function handleCreatePermissionDeclaration(req: Request, appId: string): Promise<Response> {
    const app = apps.get(appId);
    if (!app || app.type !== "third_party") return Response.json({ error: "third-party app not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { plugin_name?: string; channels?: string[]; reason?: string; queueing_requested?: boolean };
    if (!body.plugin_name || !body.channels?.length) return Response.json({ error: "plugin_name and channels required" }, { status: 400 });
    const declaration: PermissionDeclarationRecord = {
      id: `apd_${String(permissionDeclarations.length + 1).padStart(3, "0")}`,
      app_id: appId,
      plugin_name: body.plugin_name,
      channels: body.channels,
      reason: body.reason,
      queueing_requested: body.queueing_requested ?? false,
      created_at: new Date().toISOString(),
    };
    permissionDeclarations.push(declaration);
    audit("developer", appId, "app.permission_declared", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { declaration_id: declaration.id, plugin_name: declaration.plugin_name, channels: declaration.channels },
    });
    audit("developer", appId, "permission_declaration.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { declaration_id: declaration.id, plugin_name: declaration.plugin_name, channels: declaration.channels },
    });
    return Response.json({ declaration });
  }

  async function handleCreateConsentRequest(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { app_id?: string; state?: string; redirect_uri?: string; requested_capabilities?: Array<{ plugin: string; channels: string[]; reason?: string }> };
    const app = body.app_id ? apps.get(body.app_id) : undefined;
    if (!app || app.type !== "third_party" || app.status !== "active") return Response.json({ error: "third-party app denied" }, { status: 400 });
    const declared = permissionDeclarations
      .filter((item) => item.app_id === app.id)
      .map((item) => ({ plugin: item.plugin_name, channels: item.channels, reason: item.reason }));
    const requested = body.requested_capabilities?.length ? body.requested_capabilities : declared;
    const declaredChannels = new Set(declared.flatMap((item) => item.channels));
    const undeclared = requested.flatMap((item) => item.channels).filter((channel) => !declaredChannels.has(channel));
    if (undeclared.length) return Response.json({ error: `undeclared channels: ${undeclared.join(", ")}` }, { status: 400 });
    const id = `consent_${String(consentRequests.size + 1).padStart(3, "0")}`;
    const consent: ConsentRequestRecord = {
      id,
      app_id: app.id,
      user_id: "user_local",
      state: body.state,
      redirect_uri: body.redirect_uri,
      requested_capabilities: requested,
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    consentRequests.set(id, consent);
    audit("app", app.id, "consent.requested", { workspace_id: app.workspace_id, app_id: app.id, metadata: { consent_id: id } });
    audit("app", app.id, "consent_request.created", { workspace_id: app.workspace_id, app_id: app.id, metadata: { consent_id: id } });
    return Response.json({
      consent_request: consent,
      consent_request_id: id,
      consent_url: `/control-plane/user#consent/${id}`,
      status: consent.status,
      expires_at: consent.expires_at,
    });
  }

  const hermesNativeChannels = new Set(["hermes.task.create", "hermes.task.cancel", "hermes.task.status"]);

  function validateLoopbackRedirect(redirectUri?: string): string | undefined {
    if (!redirectUri) return "redirect_uri required";
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      return "redirect_uri invalid";
    }
    if (url.protocol !== "http:") return "redirect_uri scheme denied";
    if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return "redirect_uri host denied";
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 49152 || port > 65535) return "redirect_uri port denied";
    if (url.pathname !== "/callback") return "redirect_uri path denied";
    if (url.username || url.password) return "redirect_uri userinfo denied";
    return undefined;
  }

  function pkceChallenge(verifier: string) {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  function requestedChannelsFrom(capabilities?: Array<{ plugin: string; channels: string[] }>) {
    return (capabilities ?? []).flatMap((capability) => capability.channels ?? []);
  }

  function validateNativeRequestedCapabilities(app: AppRecord, requested: Array<{ plugin: string; channels: string[]; reason?: string }>) {
    if (!requested.length) return "requested_capabilities required";
    for (const capability of requested) {
      if (capability.plugin !== "hermes") return "only hermes plugin is allowed for native Hermes authorization";
      for (const channel of capability.channels ?? []) {
        if (!hermesNativeChannels.has(channel)) return `channel denied: ${channel}`;
      }
    }
    if (app.status !== "active") return "app denied";
    if (app.trust_status === "blocked" || app.trust_status === "suspicious") return "app denied";
    if (app.type === "third_party") {
      const declared = new Set(permissionDeclarations.filter((item) => item.app_id === app.id).flatMap((item) => item.channels));
      const undeclared = requestedChannelsFrom(requested).filter((channel) => !declared.has(channel));
      if (undeclared.length) return `undeclared channels: ${undeclared.join(", ")}`;
    }
    return undefined;
  }

  async function handleCreateNativeAuthorization(req: Request, requestUrl: URL): Promise<Response> {
    const body = await req.json().catch(() => ({})) as {
      client_id?: string;
      app_id?: string;
      workspace_id?: string;
      redirect_uri?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      requested_capabilities?: Array<{ plugin: string; channels: string[]; reason?: string }>;
      app_public_key?: string;
      state?: string;
    };
    const appId = body.client_id || body.app_id;
    const app = appId ? apps.get(appId) : undefined;
    if (!app || app.workspace_id !== (body.workspace_id ?? app.workspace_id)) return Response.json({ error: "app denied" }, { status: 400 });
    const redirectDenied = validateLoopbackRedirect(body.redirect_uri);
    if (redirectDenied) return Response.json({ error: redirectDenied }, { status: 400 });
    if (body.code_challenge_method !== "S256") return Response.json({ error: "code_challenge_method must be S256" }, { status: 400 });
    if (!body.code_challenge || body.code_challenge.length < 32) return Response.json({ error: "code_challenge required" }, { status: 400 });
    if (!body.app_public_key) return Response.json({ error: "app_public_key required" }, { status: 400 });
    const requested = body.requested_capabilities ?? [];
    const requestedDenied = validateNativeRequestedCapabilities(app, requested);
    if (requestedDenied) return Response.json({ error: requestedDenied }, { status: 400 });

    const id = `nativeauth_${String(consentRequests.size + 1).padStart(3, "0")}`;
    const consent: ConsentRequestRecord = {
      id,
      kind: "native_pkce",
      app_id: app.id,
      workspace_id: app.workspace_id,
      user_id: "user_local",
      state: body.state,
      redirect_uri: body.redirect_uri,
      requested_capabilities: requested,
      status: "pending",
      code_challenge: body.code_challenge,
      code_challenge_method: "S256",
      app_public_key: body.app_public_key,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    consentRequests.set(id, consent);
    audit("app", app.id, "native_authorization.requested", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: {
        authorization_id: id,
        redirect_host: new URL(body.redirect_uri!).hostname,
        requested_channels: requestedChannelsFrom(requested),
      },
    });
    return Response.json({
      authorization_id: id,
      authorization_url: `${requestUrl.origin}/control-plane/user#consent/${id}`,
      consent_request: consent,
      expires_in: 600,
    });
  }

  function ensureAppKey(appId: string, publicKey: string): AppKeyRecord {
    const existing = [...appKeys.values()].find((key) => key.app_id === appId && key.public_key === publicKey && key.status === "active");
    if (existing) return existing;
    const key: AppKeyRecord = {
      id: `appkey_${String(appKeys.size + 1).padStart(3, "0")}`,
      app_id: appId,
      public_key: publicKey,
      status: "active",
      created_at: new Date().toISOString(),
    };
    appKeys.set(key.id, key);
    return key;
  }

  async function handleNativeTokenExchange(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { code?: string; redirect_uri?: string; code_verifier?: string };
    if (!body.code || !body.redirect_uri || !body.code_verifier) return Response.json({ error: "code, redirect_uri, and code_verifier required" }, { status: 400 });
    const codeHash = hashSecret(body.code);
    const consent = [...consentRequests.values()].find((item) => item.kind === "native_pkce" && item.authorization_code_hash === codeHash);
    if (!consent || consent.status !== "approved") return Response.json({ error: "invalid authorization code" }, { status: 400 });
    if (consent.authorization_code_used_at) return Response.json({ error: "authorization code already used" }, { status: 400 });
    if (Date.parse(consent.expires_at ?? "") <= Date.now()) return Response.json({ error: "authorization expired" }, { status: 400 });
    if (consent.redirect_uri !== body.redirect_uri) return Response.json({ error: "redirect_uri mismatch" }, { status: 400 });
    if (pkceChallenge(body.code_verifier) !== consent.code_challenge) return Response.json({ error: "PKCE verifier denied" }, { status: 400 });
    const app = apps.get(consent.app_id);
    if (!app || app.status !== "active") return Response.json({ error: "app denied" }, { status: 403 });
    const secret = `musubi_session_${randomBytes(24).toString("base64url")}`;
    const now = new Date();
    const token: AppSessionTokenRecord = {
      id: `appsession_${String(appSessionTokens.size + 1).padStart(3, "0")}`,
      token_hash: hashSecret(secret),
      app_id: app.id,
      user_id: consent.user_id ?? "user_local",
      workspace_id: consent.workspace_id ?? app.workspace_id,
      app_key_id: [...appKeys.values()].find((key) => key.app_id === app.id && key.public_key === consent.app_public_key && key.status === "active")?.id,
      status: "active",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    };
    appSessionTokens.set(token.id, token);
    consent.authorization_code_used_at = now.toISOString();
    audit("app", app.id, "native_session.created", {
      workspace_id: token.workspace_id,
      app_id: app.id,
      device_id: consent.selected_device_id,
      metadata: { session_id: token.id, authorization_id: consent.id },
    });
    const grantedDeviceIds = [...grants.values()]
      .filter((grant) => grant.app_id === app.id && grant.workspace_id === token.workspace_id && !grant.revoked_at)
      .map((grant) => grant.device_id);
    return Response.json({
      access_token: secret,
      token_type: "Bearer",
      expires_in: 3600,
      app_id: app.id,
      app_session_token_id: token.id,
      workspace_id: token.workspace_id,
      granted_device_ids: [...new Set(grantedDeviceIds)],
    });
  }

  async function handleApproveConsent(req: Request, consentId: string): Promise<Response> {
    const consent = consentRequests.get(consentId);
    if (!consent || consent.status !== "pending") return Response.json({ error: "consent not pending" }, { status: 404 });
    const app = apps.get(consent.app_id);
    if (!app) return Response.json({ error: "app not found" }, { status: 404 });
    const user = effectiveUser(req);
    const body = await req.json().catch(() => ({})) as { device_id?: string; allowed_channels?: string[]; queueing_allowed?: boolean };
    const channels = body.allowed_channels ?? [];
    if (!body.device_id || channels.length === 0) return Response.json({ error: "device_id and allowed_channels required" }, { status: 400 });
    const device = devices.get(body.device_id);
    if (!device || device.owner_user_id !== user.id) return Response.json({ error: "device denied" }, { status: 403 });
    consent.user_id = user.id;
    if (consent.kind === "native_pkce") {
      const requested = new Set(requestedChannelsFrom(consent.requested_capabilities));
      const deniedChannels = channels.filter((channel) => !requested.has(channel) || !hermesNativeChannels.has(channel));
      if (deniedChannels.length) return Response.json({ error: `channel denied: ${deniedChannels.join(", ")}` }, { status: 400 });
      if (!consent.app_public_key) return Response.json({ error: "app public key missing" }, { status: 400 });
      ensureAppKey(app.id, consent.app_public_key);
    } else {
      const declared = new Set(permissionDeclarations.filter((item) => item.app_id === app.id).flatMap((item) => item.channels));
      const undeclared = channels.filter((channel) => !declared.has(channel));
      if (undeclared.length) return Response.json({ error: `undeclared channels: ${undeclared.join(", ")}` }, { status: 400 });
    }
    const grantResponse = await handleCreateGrant(new Request("http://local", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: app.workspace_id,
        app_id: app.id,
        device_id: body.device_id,
        allowed_channels: channels,
        queueing_allowed: body.queueing_allowed ?? false,
        name: consent.kind === "native_pkce" ? "Native Hermes Companion consent grant" : "Third-party consent grant",
        created_from_consent_request_id: consent.id,
      }),
      headers: { "Content-Type": "application/json" },
    }));
    if (!grantResponse.ok) return grantResponse;
    const grantBody = await grantResponse.json();
    consent.status = "approved";
    consent.completed_at = new Date().toISOString();
    consent.selected_device_id = body.device_id;
    consent.grant_id = grantBody.grant_id;
    const authorizationCode = consent.kind === "native_pkce" ? `code_${randomBytes(24).toString("base64url")}` : undefined;
    if (authorizationCode) consent.authorization_code_hash = hashSecret(authorizationCode);
    audit("user", user.id, "consent.approved", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      device_id: body.device_id,
      metadata: { consent_id: consent.id, grant_id: consent.grant_id, channels },
    });
    audit("user", user.id, "consent_request.approved", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      device_id: body.device_id,
      metadata: { consent_id: consent.id, grant_id: consent.grant_id, channels },
    });
    return Response.json({
      status: "approved",
      grant_id: consent.grant_id,
      redirect_uri: consent.redirect_uri
        ? consent.kind === "native_pkce"
          ? nativeCallbackUrl(consent.redirect_uri, consent.state, authorizationCode!)
          : callbackUrl(consent.redirect_uri, consent.state, "approved", consent.grant_id)
        : undefined,
      consent_request: consent,
      grant: grantBody.grant,
    });
  }

  async function handleDenyConsent(req: Request, consentId: string): Promise<Response> {
    const consent = consentRequests.get(consentId);
    if (!consent || consent.status !== "pending") return Response.json({ error: "consent not pending" }, { status: 404 });
    const app = apps.get(consent.app_id);
    if (!app) return Response.json({ error: "app not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reason?: string };
    consent.status = "cancelled";
    consent.completed_at = new Date().toISOString();
    audit("user", "user_local", "consent_request.denied", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { consent_id: consent.id, reason: body.reason || "user_denied" },
    });
    return Response.json({
      status: "denied",
      redirect_uri: consent.redirect_uri ? callbackUrl(consent.redirect_uri, consent.state, "denied") : undefined,
      consent_request: consent,
    });
  }

  async function handleCreateGrant(req: Request): Promise<Response> {
    const user = effectiveUser(req);
    const body = (await req.json()) as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      allowed_channels: string[];
      queueing_allowed?: boolean;
      name?: string;
      description?: string;
      created_from_consent_request_id?: string;
    };
    const device = devices.get(body.device_id);
    if (user.authenticated && device?.owner_user_id !== user.id) return Response.json({ error: "device denied" }, { status: 403 });
    const denied = checkGrantPreconditions(body.workspace_id, body.app_id, body.device_id);
    if (denied) return Response.json({ status: "failed", error: denied }, { status: 400 });

    const suffix = String(grants.size + 1).padStart(3, "0");
    const grantId = `grant_${suffix}`;
    const grant: GrantRecord = {
      id: grantId,
      workspace_id: body.workspace_id,
      app_id: body.app_id,
      device_id: body.device_id,
      name: body.name,
      description: body.description,
      allowed_channels: body.allowed_channels,
      queueing_allowed: body.queueing_allowed ?? false,
      created_from_consent_request_id: body.created_from_consent_request_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    grants.set(grantId, grant);
    audit("user", user.id, "grant.created", {
      workspace_id: body.workspace_id,
      app_id: body.app_id,
      device_id: body.device_id,
      metadata: { grant_id: grantId, allowed_channels: body.allowed_channels },
    });
    console.log("[relay] grant created", {
      grant_id: grantId,
      app_id: body.app_id,
      device_id: body.device_id,
      allowed_channels: body.allowed_channels,
    });
    return Response.json({
      grant_id: grantId,
      status: "active",
      grant: grantView(grant),
      warning: supportedChannelWarning(grant.device_id, grant.allowed_channels),
    });
  }

  function checkGrantPreconditions(workspaceId: string, appId: string, deviceId: string) {
    const app = apps.get(appId);
    if (!app || app.workspace_id !== workspaceId || app.status !== "active") return "app denied";
    const device = devices.get(deviceId);
    if (!device || device.workspace_id !== workspaceId) return "device denied";
    if (device.status === "revoked") return "device revoked";
    return undefined;
  }

  async function handlePermissionCheck(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      channel: string;
    };
    const denied = checkGrant(body.workspace_id, body.app_id, body.device_id, body.channel);
    if (denied) return Response.json({ allowed: false, error: denied });
    return Response.json({ allowed: true });
  }

  async function handleReportCapabilities(req: Request, deviceId: string): Promise<Response> {
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    if (device.status === "revoked") return Response.json({ error: "device revoked" }, { status: 403 });
    const body = (await req.json()) as {
      plugins: Array<{
        name: string;
        version: string;
        channels: string[];
        permissions: string[];
        manifest?: Record<string, unknown>;
      }>;
    };
    const now = new Date().toISOString();
    device.last_capability_report_at = now;
    for (const plugin of body.plugins ?? []) {
      capabilities.push({
        id: `cap_${String(capabilities.length + 1).padStart(6, "0")}`,
        workspace_id: device.workspace_id,
        device_id: deviceId,
        plugin_name: plugin.name,
        plugin_version: plugin.version,
        channels: plugin.channels,
        permissions: plugin.permissions,
        manifest: plugin.manifest ?? {},
        reported_at: now,
      });
    }
    audit("device", deviceId, "device.capabilities_reported", {
      workspace_id: device.workspace_id,
      device_id: deviceId,
      metadata: {
        plugins: (body.plugins ?? []).map((plugin) => ({
          name: plugin.name,
          version: plugin.version,
          channels: plugin.channels,
          permissions: plugin.permissions,
        })),
      },
    });
    return Response.json({ device_id: deviceId, status: "ok", plugins_reported: body.plugins?.length ?? 0 });
  }

  async function handleReportPluginInstalls(req: Request, deviceId: string): Promise<Response> {
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { plugins?: Array<Record<string, any>> };
    const now = new Date().toISOString();
    for (const plugin of body.plugins ?? []) {
      const record: DevicePluginCapabilityRecord = {
        id: `install_${String(pluginInstallReports.length + 1).padStart(6, "0")}`,
        workspace_id: device.workspace_id,
        device_id: deviceId,
        plugin_name: String(plugin.name),
        plugin_version: String(plugin.version),
        channels: plugin.channels ?? [],
        permissions: plugin.permissions ?? [],
        manifest: plugin,
        reported_at: now,
      };
      pluginInstallReports.push(record);
      capabilities.push(record);
    }
    audit("device", deviceId, "plugin.install_reported", {
      workspace_id: device.workspace_id,
      device_id: deviceId,
      metadata: { plugins: (body.plugins ?? []).map((plugin) => ({ name: plugin.name, trust_level: plugin.trust_level, signature_status: plugin.signature_status })) },
    });
    return Response.json({ device_id: deviceId, status: "ok", plugins_reported: body.plugins?.length ?? 0 });
  }

  async function handleCancelMessage(req: Request, messageId: string): Promise<Response> {
    const auth = readBearer(req) ? authenticateAppRequest(req) : undefined;
    if (auth instanceof Response) return auth;
    const item = messages.get(messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    const denied = canReadMessage(auth, item);
    if (denied) return Response.json({ error: denied }, { status: denied === "not found" ? 404 : 403 });
    if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
      return Response.json({ message_id: messageId, status: item.status, error: "message already terminal" }, { status: 409 });
    }
    transition(messageId, "cancel_requested");
    transition(messageId, "cancelled");
    return Response.json({ message_id: messageId, status: "cancelled" });
  }

  function paginate<T>(items: T[], url: URL) {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 100), 500));
    const decoded = decodeCursor(url.searchParams.get("cursor"));
    const cursor = typeof decoded?.offset === "number" && decoded.offset > 0 ? Math.floor(decoded.offset) : 0;
    const page = items.slice(cursor, cursor + limit);
    const next_cursor = cursor + limit < items.length ? encodeCursor({ offset: cursor + limit }) : null;
    return { page, next_cursor, limit };
  }

  function encodeCursor(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  function decodeCursor(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      return decoded && typeof decoded === "object" ? decoded : null;
    } catch {
      return null;
    }
  }

  function latestCapabilitiesFor(deviceId: string) {
    const byPlugin = new Map<string, DevicePluginCapabilityRecord>();
    for (const capability of capabilities.filter((item) => item.device_id === deviceId)) {
      const existing = byPlugin.get(capability.plugin_name);
      if (!existing || existing.reported_at < capability.reported_at) {
        byPlugin.set(capability.plugin_name, capability);
      }
    }
    return [...byPlugin.values()].sort((a, b) => a.plugin_name.localeCompare(b.plugin_name));
  }

  function grantView(grant: GrantRecord) {
    return {
      ...grant,
      status: grant.revoked_at ? "revoked" : "active",
      app: apps.get(grant.app_id),
      device: devices.get(grant.device_id),
    };
  }

  function messageView(item: StoredMessage) {
    const created = Date.parse(item.created_at);
    const updated = Date.parse(item.updated_at);
    return {
      id: item.envelope.message_id,
      message_id: item.envelope.message_id,
      workspace_id: item.envelope.workspace_id,
      app_id: item.envelope.app_id,
      app_name: apps.get(item.envelope.app_id)?.name,
      device_id: item.envelope.device_id,
      device_name: devices.get(item.envelope.device_id)?.name,
      channel: item.envelope.channel,
      status: item.status,
      created_at: item.created_at,
      updated_at: item.updated_at,
      duration_ms: Number.isFinite(created) && Number.isFinite(updated) ? Math.max(0, updated - created) : null,
      ttl_seconds: item.envelope.metadata?.ttl_seconds,
      crypto: {
        version: item.envelope.crypto?.version,
        alg: item.envelope.crypto?.alg,
        sender_key_id: item.envelope.crypto?.sender_key_id,
        recipient_key_id: item.envelope.crypto?.recipient_key_id,
        payload_size: Buffer.byteLength(item.envelope.ciphertext, "utf8"),
      },
      error_code: item.error_code,
      error_message: item.error_message,
    };
  }

  function listMessages(req: Request, url: URL) {
    const auth = readBearer(req) ? authenticateAppRequest(req) : undefined;
    if (auth instanceof Response) return auth;
    const user = optionalUserSession(req);
    let rows = [...messages.values()].map(messageView).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (auth) {
      rows = rows.filter((row) => row.app_id === auth.app.id);
      if (auth.kind === "native_session") {
        rows = rows.filter((row) => !sessionGrantDenied(auth, row.workspace_id, row.device_id, row.channel));
      }
    }
    if (user) rows = rows.filter((row) => devices.get(row.device_id)?.owner_user_id === user.user_id);
    for (const field of ["app_id", "device_id", "channel", "status"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((row) => row[field] === value);
    }
    const { page, next_cursor, limit } = paginate(rows, url);
    return Response.json({ messages: page, next_cursor, limit });
  }

  function listAuditEvents(url: URL, req?: Request) {
    const user = req ? optionalUserSession(req) : undefined;
    let rows = [...auditEvents].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (user) rows = rows.filter((row) => !row.device_id || devices.get(row.device_id)?.owner_user_id === user.user_id || row.actor_id === user.user_id);
    for (const field of ["event_type", "app_id", "device_id", "message_id", "actor_id"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((row) => row[field] === value);
    }
    const { page, next_cursor, limit } = paginate(rows, url);
    return Response.json({ audit_events: page, next_cursor, limit });
  }

  function supportedChannelWarning(deviceId: string, requestedChannels: string[]) {
    const reported = new Set(latestCapabilitiesFor(deviceId).flatMap((capability) => capability.channels));
    if (reported.size === 0) return "device has not reported capabilities yet";
    const unsupported = requestedChannels.filter((channel) => !reported.has(channel));
    return unsupported.length > 0 ? `channels not reported by device capabilities: ${unsupported.join(", ")}` : undefined;
  }

  async function handleUpdateGrant(req: Request, grantId: string): Promise<Response> {
    const user = effectiveUser(req);
    const grant = grants.get(grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    if (grant.revoked_at) return Response.json({ error: "grant revoked" }, { status: 409 });
    if (user.authenticated && devices.get(grant.device_id)?.owner_user_id !== user.id) return Response.json({ error: "grant denied" }, { status: 403 });
    const body = (await req.json()) as {
      allowed_channels?: string[];
      queueing_allowed?: boolean;
      description?: string;
      name?: string;
    };
    if (body.allowed_channels) grant.allowed_channels = body.allowed_channels;
    if (body.queueing_allowed !== undefined) grant.queueing_allowed = body.queueing_allowed;
    if (body.description !== undefined) grant.description = body.description;
    if (body.name !== undefined) grant.name = body.name;
    grant.updated_at = new Date().toISOString();
    audit("user", user.id, "grant.updated", {
      workspace_id: grant.workspace_id,
      app_id: grant.app_id,
      device_id: grant.device_id,
      metadata: { grant_id: grant.id, allowed_channels: grant.allowed_channels },
    });
    return Response.json({ grant: grantView(grant), warning: supportedChannelWarning(grant.device_id, grant.allowed_channels) });
  }

  function handleRevokeGrant(grantId: string, req?: Request): Response {
    const user = req ? effectiveUser(req) : { id: "user_local", workspace_id: "ws_local", authenticated: false };
    const grant = grants.get(grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    if (user.authenticated && devices.get(grant.device_id)?.owner_user_id !== user.id) return Response.json({ error: "grant denied" }, { status: 403 });
    grant.revoked_at = new Date().toISOString();
    grant.revoked_by = user.id;
    grant.updated_at = grant.revoked_at;
    audit("user", user.id, "grant.revoked", {
      workspace_id: grant.workspace_id,
      app_id: grant.app_id,
      device_id: grant.device_id,
      metadata: { grant_id: grant.id },
    });
    console.log("[relay] grant revoked", { grant_id: grant.id });
    return Response.json({ grant_id: grant.id, status: "revoked" });
  }

  function handleRevokeApp(appId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    app.status = "revoked";
    app.revoked_at = new Date().toISOString();
    app.revoked_by = "user_local";
    for (const key of appKeys.values()) {
      if (key.app_id === appId && key.status === "active") key.status = "revoked";
    }
    for (const key of appApiKeys.values()) {
      if (key.app_id === appId && key.status === "active") {
        key.status = "revoked";
        key.revoked_at = app.revoked_at;
        key.revoked_by = "user_local";
      }
    }
    for (const grant of grants.values()) {
      if (grant.app_id === appId && !grant.revoked_at) {
        grant.revoked_at = app.revoked_at;
        grant.revoked_by = "user_local";
        grant.updated_at = app.revoked_at;
      }
    }
    audit("user", "user_local", "app.revoked", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id },
    });
    if (app.type === "third_party") {
      audit("user", "user_local", "third_party_app.revoked", {
        workspace_id: app.workspace_id,
        app_id: app.id,
        metadata: { app_id: app.id },
      });
    }
    return Response.json({ app_id: app.id, status: app.status });
  }

  function handleRevokeAppForUser(appId: string, userId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();
    let revoked = 0;
    for (const grant of grants.values()) {
      const device = devices.get(grant.device_id);
      if (grant.app_id === appId && !grant.revoked_at && device?.owner_user_id === userId) {
        grant.revoked_at = now;
        grant.revoked_by = userId;
        grant.updated_at = now;
        revoked += 1;
      }
    }
    audit("user", userId, "app.grants_revoked", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id, revoked_grants: revoked },
    });
    return Response.json({ app_id: app.id, status: app.status, revoked_grants: revoked });
  }

  function handleRevokeDevice(deviceId: string, req?: Request): Response {
    const user = req ? effectiveUser(req) : { id: "user_local", workspace_id: "ws_local", authenticated: false };
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    if (user.authenticated && device.owner_user_id !== user.id) return Response.json({ error: "device denied" }, { status: 403 });
    device.status = "revoked";
    device.revoked_at = new Date().toISOString();
    device.revoked_by = user.id;
    device.last_seen_at = device.revoked_at;
    for (const key of deviceKeys.values()) {
      if (key.device_id === deviceId && key.status === "active") key.status = "revoked";
    }
    if (deviceSocket?.data.deviceId === deviceId) {
      deviceSocket.close(4001, "device revoked");
      deviceSocket = undefined;
    }
    audit("user", user.id, "device.revoked", {
      workspace_id: device.workspace_id,
      device_id: device.id,
      metadata: { device_id: device.id },
    });
    return Response.json({ device_id: device.id, status: device.status });
  }

  async function handleReportApp(req: Request, appId: string): Promise<Response> {
    const user = effectiveUser(req);
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reason?: string; description?: string };
    const report: AppAbuseReportRecord = {
      id: `report_${String(abuseReports.length + 1).padStart(3, "0")}`,
      app_id: appId,
      reporter_user_id: user.id,
      reason: body.reason || "other",
      description: body.description,
      status: "open",
      created_at: new Date().toISOString(),
    };
    abuseReports.push(report);
    audit("user", user.id, "app.reported", { workspace_id: app.workspace_id, app_id: app.id, metadata: { report_id: report.id, reason: report.reason } });
    if (app.type === "third_party") {
      audit("user", user.id, "third_party_app.reported", { workspace_id: app.workspace_id, app_id: app.id, metadata: { report_id: report.id, reason: report.reason } });
    }
    return Response.json({ report });
  }

  function handleSuspendApp(appId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    app.status = "suspended";
    app.disabled_at = new Date().toISOString();
    app.disabled_by = "admin_local";
    audit("admin", "admin_local", "app.suspended", { workspace_id: app.workspace_id, app_id: app.id, metadata: { app_id: app.id } });
    if (app.type === "third_party") {
      audit("admin", "admin_local", "third_party_app.suspended", { workspace_id: app.workspace_id, app_id: app.id, metadata: { app_id: app.id } });
    }
    return Response.json({ app: appView(app) });
  }

  function listAuthorizedApps(url: URL, req?: Request): Response {
    const user = req ? optionalUserSession(req) : undefined;
    const rows = [...apps.values()]
      .filter((app) => [...grants.values()].some((grant) => grant.app_id === app.id && (!user || devices.get(grant.device_id)?.owner_user_id === user.user_id)))
      .map((app) => ({
        app: appView(app),
        grants: [...grants.values()]
          .filter((grant) => grant.app_id === app.id && (!user || devices.get(grant.device_id)?.owner_user_id === user.user_id))
          .map(grantView),
        reports: abuseReports.filter((report) => report.app_id === app.id && (!user || report.reporter_user_id === user.user_id)),
      }))
      .sort((a, b) => a.app.id.localeCompare(b.app.id));
    const { page, next_cursor, limit } = paginate(rows, url);
    return Response.json({ authorized_apps: page, apps: page, next_cursor, limit });
  }

  function handleListGrantedAppDevices(req: Request, url: URL): Response {
    const auth = authenticateAppRequest(req);
    if (auth instanceof Response) return auth;
    const rows = [...grants.values()]
      .filter((grant) => grant.app_id === auth.app.id && !grant.revoked_at)
      .filter((grant) => auth.kind !== "native_session" || grant.workspace_id === auth.session.workspace_id)
      .map((grant) => {
        const device = devices.get(grant.device_id);
        if (!device) return undefined;
        if (auth.kind === "native_session" && device.owner_user_id !== auth.session.user_id) return undefined;
        return {
          id: device.id,
          name: device.display_name ?? device.name,
          status: device.status,
          platform: device.platform,
          workspace_id: device.workspace_id,
          allowed_channels: grant.allowed_channels,
          queueing_allowed: grant.queueing_allowed,
          last_seen_at: device.last_seen_at,
          last_capability_report_at: device.last_capability_report_at,
        };
      })
      .filter(Boolean)
      .sort((a, b) => String((a as any).id).localeCompare(String((b as any).id)));
    const { page, next_cursor, limit } = paginate(rows, url);
    return Response.json({ devices: page, next_cursor, limit });
  }

  function handleGetAppIdentity(req: Request): Response {
    const auth = authenticateAppRequest(req);
    if (auth instanceof Response) return auth;
    const activeKey = [...appKeys.values()].find((key) => key.app_id === auth.app.id && key.status === "active");
    return Response.json({
      app_id: auth.app.id,
      workspace_id: auth.app.workspace_id,
      credential_type: auth.kind,
      app_api_key_id: auth.kind === "api_key" ? auth.apiKey.id : undefined,
      app_session_token_id: auth.kind === "native_session" ? auth.session.id : undefined,
      active_app_key_id: auth.kind === "native_session" ? auth.session.app_key_id ?? activeKey?.id : activeKey?.id,
    });
  }

  function handleGetAppDevicePublicKey(req: Request, deviceId: string): Response {
    const auth = authenticateAppRequest(req);
    if (auth instanceof Response) return auth;
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const grant = [...grants.values()].find((item) => item.app_id === auth.app.id && item.device_id === deviceId && !item.revoked_at);
    if (!grant) return Response.json({ error: "grant denied" }, { status: 403 });
    if (auth.kind === "native_session") {
      if (grant.workspace_id !== auth.session.workspace_id || device.owner_user_id !== auth.session.user_id) {
        return Response.json({ error: "grant denied" }, { status: 403 });
      }
    }
    const activeKey = [...deviceKeys.values()].find((key) => key.device_id === deviceId && key.status === "active");
    if (!activeKey) return Response.json({ error: "device key denied" }, { status: 404 });
    return Response.json({
      device_id: deviceId,
      device_key_id: activeKey.id,
      public_key: activeKey.public_key,
      allowed_channels: grant.allowed_channels,
    });
  }

  function handleMessageEvents(req: Request, messageId: string, url: URL): Response {
    const auth = readBearer(req) ? authenticateAppRequest(req) : undefined;
    if (auth instanceof Response) return auth;
    const item = messages.get(messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    const denied = canReadMessage(auth, item);
    if (denied) return Response.json({ error: denied }, { status: denied === "not found" ? 404 : 403 });
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
    const events = item.result_events.slice(cursor);
    return Response.json({
      message_id: item.envelope.message_id,
      status: item.status,
      cursor,
      next_cursor: String(cursor + events.length),
      events,
    });
  }

  async function serveControlPlane(pathname: string): Promise<Response> {
    const filePath = pathname === "/control-plane/app.js"
      ? "apps/control-plane/app.js"
      : pathname === "/control-plane/styles.css"
        ? "apps/control-plane/styles.css"
        : "apps/control-plane/index.html";
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const contentType = filePath.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
    return new Response(file, { headers: { "Content-Type": contentType } });
  }

  const server = Bun.serve({
    hostname: options.hostname ?? process.env.MUSUBI_RELAY_HOST ?? "127.0.0.1",
    port: options.port ?? Number(process.env.MUSUBI_RELAY_PORT ?? "8787"),
    async fetch(req, server) {
      const url = new URL(req.url);
      try {

      if ((url.pathname === "/" || url.pathname === "/control-plane") && req.method === "GET") {
        return Response.redirect(`${url.origin}/control-plane/user`, 302);
      }

      if (url.pathname === "/control-plane" || url.pathname.startsWith("/control-plane/")) {
        return serveControlPlane(url.pathname);
      }

      if (url.pathname === "/v1/admin/login" && req.method === "POST") {
        return handleAdminLogin(req);
      }

      if (url.pathname === "/v1/admin/logout" && req.method === "POST") {
        return handleAdminLogout(req);
      }

      if (url.pathname === "/v1/admin/me" && req.method === "GET") {
        return handleAdminMe(req);
      }

      if (url.pathname === "/v1/user/signup" && req.method === "POST") {
        return handleUserSignup(req);
      }

      if (url.pathname === "/v1/user/login" && req.method === "POST") {
        return handleUserLogin(req);
      }

      if (url.pathname === "/v1/user/logout" && req.method === "POST") {
        return handleUserLogout(req);
      }

      if (url.pathname === "/v1/user/me" && req.method === "GET") {
        return handleUserMe(req);
      }

      if (url.pathname === "/v1/user/device-registration-tokens" && req.method === "POST") {
        return handleCreateDeviceRegistrationToken(req);
      }

      if (url.pathname === "/v1/users" && req.method === "GET") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        const rows = [...users.values()]
          .map(({ password_hash, password_salt, ...user }) => user)
          .sort((a, b) => `${b.created_at}:${b.id}`.localeCompare(`${a.created_at}:${a.id}`));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ users: page, next_cursor, limit });
      }

      if (url.pathname === "/v1/oauth/native/authorize" && req.method === "POST") {
        return handleCreateNativeAuthorization(req, url);
      }

      if (url.pathname === "/v1/oauth/native/token" && req.method === "POST") {
        return handleNativeTokenExchange(req);
      }

      const connectMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/connect$/);
      if (connectMatch) {
        return handleDeviceConnect(req, server, connectMatch[1]);
      }

      if (url.pathname === "/v1/devices" && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const user = optionalUserSession(req);
        let rows = [...devices.values()]
          .filter((device) => !url.searchParams.get("workspace_id") || device.workspace_id === url.searchParams.get("workspace_id"))
          .filter((device) => !url.searchParams.get("status") || device.status === url.searchParams.get("status"))
          .filter((device) => !user || device.owner_user_id === user.user_id)
          .map((device) => ({
            id: device.id,
            name: device.display_name ?? device.name,
            status: device.status,
            platform: device.platform,
            cli_version: device.cli_version,
            plugin_count: latestCapabilitiesFor(device.id).length,
            authorized_app_count: new Set([...grants.values()].filter((grant) => grant.device_id === device.id && !grant.revoked_at).map((grant) => grant.app_id)).size,
            last_seen_at: device.last_seen_at,
            last_capability_report_at: device.last_capability_report_at,
            created_at: device.created_at,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ devices: page, next_cursor, limit });
      }

      if (url.pathname === "/v1/devices/register" && req.method === "POST") {
        return handleRegisterDevice(req);
      }

      if (url.pathname === "/v1/apps" && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const rows = [...apps.values()]
          .filter((app) => !url.searchParams.get("type") || app.type === url.searchParams.get("type"))
          .filter((app) => !url.searchParams.get("status") || app.status === url.searchParams.get("status"))
          .filter((app) => !url.searchParams.get("workspace_id") || app.workspace_id === url.searchParams.get("workspace_id"))
          .map((app) => {
          const activeGrants = [...grants.values()].filter((grant) => grant.app_id === app.id && !grant.revoked_at);
          return {
            id: app.id,
            name: app.name,
            type: app.type,
            status: app.status,
            publisher: publisherView(app.publisher_id),
            permission_declarations: permissionDeclarations.filter((item) => item.app_id === app.id),
            trust_status: app.trust_status,
            review_status: app.review_status,
            authorized_device_count: new Set(activeGrants.map((grant) => grant.device_id)).size,
            allowed_channel_count: new Set(activeGrants.flatMap((grant) => grant.allowed_channels)).size,
            created_at: app.created_at,
          };
        }).sort((a, b) => a.id.localeCompare(b.id));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ apps: page, next_cursor, limit });
      }

      if (url.pathname === "/v1/apps" && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreateApp(req);
      }

      if (url.pathname === "/v1/developers" && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreateDeveloper(req);
      }

      if (url.pathname === "/v1/developers" && req.method === "GET") {
        const rows = [...developers.values()].sort((a, b) => `${b.created_at}:${b.id}`.localeCompare(`${a.created_at}:${a.id}`));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ developers: page, next_cursor, limit });
      }

      const developerMatch = url.pathname.match(/^\/v1\/developers\/([^/]+)$/);
      if (developerMatch && req.method === "PATCH") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleUpdateDeveloper(req, developerMatch[1]);
      }

      if (url.pathname === "/v1/publishers" && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreatePublisher(req);
      }

      if (url.pathname === "/v1/publishers" && req.method === "GET") {
        const rows = [...publishers.values()].sort((a, b) => `${b.created_at}:${b.id}`.localeCompare(`${a.created_at}:${a.id}`));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ publishers: page, next_cursor, limit });
      }

      const publisherMatch = url.pathname.match(/^\/v1\/publishers\/([^/]+)$/);
      if (publisherMatch && req.method === "PATCH") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleUpdatePublisher(req, publisherMatch[1]);
      }

      if (url.pathname === "/v1/developer/apps" && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreateDeveloperApp(req);
      }

      const developerApiKeyMatch = url.pathname.match(/^\/v1\/developer\/apps\/([^/]+)\/api-keys$/);
      if (developerApiKeyMatch && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreateAppApiKey(req, developerApiKeyMatch[1]);
      }

      const declarationMatch = url.pathname.match(/^\/v1\/developer\/apps\/([^/]+)\/permission-declarations$/);
      if (declarationMatch && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreatePermissionDeclaration(req, declarationMatch[1]);
      }

      if (url.pathname === "/v1/consent-requests" && req.method === "POST") {
        return handleCreateConsentRequest(req);
      }

      const consentMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)$/);
      if (consentMatch && req.method === "GET") {
        const consent = consentRequests.get(consentMatch[1]);
        if (!consent) return Response.json({ error: "not found" }, { status: 404 });
        const app = apps.get(consent.app_id);
        const user = optionalUserSession(req);
        const consentDevices = [...devices.values()].filter((device) => device.status !== "revoked" && (!user || device.owner_user_id === user.user_id));
        return Response.json({
          consent_request: consent,
          app: app ? appView(app) : undefined,
          publisher: app ? publisherView(app.publisher_id) : undefined,
          permission_declarations: app ? permissionDeclarations.filter((item) => item.app_id === app.id) : [],
          devices: consentDevices,
          eligible_devices: consentDevices,
          capabilities,
        });
      }

      const consentApproveMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)\/approve$/);
      if (consentApproveMatch && req.method === "POST") {
        return handleApproveConsent(req, consentApproveMatch[1]);
      }

      const consentDenyMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)\/deny$/);
      if (consentDenyMatch && req.method === "POST") {
        return handleDenyConsent(req, consentDenyMatch[1]);
      }

      if (url.pathname === "/v1/grants" && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleCreateGrant(req);
      }

      if (url.pathname === "/v1/permissions/check" && req.method === "POST") {
        return handlePermissionCheck(req);
      }

      const capabilitiesMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/capabilities$/);
      if (capabilitiesMatch && req.method === "POST") {
        return handleReportCapabilities(req, capabilitiesMatch[1]);
      }

      const pluginReportMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/plugins\/report$/);
      if (pluginReportMatch && req.method === "POST") {
        return handleReportPluginInstalls(req, pluginReportMatch[1]);
      }

      const grantRevokeMatch = url.pathname.match(/^\/v1\/grants\/([^/]+)\/revoke$/);
      if (grantRevokeMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleRevokeGrant(grantRevokeMatch[1], req);
      }

      const grantPatchMatch = url.pathname.match(/^\/v1\/grants\/([^/]+)$/);
      if (grantPatchMatch && req.method === "PATCH") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleUpdateGrant(req, grantPatchMatch[1]);
      }

      if (url.pathname === "/v1/grants" && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const user = optionalUserSession(req);
        let rows = [...grants.values()]
          .filter((grant) => !user || devices.get(grant.device_id)?.owner_user_id === user.user_id)
          .map(grantView)
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const field of ["app_id", "device_id", "workspace_id"] as const) {
          const value = url.searchParams.get(field);
          if (value) rows = rows.filter((row) => row[field] === value);
        }
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ grants: page, next_cursor, limit });
      }

      const appRevokeMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/revoke$/);
      if (appRevokeMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const user = optionalUserSession(req);
        if (user) return handleRevokeAppForUser(appRevokeMatch[1], user.user_id);
        return handleRevokeApp(appRevokeMatch[1]);
      }

      const appReportMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/report$/);
      if (appReportMatch && req.method === "POST") {
        return handleReportApp(req, appReportMatch[1]);
      }

      const appSuspendMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/suspend$/);
      if (appSuspendMatch && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleSuspendApp(appSuspendMatch[1]);
      }

      if (url.pathname === "/v1/authorized-apps" && req.method === "GET") {
        return listAuthorizedApps(url, req);
      }

      if (url.pathname === "/v1/plugins" && req.method === "GET") {
        const plugins = ["echo", "hermes", "codex", "community-signed", "community-unsigned"]
          .map((name) => registryPluginResponse(name)?.plugin)
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name));
        const { page, next_cursor, limit } = paginate(plugins, url);
        return Response.json({ plugins: page, next_cursor, limit });
      }

      const pluginVersionMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/versions\/([^/]+)$/);
      if (pluginVersionMatch && req.method === "GET") {
        const plugin = registryPluginResponse(pluginVersionMatch[1], pluginVersionMatch[2]);
        return plugin ? Response.json(plugin) : Response.json({ error: "not found" }, { status: 404 });
      }

      const pluginMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)$/);
      if (pluginMatch && req.method === "GET") {
        const plugin = registryPluginResponse(pluginMatch[1]);
        return plugin ? Response.json(plugin) : Response.json({ error: "not found" }, { status: 404 });
      }

      if (url.pathname === "/v1/plugin-registry/resolve" && req.method === "GET") {
        const requestedName = url.searchParams.get("name") ?? "";
        const requestedVersion = url.searchParams.get("version") ?? "latest";
        const plugin = registryPluginResponse(requestedName, requestedVersion);
        if (plugin) {
          audit("user", "user_local", requestedVersion === "latest" ? "plugin.update_checked" : "plugin.registry_resolved", {
            workspace_id: "ws_local",
            metadata: { plugin_name: requestedName, requested_version: requestedVersion, resolved_version: plugin.plugin.version },
          });
        }
        return plugin ? Response.json(plugin) : Response.json({ error: "not found" }, { status: 404 });
      }

      if (url.pathname === "/v1/workspace/plugin-policy" && req.method === "GET") {
        return Response.json({ policy: workspacePluginPolicy });
      }

      if (url.pathname === "/v1/workspace/plugin-policy" && req.method === "PATCH") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        const body = await req.json().catch(() => ({})) as Partial<WorkspacePluginPolicyRecord>;
        if (body.require_signature !== undefined) workspacePluginPolicy.require_signature = body.require_signature;
        if (body.allowed_trust_levels) workspacePluginPolicy.allowed_trust_levels = body.allowed_trust_levels;
        if (body.allowed_plugins) workspacePluginPolicy.allowed_plugins = body.allowed_plugins;
        if (body.blocked_plugins) workspacePluginPolicy.blocked_plugins = body.blocked_plugins;
        if (body.require_approval_for_permission_increase !== undefined) workspacePluginPolicy.require_approval_for_permission_increase = body.require_approval_for_permission_increase;
        workspacePluginPolicy.updated_at = new Date().toISOString();
        audit("user", "user_local", "workspace.plugin_policy_updated", { workspace_id: "ws_local", metadata: { policy: workspacePluginPolicy } });
        return Response.json({ policy: workspacePluginPolicy });
      }

      const deviceRevokeMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/revoke$/);
      if (deviceRevokeMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleRevokeDevice(deviceRevokeMatch[1], req);
      }

      if (url.pathname === "/v1/app/devices" && req.method === "GET") {
        return handleListGrantedAppDevices(req, url);
      }

      if (url.pathname === "/v1/app/me" && req.method === "GET") {
        return handleGetAppIdentity(req);
      }

      const appDeviceKeyMatch = url.pathname.match(/^\/v1\/app\/devices\/([^/]+)\/public-key$/);
      if (appDeviceKeyMatch && req.method === "GET") {
        return handleGetAppDevicePublicKey(req, appDeviceKeyMatch[1]);
      }

      const apiKeyMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/api-keys$/);
      if (apiKeyMatch && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleCreateAppApiKey(req, apiKeyMatch[1]);
      }
      if (apiKeyMatch && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleListAppApiKeys(apiKeyMatch[1], url);
      }

      const apiKeyRevokeMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/api-keys\/([^/]+)\/revoke$/);
      if (apiKeyRevokeMatch && req.method === "POST") {
        const rejected = requireAdmin(req);
        if (rejected) return rejected;
        return handleRevokeAppApiKey(apiKeyRevokeMatch[1], apiKeyRevokeMatch[2]);
      }

      const appMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)$/);
      if (appMatch && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const app = apps.get(appMatch[1]);
        if (!app) return Response.json({ error: "not found" }, { status: 404 });
        const active_key = [...appKeys.values()].find(
          (key) => key.app_id === app.id && key.status === "active",
        );
        const appGrants = [...grants.values()].filter((grant) => grant.app_id === app.id).map(grantView);
        return Response.json({
          app: appView(app),
          active_key,
          api_keys: [...appApiKeys.values()].filter((key) => key.app_id === app.id).map(appApiKeyView),
          grants: appGrants,
          recent_messages: [...messages.values()].filter((item) => item.envelope.app_id === app.id).map(messageView).slice(-20).reverse(),
          recent_audit_events: auditEvents.filter((event) => event.app_id === app.id).slice(-50).reverse(),
        });
      }

      const deviceMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)$/);
      if (deviceMatch && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const user = optionalUserSession(req);
        const device = devices.get(deviceMatch[1]);
        if (!device) return Response.json({ error: "not found" }, { status: 404 });
        if (user && device.owner_user_id !== user.user_id) return Response.json({ error: "not found" }, { status: 404 });
        const active_key = [...deviceKeys.values()].find(
          (key) => key.device_id === device.id && key.status === "active",
        );
        return Response.json({
          device,
          active_key,
          capabilities: latestCapabilitiesFor(device.id),
          grants: [...grants.values()].filter((grant) => grant.device_id === device.id).map(grantView),
          recent_messages: [...messages.values()].filter((item) => item.envelope.device_id === device.id).map(messageView).slice(-20).reverse(),
          recent_audit_events: auditEvents.filter((event) => event.device_id === device.id).slice(-50).reverse(),
          local_policy: {
            status: "not_reported",
            default_behavior: "deny by default",
            copy: "Cloud grants allow an app to ask. Local policy on this machine still decides whether the request can run.",
          },
        });
      }

      if (url.pathname === "/v1/messages" && req.method === "POST") {
        return handleCreateMessage(req);
      }

      if (url.pathname === "/v1/messages" && req.method === "GET") {
        return listMessages(req, url);
      }

      const cancelMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/cancel$/);
      if (cancelMatch && req.method === "POST") {
        return handleCancelMessage(req, cancelMatch[1]);
      }

      const eventsMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/events$/);
      if (eventsMatch && req.method === "GET") {
        return handleMessageEvents(req, eventsMatch[1], url);
      }

      const messageMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
      if (messageMatch && req.method === "GET") {
        const auth = readBearer(req) ? authenticateAppRequest(req) : undefined;
        if (auth instanceof Response) return auth;
        const item = messages.get(messageMatch[1]);
        if (!item) return Response.json({ error: "not found" }, { status: 404 });
        const denied = canReadMessage(auth, item);
        if (denied) return Response.json({ error: denied }, { status: denied === "not found" ? 404 : 403 });
        return Response.json({
          message_id: item.envelope.message_id,
          status: item.status,
          history: item.history,
          result: item.result,
          result_events: item.result_events,
          message: messageView(item),
          status_events: messageStatusEvents.filter((event) => event.message_id === item.envelope.message_id),
          audit_events: auditEvents.filter((event) => event.message_id === item.envelope.message_id),
          crypto: messageView(item).crypto,
        });
      }

      if (url.pathname === "/v1/audit-events" && req.method === "GET") {
        return listAuditEvents(url, req);
      }

      if (url.pathname === "/v1/device-plugin-capabilities" && req.method === "GET") {
        const deviceId = url.searchParams.get("device_id");
        const user = optionalUserSession(req);
        const rows = capabilities
          .filter((capability) => !deviceId || capability.device_id === deviceId)
          .filter((capability) => !user || devices.get(capability.device_id)?.owner_user_id === user.user_id)
          .sort((a, b) => `${b.reported_at}:${b.id}`.localeCompare(`${a.reported_at}:${a.id}`));
        const { page, next_cursor, limit } = paginate(rows, url);
        return Response.json({ capabilities: page, next_cursor, limit });
      }

      return Response.json({ ok: true, service: "musubi-relay", device_online: !!deviceSocket });
      } catch (error) {
        console.error("[relay] request failed", { path: url.pathname, error });
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    },
    websocket: {
      open(ws) {
        deviceSocket = ws;
        const device = devices.get(ws.data.deviceId);
        if (device) {
          device.status = "online";
          device.last_seen_at = new Date().toISOString();
          audit("device", device.id, "device.connected", {
            workspace_id: device.workspace_id,
            device_id: device.id,
          });
        }
        console.log("[relay] device connected", { device_id: ws.data.deviceId });
        setTimeout(() => {
          if (deviceSocket !== ws) return;
          for (const item of messages.values()) {
            if (item.envelope.device_id === ws.data.deviceId && item.status === "queued" && !isExpired(item.envelope)) {
              ws.send(JSON.stringify(item.envelope));
              transition(item.envelope.message_id, "delivered");
            }
          }
        }, 25);
      },
      message(_ws, raw) {
        const parsed = JSON.parse(String(raw)) as ResultEnvelope | DeviceStatusUpdate;
        if ("type" in parsed && parsed.type === "device.status") {
          transition(parsed.message_id, parsed.status);
          return;
        }

        const result = parsed as ResultEnvelope;
        console.log("[relay] received encrypted result", visibleEnvelopeLog(result));
        const item = messages.get(result.message_id);
        if (!item) return;
        if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") return;
        item.result = result;
        item.result_events.push(result);
        transition(result.message_id, result.status);
      },
      close(ws) {
        if (deviceSocket === ws) deviceSocket = undefined;
        const device = devices.get(ws.data.deviceId);
        if (device) {
          if (device.status !== "revoked") device.status = "offline";
          device.last_seen_at = new Date().toISOString();
          audit("device", device.id, "device.disconnected", {
            workspace_id: device.workspace_id,
            device_id: device.id,
          });
        }
        console.log("[relay] device disconnected", { device_id: ws.data.deviceId });
      },
    },
  });

  console.log("[relay] listening", { url: `http://${server.hostname}:${server.port}` });
  return server;
}

if (import.meta.main) {
  startRelay();
}

function loadRelayState(path?: string): RelayStateSnapshot {
  if (!path || !existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as RelayStateSnapshot;
}
