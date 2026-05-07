import {
  IDS,
  type MessageEnvelope,
  type MessageState,
  type DeviceStatusUpdate,
  type ResultEnvelope,
  allowedChannels,
  visibleEnvelopeLog,
} from "../../../packages/protocol/src/index.ts";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

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
  created_at: string;
  completed_at?: string;
  expires_at?: string;
  grant_id?: string;
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

export function startRelay(options: { hostname?: string; port?: number } = {}) {
  const messages = new Map<string, StoredMessage>();
  const devices = new Map<string, DeviceRecord>();
  const deviceKeys = new Map<string, DeviceKeyRecord>();
  const apps = new Map<string, AppRecord>();
  const appKeys = new Map<string, AppKeyRecord>();
  const appApiKeys = new Map<string, AppApiKeyRecord>();
  const grants = new Map<string, GrantRecord>();
  const capabilities: DevicePluginCapabilityRecord[] = [];
  const developers = new Map<string, DeveloperRecord>();
  const publishers = new Map<string, PublisherRecord>();
  const permissionDeclarations: PermissionDeclarationRecord[] = [];
  const consentRequests = new Map<string, ConsentRequestRecord>();
  const abuseReports: AppAbuseReportRecord[] = [];
  const pluginInstallReports: DevicePluginCapabilityRecord[] = [];
  const auditEvents: AuditEventRecord[] = [];
  const messageStatusEvents: MessageStatusEventRecord[] = [];
  const pluginSigningKey = generateKeyPairSync("ed25519");
  const pluginSigningKeyId = "pluginkey_musubi_local";
  const workspacePluginPolicy: WorkspacePluginPolicyRecord = {
    require_signature: true,
    allowed_trust_levels: ["official", "verified"],
    allowed_plugins: ["echo", "hermes", "codex"],
    blocked_plugins: [],
    require_approval_for_permission_increase: true,
  };
  let deviceSocket: DeviceSocket | undefined;

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

  function readBearer(req: Request): string | undefined {
    const header = req.headers.get("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
  }

  function authenticateAppRequest(req: Request): { app: AppRecord; apiKey: AppApiKeyRecord } | Response {
    const secret = readBearer(req);
    if (!secret) return Response.json({ error: "missing app api key" }, { status: 401 });
    const keyHash = hashAppApiKey(secret);
    const apiKey = [...appApiKeys.values()].find((key) => key.key_hash === keyHash);
    if (!apiKey || apiKey.status !== "active") {
      return Response.json({ error: "invalid app api key" }, { status: 401 });
    }
    const app = apps.get(apiKey.app_id);
    if (!app || app.status !== "active") return Response.json({ error: "app denied" }, { status: 403 });
    apiKey.last_used_at = new Date().toISOString();
    return { app, apiKey };
  }

  function rejectAppApiKeyOnControlPlane(req: Request): Response | undefined {
    if (!readBearer(req)) return undefined;
    return Response.json({ error: "app api keys cannot manage control plane resources" }, { status: 403 });
  }

  function checkGrant(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const denied = grantDenied(workspaceId, appId, deviceId, channel);
    return denied;
  }

  function grantDenied(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const app = apps.get(appId);
    if (!app || app.status !== "active") return app?.status === "suspended" ? "app suspended" : "app denied";
    if (app.trust_status === "blocked") return "app blocked";
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

  function declaresChannel(appId: string, channel: string) {
    const appDeclarations = permissionDeclarations.filter((declaration) => declaration.app_id === appId);
    if (appDeclarations.length === 0) return false;
    return appDeclarations.some((declaration) => declaration.channels.includes(channel));
  }

  function publisherView(publisherId?: string) {
    return publisherId ? publishers.get(publisherId) : undefined;
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
    if (appAuth && envelope.app_id !== appAuth.app.id) {
      return Response.json({ message_id: envelope.message_id, status: "failed", error: "app id mismatch" }, { status: 403 });
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

  function handleListAppApiKeys(appId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      api_keys: [...appApiKeys.values()]
        .filter((key) => key.app_id === appId)
        .map(appApiKeyView)
        .sort((a, b) => a.id.localeCompare(b.id)),
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
    };
    const suffix = String(devices.size + 1).padStart(3, "0");
    const deviceId = `dev_${suffix}`;
    const keyId = `devkey_${suffix}`;
    const now = new Date().toISOString();
    const device: DeviceRecord = {
      id: deviceId,
      workspace_id: body.workspace_id ?? "ws_local",
      owner_user_id: "user_local",
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
    audit("user", "user_local", "device.registered", {
      workspace_id: body.workspace_id ?? "ws_local",
      device_id: deviceId,
      metadata: { device_key_id: keyId, platform: body.platform },
    });
    console.log("[relay] device registered", {
      device_id: deviceId,
      device_key_id: keyId,
      workspace_id: body.workspace_id ?? "ws_local",
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
      public_key: string;
      publisher_id?: string;
      description?: string;
      website?: string;
      privacy_policy_url?: string;
      terms_url?: string;
    };
    const suffix = String(apps.size + 1).padStart(3, "0");
    const appId = `app_${suffix}`;
    const keyId = `appkey_${suffix}`;
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
    const key: AppKeyRecord = {
      id: keyId,
      app_id: appId,
      public_key: body.public_key,
      status: "active",
      created_at: now,
    };
    apps.set(appId, app);
    appKeys.set(keyId, key);
    audit("user", "user_local", "app.created", {
      workspace_id: app.workspace_id,
      app_id: appId,
      metadata: { app_key_id: keyId, type: app.type },
    });
    console.log("[relay] app created", {
      app_id: appId,
      app_key_id: keyId,
      workspace_id: app.workspace_id,
      public_key_bytes: body.public_key.length,
    });
    return Response.json({ app_id: appId, app_key_id: keyId, status: app.status });
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

  async function handleCreateDeveloperApp(req: Request): Promise<Response> {
    const response = await handleCreateApp(req);
    if (!response.ok) return response;
    const body = await response.json();
    const apiKeyResponse = await handleCreateAppApiKey(new Request("http://local", {
      method: "POST",
      body: JSON.stringify({ name: "Developer backend key" }),
      headers: { "Content-Type": "application/json" },
    }), body.app_id);
    const apiKeyBody = await apiKeyResponse.json();
    return Response.json({ ...body, api_key: apiKeyBody.api_key, api_key_record: apiKeyBody.key });
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
    return Response.json({ declaration });
  }

  async function handleCreateConsentRequest(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { app_id?: string; state?: string; redirect_uri?: string };
    const app = body.app_id ? apps.get(body.app_id) : undefined;
    if (!app || app.type !== "third_party" || app.status !== "active") return Response.json({ error: "third-party app denied" }, { status: 400 });
    const requested = permissionDeclarations
      .filter((item) => item.app_id === app.id)
      .map((item) => ({ plugin: item.plugin_name, channels: item.channels, reason: item.reason }));
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
    return Response.json({ consent_request: consent });
  }

  async function handleApproveConsent(req: Request, consentId: string): Promise<Response> {
    const consent = consentRequests.get(consentId);
    if (!consent || consent.status !== "pending") return Response.json({ error: "consent not pending" }, { status: 404 });
    const app = apps.get(consent.app_id);
    if (!app) return Response.json({ error: "app not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { device_id?: string; allowed_channels?: string[]; queueing_allowed?: boolean };
    const channels = body.allowed_channels ?? [];
    const declared = new Set(permissionDeclarations.filter((item) => item.app_id === app.id).flatMap((item) => item.channels));
    const undeclared = channels.filter((channel) => !declared.has(channel));
    if (!body.device_id || channels.length === 0) return Response.json({ error: "device_id and allowed_channels required" }, { status: 400 });
    if (undeclared.length) return Response.json({ error: `undeclared channels: ${undeclared.join(", ")}` }, { status: 400 });
    const grantResponse = await handleCreateGrant(new Request("http://local", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: app.workspace_id,
        app_id: app.id,
        device_id: body.device_id,
        allowed_channels: channels,
        queueing_allowed: body.queueing_allowed ?? false,
        name: "Third-party consent grant",
      }),
      headers: { "Content-Type": "application/json" },
    }));
    if (!grantResponse.ok) return grantResponse;
    const grantBody = await grantResponse.json();
    consent.status = "approved";
    consent.completed_at = new Date().toISOString();
    consent.grant_id = grantBody.grant_id;
    audit("user", "user_local", "consent.approved", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      device_id: body.device_id,
      metadata: { consent_id: consent.id, grant_id: consent.grant_id, channels },
    });
    return Response.json({ consent_request: consent, grant: grantBody.grant });
  }

  async function handleCreateGrant(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      allowed_channels: string[];
      queueing_allowed?: boolean;
      name?: string;
      description?: string;
    };
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    grants.set(grantId, grant);
    audit("user", "user_local", "grant.created", {
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
    if (auth && item.envelope.app_id !== auth.app.id) return Response.json({ error: "not found" }, { status: 404 });
    if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
      return Response.json({ message_id: messageId, status: item.status, error: "message already terminal" }, { status: 409 });
    }
    transition(messageId, "cancel_requested");
    transition(messageId, "cancelled");
    return Response.json({ message_id: messageId, status: "cancelled" });
  }

  function paginate<T>(items: T[], url: URL) {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50), 100));
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
    const page = items.slice(cursor, cursor + limit);
    const next_cursor = cursor + limit < items.length ? String(cursor + limit) : null;
    return { page, next_cursor };
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
    let rows = [...messages.values()].map(messageView).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (auth) rows = rows.filter((row) => row.app_id === auth.app.id);
    for (const field of ["app_id", "device_id", "channel", "status"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((row) => row[field] === value);
    }
    const { page, next_cursor } = paginate(rows, url);
    return Response.json({ messages: page, next_cursor });
  }

  function listAuditEvents(url: URL) {
    let rows = [...auditEvents].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const field of ["event_type", "app_id", "device_id", "message_id", "actor_id"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((row) => row[field] === value);
    }
    const { page, next_cursor } = paginate(rows, url);
    return Response.json({ audit_events: page, next_cursor });
  }

  function supportedChannelWarning(deviceId: string, requestedChannels: string[]) {
    const reported = new Set(latestCapabilitiesFor(deviceId).flatMap((capability) => capability.channels));
    if (reported.size === 0) return "device has not reported capabilities yet";
    const unsupported = requestedChannels.filter((channel) => !reported.has(channel));
    return unsupported.length > 0 ? `channels not reported by device capabilities: ${unsupported.join(", ")}` : undefined;
  }

  async function handleUpdateGrant(req: Request, grantId: string): Promise<Response> {
    const grant = grants.get(grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    if (grant.revoked_at) return Response.json({ error: "grant revoked" }, { status: 409 });
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
    audit("user", "user_local", "grant.updated", {
      workspace_id: grant.workspace_id,
      app_id: grant.app_id,
      device_id: grant.device_id,
      metadata: { grant_id: grant.id, allowed_channels: grant.allowed_channels },
    });
    return Response.json({ grant: grantView(grant), warning: supportedChannelWarning(grant.device_id, grant.allowed_channels) });
  }

  function handleRevokeGrant(grantId: string): Response {
    const grant = grants.get(grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    grant.revoked_at = new Date().toISOString();
    grant.revoked_by = "user_local";
    grant.updated_at = grant.revoked_at;
    audit("user", "user_local", "grant.revoked", {
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
    return Response.json({ app_id: app.id, status: app.status });
  }

  function handleRevokeDevice(deviceId: string): Response {
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    device.status = "revoked";
    device.revoked_at = new Date().toISOString();
    device.revoked_by = "user_local";
    device.last_seen_at = device.revoked_at;
    for (const key of deviceKeys.values()) {
      if (key.device_id === deviceId && key.status === "active") key.status = "revoked";
    }
    if (deviceSocket?.data.deviceId === deviceId) {
      deviceSocket.close(4001, "device revoked");
      deviceSocket = undefined;
    }
    audit("user", "user_local", "device.revoked", {
      workspace_id: device.workspace_id,
      device_id: device.id,
      metadata: { device_id: device.id },
    });
    return Response.json({ device_id: device.id, status: device.status });
  }

  async function handleReportApp(req: Request, appId: string): Promise<Response> {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reason?: string; description?: string };
    const report: AppAbuseReportRecord = {
      id: `report_${String(abuseReports.length + 1).padStart(3, "0")}`,
      app_id: appId,
      reporter_user_id: "user_local",
      reason: body.reason || "other",
      description: body.description,
      status: "open",
      created_at: new Date().toISOString(),
    };
    abuseReports.push(report);
    audit("user", "user_local", "app.reported", { workspace_id: app.workspace_id, app_id: app.id, metadata: { report_id: report.id, reason: report.reason } });
    return Response.json({ report });
  }

  function handleSuspendApp(appId: string): Response {
    const app = apps.get(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    app.status = "suspended";
    app.disabled_at = new Date().toISOString();
    app.disabled_by = "admin_local";
    audit("admin", "admin_local", "app.suspended", { workspace_id: app.workspace_id, app_id: app.id, metadata: { app_id: app.id } });
    return Response.json({ app: appView(app) });
  }

  function listAuthorizedApps(): Response {
    const rows = [...apps.values()]
      .filter((app) => app.type === "third_party")
      .map((app) => ({
        app: appView(app),
        grants: [...grants.values()].filter((grant) => grant.app_id === app.id).map(grantView),
        reports: abuseReports.filter((report) => report.app_id === app.id),
      }));
    return Response.json({ authorized_apps: rows });
  }

  function handleListGrantedAppDevices(req: Request): Response {
    const auth = authenticateAppRequest(req);
    if (auth instanceof Response) return auth;
    const rows = [...grants.values()]
      .filter((grant) => grant.app_id === auth.app.id && !grant.revoked_at)
      .map((grant) => {
        const device = devices.get(grant.device_id);
        return device ? {
          id: device.id,
          name: device.display_name ?? device.name,
          status: device.status,
          platform: device.platform,
          workspace_id: device.workspace_id,
          allowed_channels: grant.allowed_channels,
          queueing_allowed: grant.queueing_allowed,
          last_seen_at: device.last_seen_at,
          last_capability_report_at: device.last_capability_report_at,
        } : undefined;
      })
      .filter(Boolean);
    return Response.json({ devices: rows });
  }

  function handleGetAppDevicePublicKey(req: Request, deviceId: string): Response {
    const auth = authenticateAppRequest(req);
    if (auth instanceof Response) return auth;
    const device = devices.get(deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const grant = [...grants.values()].find((item) => item.app_id === auth.app.id && item.device_id === deviceId && !item.revoked_at);
    if (!grant) return Response.json({ error: "grant denied" }, { status: 403 });
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
    if (auth && item.envelope.app_id !== auth.app.id) return Response.json({ error: "not found" }, { status: 404 });
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

      if (url.pathname === "/" && req.method === "GET") {
        return Response.redirect(`${url.origin}/control-plane`, 302);
      }

      if (url.pathname === "/control-plane" || url.pathname.startsWith("/control-plane/")) {
        return serveControlPlane(url.pathname);
      }

      const connectMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/connect$/);
      if (connectMatch) {
        return handleDeviceConnect(req, server, connectMatch[1]);
      }

      if (url.pathname === "/v1/devices" && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        let rows = [...devices.values()]
          .filter((device) => !url.searchParams.get("workspace_id") || device.workspace_id === url.searchParams.get("workspace_id"))
          .filter((device) => !url.searchParams.get("status") || device.status === url.searchParams.get("status"))
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
        const { page, next_cursor } = paginate(rows, url);
        return Response.json({ devices: page, next_cursor });
      }

      if (url.pathname === "/v1/devices/register" && req.method === "POST") {
        return handleRegisterDevice(req);
      }

      if (url.pathname === "/v1/apps" && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        const rows = [...apps.values()].map((app) => {
          const activeGrants = [...grants.values()].filter((grant) => grant.app_id === app.id && !grant.revoked_at);
          return {
            id: app.id,
            name: app.name,
            type: app.type,
            status: app.status,
            publisher: publisherView(app.publisher_id),
            trust_status: app.trust_status,
            review_status: app.review_status,
            authorized_device_count: new Set(activeGrants.map((grant) => grant.device_id)).size,
            allowed_channel_count: new Set(activeGrants.flatMap((grant) => grant.allowed_channels)).size,
            created_at: app.created_at,
          };
        }).sort((a, b) => a.id.localeCompare(b.id));
        const { page, next_cursor } = paginate(rows, url);
        return Response.json({ apps: page, next_cursor });
      }

      if (url.pathname === "/v1/apps" && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleCreateApp(req);
      }

      if (url.pathname === "/v1/developers" && req.method === "POST") {
        return handleCreateDeveloper(req);
      }

      if (url.pathname === "/v1/publishers" && req.method === "POST") {
        return handleCreatePublisher(req);
      }

      if (url.pathname === "/v1/developer/apps" && req.method === "POST") {
        return handleCreateDeveloperApp(req);
      }

      const declarationMatch = url.pathname.match(/^\/v1\/developer\/apps\/([^/]+)\/permission-declarations$/);
      if (declarationMatch && req.method === "POST") {
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
        return Response.json({
          consent_request: consent,
          app: app ? appView(app) : undefined,
          devices: [...devices.values()].filter((device) => device.status !== "revoked"),
          capabilities,
        });
      }

      const consentApproveMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)\/approve$/);
      if (consentApproveMatch && req.method === "POST") {
        return handleApproveConsent(req, consentApproveMatch[1]);
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
        return handleRevokeGrant(grantRevokeMatch[1]);
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
        let rows = [...grants.values()].map(grantView).sort((a, b) => a.id.localeCompare(b.id));
        for (const field of ["app_id", "device_id", "workspace_id"] as const) {
          const value = url.searchParams.get(field);
          if (value) rows = rows.filter((row) => row[field] === value);
        }
        const { page, next_cursor } = paginate(rows, url);
        return Response.json({ grants: page, next_cursor });
      }

      const appRevokeMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/revoke$/);
      if (appRevokeMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleRevokeApp(appRevokeMatch[1]);
      }

      const appReportMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/report$/);
      if (appReportMatch && req.method === "POST") {
        return handleReportApp(req, appReportMatch[1]);
      }

      const appSuspendMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/suspend$/);
      if (appSuspendMatch && req.method === "POST") {
        return handleSuspendApp(appSuspendMatch[1]);
      }

      if (url.pathname === "/v1/authorized-apps" && req.method === "GET") {
        return listAuthorizedApps();
      }

      if (url.pathname === "/v1/plugins" && req.method === "GET") {
        return Response.json({ plugins: ["echo", "hermes", "codex", "community-signed", "community-unsigned"].map((name) => registryPluginResponse(name)?.plugin).filter(Boolean) });
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
        return handleRevokeDevice(deviceRevokeMatch[1]);
      }

      if (url.pathname === "/v1/app/devices" && req.method === "GET") {
        return handleListGrantedAppDevices(req);
      }

      const appDeviceKeyMatch = url.pathname.match(/^\/v1\/app\/devices\/([^/]+)\/public-key$/);
      if (appDeviceKeyMatch && req.method === "GET") {
        return handleGetAppDevicePublicKey(req, appDeviceKeyMatch[1]);
      }

      const apiKeyMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/api-keys$/);
      if (apiKeyMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleCreateAppApiKey(req, apiKeyMatch[1]);
      }
      if (apiKeyMatch && req.method === "GET") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
        if (rejected) return rejected;
        return handleListAppApiKeys(apiKeyMatch[1]);
      }

      const apiKeyRevokeMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/api-keys\/([^/]+)\/revoke$/);
      if (apiKeyRevokeMatch && req.method === "POST") {
        const rejected = rejectAppApiKeyOnControlPlane(req);
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
        const device = devices.get(deviceMatch[1]);
        if (!device) return Response.json({ error: "not found" }, { status: 404 });
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
        if (auth && item.envelope.app_id !== auth.app.id) return Response.json({ error: "not found" }, { status: 404 });
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
        return listAuditEvents(url);
      }

      if (url.pathname === "/v1/device-plugin-capabilities" && req.method === "GET") {
        return Response.json({ capabilities });
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
