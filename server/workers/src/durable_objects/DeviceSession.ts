import { neon } from "@neondatabase/serverless";
import type { Env } from "../index";

type MessageState =
  | "created"
  | "validated"
  | "queued"
  | "delivered"
  | "received"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "cancel_requested"
  | "cancelled";

interface MessageEnvelope {
  message_id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  channel: string;
  ciphertext: string;
  crypto?: unknown;
  created_at?: string;
  expires_at?: string;
  ttl_seconds?: number;
  visible_metadata?: Record<string, unknown>;
}

interface ResultEnvelope extends MessageEnvelope {
  status: MessageState;
}

interface DeviceStatusUpdate {
  type: "device.status";
  message_id: string;
  status: MessageState;
}

interface StoredMessage {
  envelope: MessageEnvelope;
  status: MessageState;
  history: MessageState[];
  result?: ResultEnvelope;
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

export class DeviceSession {
  private state: DurableObjectState;
  private env: Env;
  private deviceSocket?: WebSocket;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/internal/control/")) {
      return this.handleInternalControl(request, url);
    }

    if (url.pathname.startsWith("/internal/device/")) {
      return this.handleInternalDevice(request, url);
    }

    if (url.pathname === "/v1/devices/register" && request.method === "POST") {
      return this.handleRegisterDevice(request);
    }

    if (url.pathname === "/v1/apps" && request.method === "POST") {
      return this.handleCreateApp(request);
    }

    if (url.pathname === "/v1/grants" && request.method === "POST") {
      return this.handleCreateGrant(request);
    }

    if (url.pathname === "/v1/permissions/check" && request.method === "POST") {
      return this.handlePermissionCheck(request);
    }

    const capabilitiesMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/capabilities$/);
    if (capabilitiesMatch && request.method === "POST") {
      return this.handleReportCapabilities(request, capabilitiesMatch[1]);
    }

    const grantRevokeMatch = url.pathname.match(/^\/v1\/grants\/([^/]+)\/revoke$/);
    if (grantRevokeMatch && request.method === "POST") {
      return this.handleRevokeGrant(grantRevokeMatch[1]);
    }

    const appMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)$/);
    if (appMatch && request.method === "GET") {
      return this.handleGetApp(appMatch[1]);
    }

    const deviceMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)$/);
    if (deviceMatch && request.method === "GET") {
      return this.handleGetDevice(deviceMatch[1]);
    }

    if (url.pathname === "/v1/messages" && request.method === "POST") {
      return this.handleCreateMessage(request);
    }

    const cancelMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      return this.handleCancelMessage(cancelMatch[1]);
    }

    const messageMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
    if (messageMatch && request.method === "GET") {
      return this.handleGetMessage(messageMatch[1]);
    }

    if (url.pathname === "/v1/audit-events" && request.method === "GET") {
      return this.handleGetAuditEvents(url.searchParams.get("message_id"));
    }

    if (url.pathname === "/v1/device-plugin-capabilities" && request.method === "GET") {
      return Response.json({ capabilities: await this.list<DevicePluginCapabilityRecord>("device_plugin_capabilities") });
    }

    const connectMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/connect$/);
    if (connectMatch) {
      return this.handleDeviceConnect(request, connectMatch[1]);
    }

    return Response.json({
      ok: true,
      service: "musubi-device-session",
      neon_configured: Boolean(this.env.NEON_DATABASE_URL),
    });
  }

  private async handleRegisterDevice(request: Request): Promise<Response> {
    const body = await request.json() as {
      workspace_id: string;
      device_name: string;
      platform: string;
      cli_version: string;
      public_key: string;
      auth_public_key?: string;
    };
    const devices = await this.list<DeviceRecord>("devices");
    const suffix = String(devices.length + 1).padStart(3, "0");
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
    await this.putMapItem("devices", deviceId, device);
    await this.putMapItem("device_keys", keyId, key);
    await this.persistWorkspace(body.workspace_id);
    await this.persistUser({ id: "user_local", name: "Local User" });
    await this.persistDevice(device);
    await this.persistDeviceKey(key);
    await this.audit("user", "user_local", "device.registered", {
      workspace_id: body.workspace_id,
      device_id: deviceId,
      metadata: { device_key_id: keyId, platform: body.platform },
    });

    return Response.json({
      device_id: deviceId,
      device_key_id: keyId,
      relay_url: `${websocketOrigin(request.url)}/v1/devices/${deviceId}/connect`,
    });
  }

  private async handleCreateApp(request: Request): Promise<Response> {
    const body = await request.json() as {
      workspace_id: string;
      name: string;
      type?: "first_party" | "user_owned";
      public_key: string;
    };
    const apps = await this.list<AppRecord>("apps");
    const suffix = String(apps.length + 1).padStart(3, "0");
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
    await this.putMapItem("apps", appId, app);
    await this.putMapItem("app_keys", keyId, key);
    await this.persistWorkspace(body.workspace_id);
    await this.persistApp(app);
    await this.persistAppKey(key);
    await this.audit("user", "user_local", "app.created", {
      workspace_id: body.workspace_id,
      app_id: appId,
      metadata: { app_key_id: keyId, type: app.type },
    });
    return Response.json({ app_id: appId, app_key_id: keyId, status: app.status });
  }

  private async handleCreateGrant(request: Request): Promise<Response> {
    const body = await request.json() as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      allowed_channels: string[];
      queueing_allowed?: boolean;
    };
    const denied = await this.checkGrantPreconditions(body.workspace_id, body.app_id, body.device_id);
    if (denied) return Response.json({ status: "failed", error: denied }, { status: 400 });

    const grants = await this.list<GrantRecord>("grants");
    const suffix = String(grants.length + 1).padStart(3, "0");
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
    await this.putMapItem("grants", grantId, grant);
    await this.persistGrant(grant);
    await this.audit("user", "user_local", "grant.created", {
      workspace_id: body.workspace_id,
      app_id: body.app_id,
      device_id: body.device_id,
      metadata: { grant_id: grantId, allowed_channels: body.allowed_channels },
    });
    return Response.json({ grant_id: grantId, status: "active" });
  }

  private async handlePermissionCheck(request: Request): Promise<Response> {
    const body = await request.json() as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      channel: string;
    };
    const denied = await this.checkGrant(body.workspace_id, body.app_id, body.device_id, body.channel);
    return denied ? Response.json({ allowed: false, error: denied }) : Response.json({ allowed: true });
  }

  private async handleReportCapabilities(request: Request, deviceId: string): Promise<Response> {
    const device = await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const body = await request.json() as {
      plugins: Array<{
        name: string;
        version: string;
        channels: string[];
        permissions: string[];
        manifest?: Record<string, unknown>;
      }>;
    };
    const existing = await this.list<DevicePluginCapabilityRecord>("device_plugin_capabilities");
    const now = new Date().toISOString();
    for (const [index, plugin] of (body.plugins ?? []).entries()) {
      const id = `cap_${String(existing.length + index + 1).padStart(6, "0")}_${plugin.name}`;
      await this.putMapItem("device_plugin_capabilities", id, {
        id,
        workspace_id: device.workspace_id,
        device_id: deviceId,
        plugin_name: plugin.name,
        plugin_version: plugin.version,
        channels: plugin.channels,
        permissions: plugin.permissions,
        manifest: plugin.manifest ?? {},
        reported_at: now,
      });
      await this.persistCapability({
        id,
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
    await this.audit("device", deviceId, "device.capabilities_reported", {
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

  private async handleRevokeGrant(grantId: string): Promise<Response> {
    const grant = await this.getMapItem<GrantRecord>("grants", grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    grant.revoked_at = new Date().toISOString();
    await this.putMapItem("grants", grantId, grant);
    await this.persistGrant(grant);
    await this.audit("user", "user_local", "grant.revoked", {
      workspace_id: grant.workspace_id,
      app_id: grant.app_id,
      device_id: grant.device_id,
      metadata: { grant_id: grant.id },
    });
    return Response.json({ grant_id: grant.id, status: "revoked" });
  }

  private async handleGetApp(appId: string): Promise<Response> {
    const app = await this.getMapItem<AppRecord>("apps", appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const active_key = (await this.list<AppKeyRecord>("app_keys")).find(
      (key) => key.app_id === app.id && key.status === "active",
    );
    return Response.json({ app, active_key });
  }

  private async handleGetDevice(deviceId: string): Promise<Response> {
    const device = await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const status = await this.deviceStatus(deviceId);
    const active_key = (await this.list<DeviceKeyRecord>("device_keys")).find(
      (key) => key.device_id === device.id && key.status === "active",
    );
    return Response.json({ device: { ...device, status }, active_key });
  }

  private async handleCreateMessage(request: Request): Promise<Response> {
    const envelope = await request.json() as MessageEnvelope;
    const stored: StoredMessage = {
      envelope,
      status: "created",
      history: ["created"],
    };
    await this.putMapItem("messages", envelope.message_id, stored);
    await this.persistMessage(stored);
    await this.audit("app", envelope.app_id, "message.created", {
      workspace_id: envelope.workspace_id,
      app_id: envelope.app_id,
      device_id: envelope.device_id,
      message_id: envelope.message_id,
      channel: envelope.channel,
      metadata: { ciphertext_bytes: envelope.ciphertext.length },
    });

    if (this.isExpired(envelope)) {
      await this.transition(envelope.message_id, "expired");
      return Response.json({ message_id: envelope.message_id, status: "expired", error: "message expired" }, { status: 410 });
    }

    const denied = await this.checkGrant(
      envelope.workspace_id,
      envelope.app_id,
      envelope.device_id,
      envelope.channel,
    );
    if (denied) {
      await this.transition(envelope.message_id, "failed");
      return Response.json({ message_id: envelope.message_id, status: "failed", error: denied }, { status: 403 });
    }

    await this.transition(envelope.message_id, "validated");
    const delivered = await this.deliverToDevice(envelope.device_id, envelope);
    if (!delivered) {
      const grant = await this.activeGrantFor(envelope.workspace_id, envelope.app_id, envelope.device_id, envelope.channel);
      if (grant?.queueing_allowed) {
        await this.transition(envelope.message_id, "queued");
        return Response.json({ message_id: envelope.message_id, status: "queued" });
      }
      await this.transition(envelope.message_id, "failed");
      return Response.json({ message_id: envelope.message_id, status: "failed", error: "device offline" }, { status: 409 });
    }

    await this.transition(envelope.message_id, "delivered");
    return Response.json({ message_id: envelope.message_id, status: "delivered" });
  }

  private isExpired(envelope: MessageEnvelope): boolean {
    const now = Date.now();
    if (envelope.expires_at && Date.parse(envelope.expires_at) <= now) return true;
    if (!envelope.created_at || !envelope.ttl_seconds || envelope.ttl_seconds <= 0) return false;
    return Date.parse(envelope.created_at) + envelope.ttl_seconds * 1000 <= now;
  }

  private async handleGetMessage(messageId: string): Promise<Response> {
    const item = await this.getMapItem<StoredMessage>("messages", messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      message_id: item.envelope.message_id,
      status: item.status,
      history: item.history,
      result: item.result,
    });
  }

  private async handleCancelMessage(messageId: string): Promise<Response> {
    const item = await this.getMapItem<StoredMessage>("messages", messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
      return Response.json({ message_id: messageId, status: item.status, error: "message already terminal" }, { status: 409 });
    }
    await this.transition(messageId, "cancel_requested");
    await this.transition(messageId, "cancelled");
    return Response.json({ message_id: messageId, status: "cancelled" });
  }

  private async handleGetAuditEvents(messageId: string | null): Promise<Response> {
    const events = await this.list<AuditEventRecord>("audit_events");
    return Response.json({
      audit_events: messageId ? events.filter((event) => event.message_id === messageId) : events,
    });
  }

  private async handleDeviceConnect(request: Request, deviceId: string): Promise<Response> {
    const denied = await this.verifyDeviceConnection(request, deviceId);
    if (denied) return new Response(denied, { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.deviceSocket = server;
    server.accept();
    const connectedAt = new Date().toISOString();
    await this.state.storage.put("status", "online");
    await this.state.storage.put("connected_at", connectedAt);
    await this.controlFetch("/internal/control/device-status", {
      device_id: deviceId,
      status: "online",
      last_seen_at: connectedAt,
    });
    await this.controlFetch("/internal/control/audit", {
      actor_type: "device",
      actor_id: deviceId,
      event_type: "device.connected",
      workspace_id: await this.deviceWorkspace(deviceId),
      device_id: deviceId,
      metadata: {},
    });
    server.addEventListener("message", async (event) => {
      await this.state.storage.put("last_device_message_at", new Date().toISOString());
      await this.state.storage.put("last_device_message_bytes", String(event.data).length);
      await this.handleDeviceSocketMessage(deviceId, String(event.data));
    });

    server.addEventListener("close", async () => {
      if (this.deviceSocket === server) this.deviceSocket = undefined;
      const disconnectedAt = new Date().toISOString();
      await this.state.storage.put("status", "offline");
      await this.state.storage.put("disconnected_at", disconnectedAt);
      await this.controlFetch("/internal/control/device-status", {
        device_id: deviceId,
        status: "offline",
        last_seen_at: disconnectedAt,
      });
      await this.controlFetch("/internal/control/audit", {
        actor_type: "device",
        actor_id: deviceId,
        event_type: "device.disconnected",
        workspace_id: await this.deviceWorkspace(deviceId),
        device_id: deviceId,
        metadata: {},
      });
    });

    setTimeout(() => {
      this.deliverQueuedMessages(server, deviceId).catch((error) => {
        console.error("failed to drain queued messages", error);
      });
    }, 25);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async deliverQueuedMessages(server: WebSocket, deviceId: string) {
    if (this.deviceSocket !== server) return;
    const queued = await this.controlFetch("/internal/control/queued", { device_id: deviceId });
    const queuedBody = await queued.json() as { messages?: MessageEnvelope[] };
    for (const envelope of queuedBody.messages ?? []) {
      if (this.deviceSocket !== server) return;
      server.send(JSON.stringify(envelope));
      await this.controlFetch("/internal/control/status", {
        type: "device.status",
        message_id: envelope.message_id,
        status: "delivered",
      });
    }
  }

  private async handleInternalDevice(request: Request, url: URL): Promise<Response> {
    if (url.pathname === "/internal/device/status") {
      return Response.json({ status: await this.state.storage.get("status") ?? "offline" });
    }

    if (url.pathname === "/internal/device/deliver" && request.method === "POST") {
      if (!this.deviceSocket) return Response.json({ delivered: false });
      const envelope = await request.json() as MessageEnvelope;
      this.deviceSocket.send(JSON.stringify(envelope));
      return Response.json({ delivered: true });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async handleInternalControl(request: Request, url: URL): Promise<Response> {
    const activeKeyMatch = url.pathname.match(/^\/internal\/control\/devices\/([^/]+)\/active-key$/);
    if (activeKeyMatch) {
      const active_key = (await this.list<DeviceKeyRecord>("device_keys")).find(
        (key) => key.device_id === activeKeyMatch[1] && key.status === "active",
      );
      return active_key ? Response.json({ active_key }) : Response.json({ error: "not found" }, { status: 404 });
    }

    const workspaceMatch = url.pathname.match(/^\/internal\/control\/devices\/([^/]+)\/workspace$/);
    if (workspaceMatch) {
      const device = await this.getMapItem<DeviceRecord>("devices", workspaceMatch[1]);
      return Response.json({ workspace_id: device?.workspace_id ?? "ws_unknown" });
    }

    if (url.pathname === "/internal/control/status" && request.method === "POST") {
      const body = await request.json() as DeviceStatusUpdate;
      await this.transition(body.message_id, body.status);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/internal/control/queued" && request.method === "POST") {
      const body = await request.json() as { device_id: string };
      const queued = (await this.list<StoredMessage>("messages"))
        .filter((item) => item.envelope.device_id === body.device_id && item.status === "queued" && !this.isExpired(item.envelope))
        .map((item) => item.envelope);
      return Response.json({ messages: queued });
    }

    if (url.pathname === "/internal/control/result" && request.method === "POST") {
      const result = await request.json() as ResultEnvelope;
      const item = await this.getMapItem<StoredMessage>("messages", result.message_id);
      if (item) {
        if (isTerminalMessageState(result.status)) {
          item.result = result;
          await this.putMapItem("messages", result.message_id, item);
          await this.persistMessage(item);
        }
        await this.transition(result.message_id, result.status);
      }
      return Response.json({ ok: true });
    }

    if (url.pathname === "/internal/control/device-status" && request.method === "POST") {
      const body = await request.json() as {
        device_id: string;
        status: "offline" | "online";
        last_seen_at: string;
      };
      const device = await this.getMapItem<DeviceRecord>("devices", body.device_id);
      if (!device) return Response.json({ error: "not found" }, { status: 404 });
      device.status = body.status;
      device.last_seen_at = body.last_seen_at;
      await this.putMapItem("devices", body.device_id, device);
      await this.persistDevice(device);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/internal/control/audit" && request.method === "POST") {
      const body = await request.json() as {
        actor_type: string;
        actor_id?: string;
        event_type: string;
        workspace_id: string;
        app_id?: string;
        device_id?: string;
        message_id?: string;
        channel?: string;
        metadata?: Record<string, unknown>;
      };
      await this.audit(body.actor_type, body.actor_id, body.event_type, {
        workspace_id: body.workspace_id,
        app_id: body.app_id,
        device_id: body.device_id,
        message_id: body.message_id,
        channel: body.channel,
        metadata: body.metadata,
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async verifyDeviceConnection(request: Request, deviceId: string): Promise<string | undefined> {
    const activeKeyResp = await this.controlGet(`/internal/control/devices/${deviceId}/active-key`);
    if (!activeKeyResp.ok) return "unknown device";
    const { active_key } = await activeKeyResp.json() as { active_key: DeviceKeyRecord };
    if (!active_key.auth_public_key) return "missing active auth key";

    const url = new URL(request.url);
    const ts = url.searchParams.get("ts");
    const sig = url.searchParams.get("sig");
    if (!ts || !sig) return "missing signature";
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
      return "stale signature";
    }

    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(active_key.auth_public_key),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const canonical = `GET\n/v1/devices/${deviceId}/connect\n${ts}`;
    const ok = await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      base64ToBytes(sig),
      new TextEncoder().encode(canonical),
    );
    return ok ? undefined : "invalid signature";
  }

  private async handleDeviceSocketMessage(_deviceId: string, raw: string) {
    const parsed = JSON.parse(raw) as ResultEnvelope | DeviceStatusUpdate;
    if ("type" in parsed && parsed.type === "device.status") {
      await this.controlFetch("/internal/control/status", parsed);
      return;
    }
    await this.controlFetch("/internal/control/result", parsed);
  }

  private async transition(messageId: string, status: MessageState) {
    const item = await this.getMapItem<StoredMessage>("messages", messageId);
    if (!item) return;
    if (isTerminalMessageState(item.status) && item.status !== status) return;
    item.status = status;
    item.history.push(status);
    await this.putMapItem("messages", messageId, item);
    await this.persistMessage(item);
    await this.audit("system", undefined, `message.${status}`, {
      workspace_id: item.envelope.workspace_id,
      app_id: item.envelope.app_id,
      device_id: item.envelope.device_id,
      message_id: messageId,
      channel: item.envelope.channel,
      metadata: { status, ciphertext_bytes: item.envelope.ciphertext.length },
    });
  }

  private async checkGrant(workspaceId: string, appId: string, deviceId: string, channel: string): Promise<string | undefined> {
    const app = await this.getMapItem<AppRecord>("apps", appId);
    if (!app || app.status !== "active") return "app denied";
    const device = await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device) return "device denied";
    const activeGrant = (await this.list<GrantRecord>("grants")).find(
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

  private async activeGrantFor(workspaceId: string, appId: string, deviceId: string, channel: string): Promise<GrantRecord | undefined> {
    return (await this.list<GrantRecord>("grants")).find(
      (grant) =>
        grant.workspace_id === workspaceId &&
        grant.app_id === appId &&
        grant.device_id === deviceId &&
        !grant.revoked_at &&
        grant.allowed_channels.includes(channel),
    );
  }

  private async checkGrantPreconditions(workspaceId: string, appId: string, deviceId: string): Promise<string | undefined> {
    const app = await this.getMapItem<AppRecord>("apps", appId);
    if (!app || app.workspace_id !== workspaceId || app.status !== "active") return "app denied";
    const device = await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device || device.workspace_id !== workspaceId) return "device denied";
    return undefined;
  }

  private async deliverToDevice(deviceId: string, envelope: MessageEnvelope): Promise<boolean> {
    const id = this.env.DEVICE_SESSION.idFromName(deviceId);
    const response = await this.env.DEVICE_SESSION.get(id).fetch(jsonRequest("https://device.internal/internal/device/deliver", envelope));
    const body = await response.json() as { delivered: boolean };
    return Boolean(body.delivered);
  }

  private async deviceStatus(deviceId: string): Promise<"offline" | "online"> {
    const id = this.env.DEVICE_SESSION.idFromName(deviceId);
    const response = await this.env.DEVICE_SESSION.get(id).fetch("https://device.internal/internal/device/status");
    const body = await response.json() as { status?: "offline" | "online" };
    return body.status ?? "offline";
  }

  private async deviceWorkspace(deviceId: string): Promise<string> {
    const response = await this.controlGet(`/internal/control/devices/${deviceId}/workspace`);
    const body = await response.json() as { workspace_id: string };
    return body.workspace_id;
  }

  private controlGet(path: string): Promise<Response> {
    const id = this.env.DEVICE_SESSION.idFromName("__control");
    return this.env.DEVICE_SESSION.get(id).fetch(`https://control.internal${path}`);
  }

  private controlFetch(path: string, body: unknown): Promise<Response> {
    const id = this.env.DEVICE_SESSION.idFromName("__control");
    return this.env.DEVICE_SESSION.get(id).fetch(jsonRequest(`https://control.internal${path}`, body));
  }

  private async audit(
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
    const events = await this.list<AuditEventRecord>("audit_events");
    const event: AuditEventRecord = {
      id: `audit_${String(events.length + 1).padStart(6, "0")}`,
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
    };
    await this.putMapItem("audit_events", event.id, event);
    await this.persistAuditEvent(event);
  }

  private async persistMessage(item: StoredMessage) {
    const sql = this.neon();
    if (!sql) return;

    const envelope = item.envelope;
    await sql`
      insert into messages (
        id,
        workspace_id,
        app_id,
        device_id,
        channel,
        status,
        visible_metadata,
        ciphertext,
        ttl_seconds,
        created_at,
        updated_at,
        expires_at,
        error_code,
        error_message
      ) values (
        ${envelope.message_id},
        ${envelope.workspace_id},
        ${envelope.app_id},
        ${envelope.device_id},
        ${envelope.channel},
        ${item.status},
        ${JSON.stringify(envelope.visible_metadata ?? {})}::jsonb,
        ${envelope.ciphertext},
        ${envelope.ttl_seconds ?? 300},
        ${envelope.created_at ?? new Date().toISOString()},
        ${new Date().toISOString()},
        ${envelope.expires_at ?? null},
        ${null},
        ${null}
      )
      on conflict (id) do update set
        status = excluded.status,
        visible_metadata = excluded.visible_metadata,
        ciphertext = excluded.ciphertext,
        ttl_seconds = excluded.ttl_seconds,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        error_code = excluded.error_code,
        error_message = excluded.error_message
    `;
  }

  private async persistWorkspace(workspaceId: string) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into workspaces (id, name)
      values (${workspaceId}, ${workspaceId})
      on conflict (id) do nothing
    `;
  }

  private async persistUser(user: { id: string; name: string }) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into users (id, name)
      values (${user.id}, ${user.name})
      on conflict (id) do update set
        name = excluded.name
    `;
  }

  private async persistDevice(device: DeviceRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into devices (
        id,
        workspace_id,
        owner_user_id,
        name,
        platform,
        cli_version,
        status,
        last_seen_at,
        created_at,
        revoked_at
      ) values (
        ${device.id},
        ${device.workspace_id},
        ${device.owner_user_id},
        ${device.name},
        ${device.platform},
        ${device.cli_version},
        ${device.status},
        ${device.last_seen_at ?? null},
        ${device.created_at},
        ${null}
      )
      on conflict (id) do update set
        name = excluded.name,
        platform = excluded.platform,
        cli_version = excluded.cli_version,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistDeviceKey(key: DeviceKeyRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into device_keys (
        id,
        device_id,
        public_key,
        auth_public_key,
        status,
        created_at,
        retired_at,
        revoked_at
      ) values (
        ${key.id},
        ${key.device_id},
        ${key.public_key},
        ${key.auth_public_key ?? null},
        ${key.status},
        ${key.created_at},
        ${null},
        ${null}
      )
      on conflict (id) do update set
        public_key = excluded.public_key,
        auth_public_key = excluded.auth_public_key,
        status = excluded.status,
        retired_at = excluded.retired_at,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistApp(app: AppRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into apps (
        id,
        workspace_id,
        name,
        type,
        status,
        created_by,
        created_at,
        revoked_at
      ) values (
        ${app.id},
        ${app.workspace_id},
        ${app.name},
        ${app.type},
        ${app.status},
        ${null},
        ${app.created_at},
        ${null}
      )
      on conflict (id) do update set
        name = excluded.name,
        type = excluded.type,
        status = excluded.status,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistAppKey(key: AppKeyRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into app_keys (
        id,
        app_id,
        public_key,
        status,
        created_at,
        retired_at,
        revoked_at
      ) values (
        ${key.id},
        ${key.app_id},
        ${key.public_key},
        ${key.status},
        ${key.created_at},
        ${null},
        ${null}
      )
      on conflict (id) do update set
        public_key = excluded.public_key,
        status = excluded.status,
        retired_at = excluded.retired_at,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistGrant(grant: GrantRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into app_device_channel_grants (
        id,
        workspace_id,
        app_id,
        device_id,
        allowed_channels,
        queueing_allowed,
        created_by,
        created_at,
        revoked_at
      ) values (
        ${grant.id},
        ${grant.workspace_id},
        ${grant.app_id},
        ${grant.device_id},
        ${grant.allowed_channels},
        ${grant.queueing_allowed},
        ${null},
        ${grant.created_at},
        ${grant.revoked_at ?? null}
      )
      on conflict (id) do update set
        allowed_channels = excluded.allowed_channels,
        queueing_allowed = excluded.queueing_allowed,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistAuditEvent(event: AuditEventRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into audit_events (
        id,
        workspace_id,
        actor_type,
        actor_id,
        event_type,
        app_id,
        device_id,
        message_id,
        channel,
        metadata,
        created_at
      ) values (
        ${event.id},
        ${event.workspace_id},
        ${event.actor_type},
        ${event.actor_id ?? null},
        ${event.event_type},
        ${event.app_id ?? null},
        ${event.device_id ?? null},
        ${event.message_id ?? null},
        ${event.channel ?? null},
        ${JSON.stringify(event.metadata)}::jsonb,
        ${event.created_at}
      )
      on conflict (id) do nothing
    `;
  }

  private async persistCapability(capability: DevicePluginCapabilityRecord) {
    const sql = this.neon();
    if (!sql) return;

    await sql`
      insert into device_plugin_capabilities (
        id,
        workspace_id,
        device_id,
        plugin_name,
        plugin_version,
        channels,
        permissions,
        manifest,
        reported_at
      ) values (
        ${capability.id},
        ${capability.workspace_id},
        ${capability.device_id},
        ${capability.plugin_name},
        ${capability.plugin_version},
        ${capability.channels},
        ${capability.permissions},
        ${JSON.stringify(capability.manifest)}::jsonb,
        ${capability.reported_at}
      )
      on conflict (id) do update set
        plugin_version = excluded.plugin_version,
        channels = excluded.channels,
        permissions = excluded.permissions,
        manifest = excluded.manifest,
        reported_at = excluded.reported_at
    `;
  }

  private neon() {
    if (!this.env.NEON_DATABASE_URL) return undefined;
    return neon(this.env.NEON_DATABASE_URL);
  }

  private async getMap<T>(name: string): Promise<Record<string, T>> {
    return await this.state.storage.get<Record<string, T>>(name) ?? {};
  }

  private async list<T>(name: string): Promise<T[]> {
    return Object.values(await this.getMap<T>(name));
  }

  private async getMapItem<T>(name: string, id: string): Promise<T | undefined> {
    return (await this.getMap<T>(name))[id];
  }

  private async putMapItem<T>(name: string, id: string, value: T) {
    const map = await this.getMap<T>(name);
    map[id] = value;
    await this.state.storage.put(name, map);
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function websocketOrigin(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isTerminalMessageState(status: MessageState) {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "expired";
}

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
