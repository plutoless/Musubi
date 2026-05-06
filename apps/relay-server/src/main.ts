import {
  IDS,
  type MessageEnvelope,
  type MessageState,
  type DeviceStatusUpdate,
  type ResultEnvelope,
  allowedChannels,
  visibleEnvelopeLog,
} from "../../../packages/protocol/src/index.ts";

type DeviceSocket = ServerWebSocket<{ deviceId: string }>;

interface StoredMessage {
  envelope: MessageEnvelope;
  status: MessageState;
  result?: ResultEnvelope;
  history: MessageState[];
}

interface DeviceRecord {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  platform: string;
  cli_version: string;
  status: "offline" | "online";
  created_at: string;
  last_seen_at?: string;
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
  type: "first_party" | "user_owned";
  status: "active" | "revoked";
  created_at: string;
}

interface AppKeyRecord {
  id: string;
  app_id: string;
  public_key: string;
  status: "active" | "retired" | "revoked";
  created_at: string;
}

interface GrantRecord {
  id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  allowed_channels: string[];
  queueing_allowed: boolean;
  created_at: string;
  revoked_at?: string;
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

export function startRelay(options: { hostname?: string; port?: number } = {}) {
  const messages = new Map<string, StoredMessage>();
  const devices = new Map<string, DeviceRecord>();
  const deviceKeys = new Map<string, DeviceKeyRecord>();
  const apps = new Map<string, AppRecord>();
  const appKeys = new Map<string, AppKeyRecord>();
  const grants = new Map<string, GrantRecord>();
  const capabilities: DevicePluginCapabilityRecord[] = [];
  const auditEvents: AuditEventRecord[] = [];
  let deviceSocket: DeviceSocket | undefined;

  function transition(messageId: string, status: MessageState) {
    const item = messages.get(messageId);
    if (!item) return;
    item.status = status;
    item.history.push(status);
    audit("system", undefined, `message.${status}`, {
      workspace_id: item.envelope.workspace_id,
      app_id: item.envelope.app_id,
      device_id: item.envelope.device_id,
      message_id: messageId,
      channel: item.envelope.channel,
      metadata: { status, ciphertext_bytes: Buffer.byteLength(item.envelope.ciphertext, "utf8") },
    });
    console.log("[relay] status", { message_id: messageId, status });
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

  function checkGrant(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const denied = grantDenied(workspaceId, appId, deviceId, channel);
    return denied;
  }

  function grantDenied(workspaceId: string, appId: string, deviceId: string, channel: string): string | undefined {
    const app = apps.get(appId);
    if (!app || app.status !== "active") return "app denied";
    const device = devices.get(deviceId);
    if (!device) return "device denied";
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
    const envelope = (await req.json()) as MessageEnvelope;
    messages.set(envelope.message_id, {
      envelope,
      status: "created",
      history: ["created"],
    });
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
      transition(envelope.message_id, "expired");
      return Response.json({ message_id: envelope.message_id, status: "expired", error: "message expired" }, { status: 410 });
    }

    const denied = authorize(envelope);
    if (denied) {
      transition(envelope.message_id, "failed");
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
      transition(envelope.message_id, "failed");
      return Response.json(
        { message_id: envelope.message_id, status: "failed", error: "device offline" },
        { status: 409 },
      );
    }

    deviceSocket.send(JSON.stringify(envelope));
    transition(envelope.message_id, "delivered");
    return Response.json({ message_id: envelope.message_id, status: "delivered" });
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
      workspace_id: body.workspace_id,
      owner_user_id: "user_local",
      name: body.device_name,
      platform: body.platform,
      cli_version: body.cli_version,
      status: "offline",
      created_at: now,
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
      workspace_id: body.workspace_id,
      device_id: deviceId,
      metadata: { device_key_id: keyId, platform: body.platform },
    });
    console.log("[relay] device registered", {
      device_id: deviceId,
      device_key_id: keyId,
      workspace_id: body.workspace_id,
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
      type: "first_party" | "user_owned";
      public_key: string;
    };
    const suffix = String(apps.size + 1).padStart(3, "0");
    const appId = `app_${suffix}`;
    const keyId = `appkey_${suffix}`;
    const now = new Date().toISOString();
    const app: AppRecord = {
      id: appId,
      workspace_id: body.workspace_id,
      name: body.name,
      type: body.type ?? "first_party",
      status: "active",
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
      workspace_id: body.workspace_id,
      app_id: appId,
      metadata: { app_key_id: keyId, type: app.type },
    });
    console.log("[relay] app created", {
      app_id: appId,
      app_key_id: keyId,
      workspace_id: body.workspace_id,
      public_key_bytes: body.public_key.length,
    });
    return Response.json({ app_id: appId, app_key_id: keyId, status: app.status });
  }

  async function handleCreateGrant(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      allowed_channels: string[];
      queueing_allowed?: boolean;
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
      allowed_channels: body.allowed_channels,
      queueing_allowed: body.queueing_allowed ?? false,
      created_at: new Date().toISOString(),
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
    return Response.json({ grant_id: grantId, status: "active" });
  }

  function checkGrantPreconditions(workspaceId: string, appId: string, deviceId: string) {
    const app = apps.get(appId);
    if (!app || app.workspace_id !== workspaceId || app.status !== "active") return "app denied";
    const device = devices.get(deviceId);
    if (!device || device.workspace_id !== workspaceId) return "device denied";
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

  async function handleCancelMessage(messageId: string): Promise<Response> {
    const item = messages.get(messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
      return Response.json({ message_id: messageId, status: item.status, error: "message already terminal" }, { status: 409 });
    }
    transition(messageId, "cancel_requested");
    transition(messageId, "cancelled");
    return Response.json({ message_id: messageId, status: "cancelled" });
  }

  const server = Bun.serve({
    hostname: options.hostname ?? process.env.MUSUBI_RELAY_HOST ?? "127.0.0.1",
    port: options.port ?? Number(process.env.MUSUBI_RELAY_PORT ?? "8787"),
    fetch(req, server) {
      const url = new URL(req.url);

      const connectMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/connect$/);
      if (connectMatch) {
        return handleDeviceConnect(req, server, connectMatch[1]);
      }

      if (url.pathname === "/v1/devices/register" && req.method === "POST") {
        return handleRegisterDevice(req);
      }

      if (url.pathname === "/v1/apps" && req.method === "POST") {
        return handleCreateApp(req);
      }

      if (url.pathname === "/v1/grants" && req.method === "POST") {
        return handleCreateGrant(req);
      }

      if (url.pathname === "/v1/permissions/check" && req.method === "POST") {
        return handlePermissionCheck(req);
      }

      const capabilitiesMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/capabilities$/);
      if (capabilitiesMatch && req.method === "POST") {
        return handleReportCapabilities(req, capabilitiesMatch[1]);
      }

      const grantRevokeMatch = url.pathname.match(/^\/v1\/grants\/([^/]+)\/revoke$/);
      if (grantRevokeMatch && req.method === "POST") {
        const grant = grants.get(grantRevokeMatch[1]);
        if (!grant) return Response.json({ error: "not found" }, { status: 404 });
        grant.revoked_at = new Date().toISOString();
        audit("user", "user_local", "grant.revoked", {
          workspace_id: grant.workspace_id,
          app_id: grant.app_id,
          device_id: grant.device_id,
          metadata: { grant_id: grant.id },
        });
        console.log("[relay] grant revoked", { grant_id: grant.id });
        return Response.json({ grant_id: grant.id, status: "revoked" });
      }

      const appMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)$/);
      if (appMatch && req.method === "GET") {
        const app = apps.get(appMatch[1]);
        if (!app) return Response.json({ error: "not found" }, { status: 404 });
        const active_key = [...appKeys.values()].find(
          (key) => key.app_id === app.id && key.status === "active",
        );
        return Response.json({ app, active_key });
      }

      const deviceMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)$/);
      if (deviceMatch && req.method === "GET") {
        const device = devices.get(deviceMatch[1]);
        if (!device) return Response.json({ error: "not found" }, { status: 404 });
        const active_key = [...deviceKeys.values()].find(
          (key) => key.device_id === device.id && key.status === "active",
        );
        return Response.json({ device, active_key });
      }

      if (url.pathname === "/v1/messages" && req.method === "POST") {
        return handleCreateMessage(req);
      }

      const cancelMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/cancel$/);
      if (cancelMatch && req.method === "POST") {
        return handleCancelMessage(cancelMatch[1]);
      }

      const messageMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
      if (messageMatch && req.method === "GET") {
        const item = messages.get(messageMatch[1]);
        if (!item) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({
          message_id: item.envelope.message_id,
          status: item.status,
          history: item.history,
          result: item.result,
        });
      }

      if (url.pathname === "/v1/audit-events" && req.method === "GET") {
        const messageId = url.searchParams.get("message_id");
        const events = messageId
          ? auditEvents.filter((event) => event.message_id === messageId)
          : auditEvents;
        return Response.json({ audit_events: events });
      }

      if (url.pathname === "/v1/device-plugin-capabilities" && req.method === "GET") {
        return Response.json({ capabilities });
      }

      return Response.json({ ok: true, service: "musubi-relay", device_online: !!deviceSocket });
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
        item.result = result;
        transition(result.message_id, result.status);
      },
      close(ws) {
        if (deviceSocket === ws) deviceSocket = undefined;
        const device = devices.get(ws.data.deviceId);
        if (device) {
          device.status = "offline";
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
