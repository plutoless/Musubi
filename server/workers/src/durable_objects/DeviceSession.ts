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
  result_events?: ResultEnvelope[];
  result?: ResultEnvelope;
}

interface DeviceRecord {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
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

interface AppAuth {
  app: AppRecord;
  apiKey: AppApiKeyRecord;
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

    if (url.pathname === "/v1/apps" && request.method === "GET") {
      return this.handleListApps(url);
    }

    if (url.pathname === "/v1/devices" && request.method === "GET") {
      return this.handleListDevices(url);
    }

    if (url.pathname === "/v1/developers" && request.method === "POST") {
      return this.handleCreateDeveloper(request);
    }

    if (url.pathname === "/v1/developers" && request.method === "GET") {
      return this.handleListDevelopers();
    }

    const developerMatch = url.pathname.match(/^\/v1\/developers\/([^/]+)$/);
    if (developerMatch && request.method === "PATCH") {
      return this.handleUpdateDeveloper(request, developerMatch[1]);
    }

    if (url.pathname === "/v1/publishers" && request.method === "POST") {
      return this.handleCreatePublisher(request);
    }

    if (url.pathname === "/v1/publishers" && request.method === "GET") {
      return this.handleListPublishers();
    }

    const publisherMatch = url.pathname.match(/^\/v1\/publishers\/([^/]+)$/);
    if (publisherMatch && request.method === "PATCH") {
      return this.handleUpdatePublisher(request, publisherMatch[1]);
    }

    if (url.pathname === "/v1/developer/apps" && request.method === "POST") {
      return this.handleCreateDeveloperApp(request);
    }

    const developerApiKeyMatch = url.pathname.match(/^\/v1\/developer\/apps\/([^/]+)\/api-keys$/);
    if (developerApiKeyMatch && request.method === "POST") {
      return this.handleCreateAppApiKey(request, developerApiKeyMatch[1]);
    }

    const declarationMatch = url.pathname.match(/^\/v1\/developer\/apps\/([^/]+)\/permission-declarations$/);
    if (declarationMatch && request.method === "POST") {
      return this.handleCreatePermissionDeclaration(request, declarationMatch[1]);
    }

    if (url.pathname === "/v1/consent-requests" && request.method === "POST") {
      return this.handleCreateConsentRequest(request);
    }

    const consentMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)$/);
    if (consentMatch && request.method === "GET") {
      return this.handleGetConsentRequest(consentMatch[1]);
    }

    const consentApproveMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)\/approve$/);
    if (consentApproveMatch && request.method === "POST") {
      return this.handleApproveConsent(request, consentApproveMatch[1]);
    }

    const consentDenyMatch = url.pathname.match(/^\/v1\/consent-requests\/([^/]+)\/deny$/);
    if (consentDenyMatch && request.method === "POST") {
      return this.handleDenyConsent(request, consentDenyMatch[1]);
    }

    if (url.pathname === "/v1/grants" && request.method === "POST") {
      return this.handleCreateGrant(request);
    }

    if (url.pathname === "/v1/grants" && request.method === "GET") {
      return this.handleListGrants(url);
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

    if (url.pathname === "/v1/authorized-apps" && request.method === "GET") {
      return this.handleListAuthorizedApps();
    }

    if (url.pathname === "/v1/plugins" && request.method === "GET") {
      return Response.json({ plugins: HOSTED_PLUGIN_NAMES.map((name) => registryPluginResponse(name)?.plugin).filter(Boolean) });
    }

    const pluginVersionMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)\/versions\/([^/]+)$/);
    if (pluginVersionMatch && request.method === "GET") {
      const plugin = registryPluginResponse(pluginVersionMatch[1], pluginVersionMatch[2]);
      return plugin ? Response.json(plugin) : Response.json({ error: "not found" }, { status: 404 });
    }

    const pluginMatch = url.pathname.match(/^\/v1\/plugins\/([^/]+)$/);
    if (pluginMatch && request.method === "GET") {
      const plugin = registryPluginResponse(pluginMatch[1]);
      return plugin ? Response.json(plugin) : Response.json({ error: "not found" }, { status: 404 });
    }

    if (url.pathname === "/v1/plugin-registry/resolve" && request.method === "GET") {
      return this.handleResolvePlugin(url);
    }

    if (url.pathname === "/v1/workspace/plugin-policy" && request.method === "GET") {
      return Response.json({ policy: await this.workspacePluginPolicy() });
    }

    if (url.pathname === "/v1/workspace/plugin-policy" && request.method === "PATCH") {
      return this.handleUpdateWorkspacePluginPolicy(request);
    }

    const appReportMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/report$/);
    if (appReportMatch && request.method === "POST") {
      return this.handleReportApp(request, appReportMatch[1]);
    }

    const appSuspendMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/suspend$/);
    if (appSuspendMatch && request.method === "POST") {
      return this.handleSuspendApp(appSuspendMatch[1]);
    }

    const appRevokeMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/revoke$/);
    if (appRevokeMatch && request.method === "POST") {
      return this.handleRevokeApp(appRevokeMatch[1]);
    }

    const apiKeyMatch = url.pathname.match(/^\/v1\/apps\/([^/]+)\/api-keys$/);
    if (apiKeyMatch && request.method === "POST") {
      return this.handleCreateAppApiKey(request, apiKeyMatch[1]);
    }
    if (apiKeyMatch && request.method === "GET") {
      return this.handleListAppApiKeys(apiKeyMatch[1]);
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

    if (url.pathname === "/v1/messages" && request.method === "GET") {
      return this.handleListMessages(url);
    }

    const cancelMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      return this.handleCancelMessage(cancelMatch[1]);
    }

    const messageMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
    if (messageMatch && request.method === "GET") {
      return this.handleGetMessage(messageMatch[1]);
    }

    const messageEventsMatch = url.pathname.match(/^\/v1\/messages\/([^/]+)\/events$/);
    if (messageEventsMatch && request.method === "GET") {
      return this.handleGetMessageEvents(messageEventsMatch[1], url);
    }

    if (url.pathname === "/v1/app/devices" && request.method === "GET") {
      return this.handleListGrantedAppDevices(request);
    }

    const appDeviceKeyMatch = url.pathname.match(/^\/v1\/app\/devices\/([^/]+)\/public-key$/);
    if (appDeviceKeyMatch && request.method === "GET") {
      return this.handleGetAppDevicePublicKey(request, appDeviceKeyMatch[1]);
    }

    if (url.pathname === "/v1/audit-events" && request.method === "GET") {
      return this.handleGetAuditEvents(url.searchParams.get("message_id"));
    }

    if (url.pathname === "/v1/device-plugin-capabilities" && request.method === "GET") {
      const sql = this.neon();
      if (sql) {
        const capabilities = await sql`
          select *
          from device_plugin_capabilities
          order by reported_at desc
          limit 200
        ` as DevicePluginCapabilityRecord[];
        return Response.json({ capabilities });
      }
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
    const sql = this.neon();
    const devices = await this.list<DeviceRecord>("devices");
    const suffix = String(devices.length + 1).padStart(3, "0");
    const deviceId = sql ? generatedId("dev") : `dev_${suffix}`;
    const keyId = sql ? generatedId("devkey") : `devkey_${suffix}`;
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
      type?: "first_party" | "user_owned" | "third_party";
      public_key: string;
    };
    const sql = this.neon();
    const apps = await this.list<AppRecord>("apps");
    const suffix = String(apps.length + 1).padStart(3, "0");
    const appId = sql ? generatedId("app") : `app_${suffix}`;
    const keyId = sql ? generatedId("appkey") : `appkey_${suffix}`;
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

  private async handleListApps(url: URL): Promise<Response> {
    const sql = this.neon();
    if (!sql) {
      const apps = await this.list<AppRecord>("apps");
      return Response.json({ apps });
    }
    let rows = await sql`
      select
        apps.*,
        publisher_profiles.display_name as publisher_display_name,
        publisher_profiles.verification_status as publisher_verification_status
      from apps
      left join publisher_profiles on publisher_profiles.id = apps.publisher_id
      order by apps.created_at desc
      limit 100
    ` as any[];
    const type = url.searchParams.get("type");
    if (type) rows = rows.filter((row) => row.type === type);
    const appIds = rows.map((row) => row.id).filter(Boolean);
    if (appIds.length === 0) return Response.json({ apps: [], next_cursor: null });

    const publisherIds = [...new Set(rows.map((row) => row.publisher_id).filter(Boolean))] as string[];
    const [publishers, declarations, grants] = await Promise.all([
      publisherIds.length
        ? sql`select * from publisher_profiles where id = any(${publisherIds}::text[])` as Promise<PublisherRecord[]>
        : Promise.resolve([]),
      sql`
        select *
        from app_permission_declarations
        where app_id = any(${appIds}::text[])
        order by created_at asc
      ` as Promise<PermissionDeclarationRecord[]>,
      sql`
        select *
        from app_device_channel_grants
        where app_id = any(${appIds}::text[])
        order by created_at desc
      ` as Promise<GrantRecord[]>,
    ]);
    const publishersById = new Map(publishers.map((publisher) => [publisher.id, publisher]));
    const declarationsByAppId = groupBy(declarations, (declaration) => declaration.app_id);
    const grantsByAppId = groupBy(grants, (grant) => grant.app_id);
    const apps = rows.map((app) => {
      const activeGrants = (grantsByAppId.get(app.id) ?? []).filter((grant) => !grant.revoked_at);
      return {
        ...app,
        publisher: app.publisher_id ? publishersById.get(app.publisher_id) : undefined,
        permission_declarations: declarationsByAppId.get(app.id) ?? [],
        authorized_device_count: new Set(activeGrants.map((grant) => grant.device_id)).size,
        allowed_channel_count: new Set(activeGrants.flatMap((grant) => grant.allowed_channels ?? [])).size,
      };
    });
    return Response.json({ apps, next_cursor: null });
  }

  private async handleListDevices(url: URL): Promise<Response> {
    const sql = this.neon();
    if (!sql) {
      const devices = await this.list<DeviceRecord>("devices");
      return Response.json({ devices, next_cursor: null });
    }
    let rows = await sql`
      select *
      from devices
      order by created_at desc
      limit 100
    ` as any[];
    const workspaceId = url.searchParams.get("workspace_id");
    const status = url.searchParams.get("status");
    if (workspaceId) rows = rows.filter((row) => row.workspace_id === workspaceId);
    if (status) rows = rows.filter((row) => row.status === status);
    return Response.json({
      devices: rows.map((device) => ({
        id: device.id,
        name: device.display_name ?? device.name,
        status: device.status,
        platform: device.platform,
        cli_version: device.cli_version,
        plugin_count: 0,
        authorized_app_count: 0,
        last_seen_at: device.last_seen_at,
        last_capability_report_at: device.last_capability_report_at,
        created_at: device.created_at,
      })),
      next_cursor: null,
    });
  }

  private async handleCreateDeveloper(request: Request): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const body = await request.json().catch(() => ({})) as { name?: string; email?: string };
    await this.persistWorkspace("ws_local");
    await this.persistUser({ id: "user_local", name: "Local User" });
    const developer: DeveloperRecord = {
      id: generatedId("devacct"),
      owner_user_id: "user_local",
      name: body.name || "Local Developer",
      email: body.email,
      status: "active",
      created_at: new Date().toISOString(),
    };
    await sql`
      insert into developer_accounts (id, owner_user_id, name, email, status, created_at)
      values (${developer.id}, ${developer.owner_user_id}, ${developer.name}, ${developer.email ?? null}, ${developer.status}, ${developer.created_at})
    `;
    await this.audit("user", "user_local", "developer.created", {
      workspace_id: "ws_local",
      metadata: { developer_id: developer.id },
    });
    return Response.json({ developer });
  }

  private async handleListDevelopers(): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const developers = await sql`
      select *
      from developer_accounts
      order by created_at desc
      limit 100
    ` as DeveloperRecord[];
    return Response.json({ developers });
  }

  private async handleUpdateDeveloper(request: Request, developerId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const existing = (await sql`select * from developer_accounts where id = ${developerId} limit 1` as DeveloperRecord[])[0];
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as Partial<DeveloperRecord>;
    const developer: DeveloperRecord = {
      ...existing,
      name: body.name ?? existing.name,
      email: body.email !== undefined ? body.email : existing.email,
      status: body.status === "active" || body.status === "suspended" ? body.status : existing.status,
      suspended_at: body.status === "suspended" ? new Date().toISOString() : existing.suspended_at,
    };
    await sql`
      update developer_accounts
      set name = ${developer.name},
          email = ${developer.email ?? null},
          status = ${developer.status},
          suspended_at = ${developer.suspended_at ?? null}
      where id = ${developer.id}
    `;
    await this.persistWorkspace("ws_local");
    await this.audit("user", "user_local", developer.status === "suspended" ? "developer.suspended" : "developer.updated", {
      workspace_id: "ws_local",
      metadata: { developer_id: developer.id },
    });
    return Response.json({ developer });
  }

  private async handleCreatePublisher(request: Request): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const body = await request.json().catch(() => ({})) as {
      developer_id?: string;
      display_name?: string;
      website?: string;
      support_email?: string;
      privacy_policy_url?: string;
      terms_url?: string;
    };
    if (!body.developer_id) return Response.json({ error: "developer_id required" }, { status: 400 });
    const developer = (await sql`select id from developer_accounts where id = ${body.developer_id} limit 1` as any[])[0];
    if (!developer) return Response.json({ error: "developer denied" }, { status: 400 });
    await this.persistWorkspace("ws_local");
    const publisher: PublisherRecord = {
      id: generatedId("pub"),
      developer_id: body.developer_id,
      display_name: body.display_name || "Unverified Publisher",
      website: body.website,
      support_email: body.support_email,
      privacy_policy_url: body.privacy_policy_url,
      terms_url: body.terms_url,
      verification_status: "unverified",
      created_at: new Date().toISOString(),
    };
    await sql`
      insert into publisher_profiles (
        id, developer_id, display_name, website, support_email, privacy_policy_url, terms_url, verification_status, created_at
      ) values (
        ${publisher.id}, ${publisher.developer_id}, ${publisher.display_name}, ${publisher.website ?? null},
        ${publisher.support_email ?? null}, ${publisher.privacy_policy_url ?? null}, ${publisher.terms_url ?? null},
        ${publisher.verification_status}, ${publisher.created_at}
      )
    `;
    await this.audit("user", "user_local", "publisher.created", {
      workspace_id: "ws_local",
      metadata: { publisher_id: publisher.id },
    });
    return Response.json({ publisher });
  }

  private async handleListPublishers(): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const publishers = await sql`
      select *
      from publisher_profiles
      order by created_at desc
      limit 100
    ` as PublisherRecord[];
    return Response.json({ publishers });
  }

  private async handleUpdatePublisher(request: Request, publisherId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const existing = (await sql`select * from publisher_profiles where id = ${publisherId} limit 1` as PublisherRecord[])[0];
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as Partial<PublisherRecord>;
    const publisher: PublisherRecord = {
      ...existing,
      display_name: body.display_name ?? existing.display_name,
      website: body.website !== undefined ? body.website : existing.website,
      support_email: body.support_email !== undefined ? body.support_email : existing.support_email,
      privacy_policy_url: body.privacy_policy_url !== undefined ? body.privacy_policy_url : existing.privacy_policy_url,
      terms_url: body.terms_url !== undefined ? body.terms_url : existing.terms_url,
      logo_url: body.logo_url !== undefined ? body.logo_url : existing.logo_url,
      verification_status: body.verification_status === "unverified" || body.verification_status === "verified" || body.verification_status === "suspended" ? body.verification_status : existing.verification_status,
      updated_at: new Date().toISOString(),
    };
    await sql`
      update publisher_profiles
      set display_name = ${publisher.display_name},
          website = ${publisher.website ?? null},
          support_email = ${publisher.support_email ?? null},
          privacy_policy_url = ${publisher.privacy_policy_url ?? null},
          terms_url = ${publisher.terms_url ?? null},
          logo_url = ${publisher.logo_url ?? null},
          verification_status = ${publisher.verification_status},
          updated_at = ${publisher.updated_at}
      where id = ${publisher.id}
    `;
    await this.persistWorkspace("ws_local");
    const eventType = publisher.verification_status === "verified"
      ? "publisher.verified"
      : publisher.verification_status === "suspended"
        ? "publisher.suspended"
        : "publisher.updated";
    await this.audit("user", "user_local", eventType, {
      workspace_id: "ws_local",
      metadata: { publisher_id: publisher.id },
    });
    return Response.json({ publisher });
  }

  private async handleCreateDeveloperApp(request: Request): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const body = await request.json().catch(() => ({})) as {
      workspace_id?: string;
      name?: string;
      public_key?: string;
      publisher_id?: string;
      description?: string;
      website?: string;
      privacy_policy_url?: string;
      terms_url?: string;
    };
    if (!body.name || !body.public_key || !body.publisher_id) {
      return Response.json({ error: "name, public_key, and publisher_id required" }, { status: 400 });
    }
    const publisher = (await sql`select * from publisher_profiles where id = ${body.publisher_id} limit 1` as PublisherRecord[])[0];
    if (!publisher) return Response.json({ error: "publisher denied" }, { status: 400 });
    const app: AppRecord = {
      id: generatedId("app"),
      workspace_id: body.workspace_id ?? "ws_local",
      name: body.name,
      description: body.description,
      type: "third_party",
      status: "active",
      publisher_id: body.publisher_id,
      website: body.website,
      privacy_policy_url: body.privacy_policy_url,
      terms_url: body.terms_url,
      trust_status: "unverified",
      review_status: "approved",
      created_at: new Date().toISOString(),
    };
    const key: AppKeyRecord = {
      id: generatedId("appkey"),
      app_id: app.id,
      public_key: body.public_key,
      status: "active",
      created_at: app.created_at,
    };
    await this.persistWorkspace(app.workspace_id);
    await this.putMapItem("apps", app.id, app);
    await this.putMapItem("app_keys", key.id, key);
    await this.persistApp(app);
    await this.persistAppKey(key);
    await this.audit("user", "user_local", "app.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_key_id: key.id, type: app.type },
    });
    await this.audit("developer", publisher.id, "third_party_app.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_key_id: key.id, publisher_id: publisher.id },
    });
    const apiKeyResponse = await this.createAppApiKey(app, "Developer backend key");
    return Response.json({
      app_id: app.id,
      app_key_id: key.id,
      status: app.status,
      trust_status: app.trust_status,
      api_key: apiKeyResponse.secret,
      api_key_record: this.appApiKeyView(apiKeyResponse.key),
    });
  }

  private async handleCreateAppApiKey(request: Request, appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    if (app.status !== "active") return Response.json({ error: "app revoked" }, { status: 409 });
    const body = await request.json().catch(() => ({})) as { name?: string };
    const created = await this.createAppApiKey(app, body.name || "Default API key");
    return Response.json({ api_key: created.secret, key: this.appApiKeyView(created.key) });
  }

  private async handleListAppApiKeys(appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const keys = await sql`
      select id, app_id, name, prefix, status, created_at, last_used_at, revoked_at, revoked_by
      from app_api_keys
      where app_id = ${appId}
      order by created_at asc
    ` as AppApiKeyRecord[];
    return Response.json({ api_keys: keys });
  }

  private async handleCreatePermissionDeclaration(request: Request, appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app || app.type !== "third_party") return Response.json({ error: "third-party app not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { plugin_name?: string; channels?: string[]; reason?: string; queueing_requested?: boolean };
    if (!body.plugin_name || !body.channels?.length) return Response.json({ error: "plugin_name and channels required" }, { status: 400 });
    const declaration: PermissionDeclarationRecord = {
      id: generatedId("apd"),
      app_id: appId,
      plugin_name: body.plugin_name,
      channels: body.channels,
      reason: body.reason,
      queueing_requested: body.queueing_requested ?? false,
      created_at: new Date().toISOString(),
    };
    await sql`
      insert into app_permission_declarations (
        id, app_id, plugin_name, channels, reason, queueing_requested, created_at
      ) values (
        ${declaration.id}, ${declaration.app_id}, ${declaration.plugin_name}, ${declaration.channels},
        ${declaration.reason ?? null}, ${declaration.queueing_requested}, ${declaration.created_at}
      )
    `;
    await this.audit("developer", appId, "app.permission_declared", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { declaration_id: declaration.id, plugin_name: declaration.plugin_name, channels: declaration.channels },
    });
    await this.audit("developer", appId, "permission_declaration.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { declaration_id: declaration.id, plugin_name: declaration.plugin_name, channels: declaration.channels },
    });
    return Response.json({ declaration });
  }

  private async handleCreateConsentRequest(request: Request): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const body = await request.json().catch(() => ({})) as {
      app_id?: string;
      state?: string;
      redirect_uri?: string;
      requested_capabilities?: Array<{ plugin: string; channels: string[]; reason?: string }>;
    };
    const app = body.app_id ? await this.hostedApp(body.app_id) : undefined;
    if (!app || app.type !== "third_party" || app.status !== "active") return Response.json({ error: "third-party app denied" }, { status: 400 });
    if (app.trust_status === "blocked") return Response.json({ error: "app blocked" }, { status: 403 });
    const publisher = app.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
    if (publisher?.verification_status === "suspended") return Response.json({ error: "publisher suspended" }, { status: 403 });
    const declarations = await this.hostedPermissionDeclarations(app.id);
    const declared = declarations.map((item) => ({ plugin: item.plugin_name, channels: item.channels, reason: item.reason }));
    const requested = body.requested_capabilities?.length ? body.requested_capabilities : declared;
    const declaredChannels = new Set(declared.flatMap((item) => item.channels));
    const undeclared = requested.flatMap((item) => item.channels).filter((channel) => !declaredChannels.has(channel));
    if (undeclared.length) return Response.json({ error: `undeclared channels: ${undeclared.join(", ")}` }, { status: 400 });
    const consent: ConsentRequestRecord = {
      id: generatedId("consent"),
      app_id: app.id,
      user_id: "user_local",
      state: body.state,
      redirect_uri: body.redirect_uri,
      requested_capabilities: requested,
      status: "pending",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    await this.persistUser({ id: "user_local", name: "Local User" });
    await sql`
      insert into consent_requests (
        id, app_id, user_id, state, redirect_uri, requested_capabilities, status, created_at, expires_at
      ) values (
        ${consent.id}, ${consent.app_id}, ${consent.user_id ?? null}, ${consent.state ?? null},
        ${consent.redirect_uri ?? null}, ${JSON.stringify(consent.requested_capabilities)}::jsonb,
        ${consent.status}, ${consent.created_at}, ${consent.expires_at ?? null}
      )
    `;
    await this.audit("app", app.id, "consent.requested", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { consent_id: consent.id },
    });
    await this.audit("app", app.id, "consent_request.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { consent_id: consent.id },
    });
    return Response.json({
      consent_request: consent,
      consent_request_id: consent.id,
      consent_url: `/control-plane#consent/${consent.id}`,
      status: consent.status,
      expires_at: consent.expires_at,
    });
  }

  private async handleGetConsentRequest(consentId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const consent = await this.hostedConsent(consentId);
    if (!consent) return Response.json({ error: "not found" }, { status: 404 });
    const app = await this.hostedApp(consent.app_id);
    const publisher = app?.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
    const declarations = app ? await this.hostedPermissionDeclarations(app.id) : [];
    const devices = await sql`
      select *
      from devices
      where revoked_at is null
      order by created_at asc
      limit 100
    ` as DeviceRecord[];
    const capabilities = await sql`
      select *
      from device_plugin_capabilities
      order by reported_at desc
      limit 200
    ` as DevicePluginCapabilityRecord[];
    return Response.json({
      consent_request: consent,
      app: app ? await this.hostedAppView(app) : undefined,
      publisher,
      permission_declarations: declarations,
      devices,
      eligible_devices: devices,
      capabilities,
    });
  }

  private async handleApproveConsent(request: Request, consentId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const consent = await this.hostedConsent(consentId);
    if (!consent || consent.status !== "pending") return Response.json({ error: "consent not pending" }, { status: 404 });
    const app = await this.hostedApp(consent.app_id);
    if (!app) return Response.json({ error: "app not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { device_id?: string; allowed_channels?: string[]; queueing_allowed?: boolean };
    const channels = body.allowed_channels ?? [];
    if (!body.device_id || channels.length === 0) return Response.json({ error: "device_id and allowed_channels required" }, { status: 400 });
    const declarations = await this.hostedPermissionDeclarations(app.id);
    const declared = new Set(declarations.flatMap((item) => item.channels));
    const undeclared = channels.filter((channel) => !declared.has(channel));
    if (undeclared.length) return Response.json({ error: `undeclared channels: ${undeclared.join(", ")}` }, { status: 400 });
    const denied = await this.checkGrantPreconditions(app.workspace_id, app.id, body.device_id);
    if (denied) return Response.json({ status: "failed", error: denied }, { status: 400 });

    const now = new Date().toISOString();
    const grant: GrantRecord = {
      id: generatedId("grant"),
      workspace_id: app.workspace_id,
      app_id: app.id,
      device_id: body.device_id,
      name: "Third-party consent grant",
      allowed_channels: channels,
      queueing_allowed: body.queueing_allowed ?? false,
      created_from_consent_request_id: consent.id,
      created_at: now,
      updated_at: now,
    };
    const approvedConsent = { ...consent, status: "approved" as const, completed_at: now, grant_id: grant.id };
    const auditEvents = [
      this.auditEvent("user", "user_local", "grant.created", {
        workspace_id: grant.workspace_id,
        app_id: grant.app_id,
        device_id: grant.device_id,
        metadata: { grant_id: grant.id, allowed_channels: grant.allowed_channels },
      }),
      this.auditEvent("user", "user_local", "consent.approved", {
        workspace_id: app.workspace_id,
        app_id: app.id,
        device_id: grant.device_id,
        metadata: { consent_id: consent.id, grant_id: grant.id, channels },
      }),
      this.auditEvent("user", "user_local", "consent_request.approved", {
        workspace_id: app.workspace_id,
        app_id: app.id,
        device_id: grant.device_id,
        metadata: { consent_id: consent.id, grant_id: grant.id, channels },
      }),
    ];
    await sql.transaction([
      this.persistGrantQuery(sql, grant),
      sql`
        update consent_requests
        set status = 'approved',
            completed_at = ${now},
            grant_id = ${grant.id}
        where id = ${consent.id}
      `,
      ...auditEvents.map((event) => this.persistAuditEventQuery(sql, event)),
    ]);
    await this.putMapItem("grants", grant.id, grant);
    for (const event of auditEvents) await this.putMapItem("audit_events", event.id, event);
    return Response.json({
      status: "approved",
      grant_id: grant.id,
      redirect_uri: consent.redirect_uri ? callbackUrl(consent.redirect_uri, consent.state, "approved", grant.id) : undefined,
      consent_request: approvedConsent,
      grant: await this.grantView(grant),
    });
  }

  private async handleDenyConsent(request: Request, consentId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const consent = await this.hostedConsent(consentId);
    if (!consent || consent.status !== "pending") return Response.json({ error: "consent not pending" }, { status: 404 });
    const app = await this.hostedApp(consent.app_id);
    if (!app) return Response.json({ error: "app not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const now = new Date().toISOString();
    const cancelled = { ...consent, status: "cancelled" as const, completed_at: now };
    await sql`
      update consent_requests
      set status = 'cancelled',
          completed_at = ${now}
      where id = ${consent.id}
    `;
    await this.audit("user", "user_local", "consent_request.denied", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { consent_id: consent.id, reason: body.reason || "user_denied" },
    });
    return Response.json({
      status: "denied",
      redirect_uri: consent.redirect_uri ? callbackUrl(consent.redirect_uri, consent.state, "denied") : undefined,
      consent_request: cancelled,
    });
  }

  private async handleCreateGrant(request: Request): Promise<Response> {
    const body = await request.json() as {
      workspace_id: string;
      app_id: string;
      device_id: string;
      allowed_channels: string[];
      queueing_allowed?: boolean;
      name?: string;
      description?: string;
      created_from_consent_request_id?: string;
    };
    const denied = await this.checkGrantPreconditions(body.workspace_id, body.app_id, body.device_id);
    if (denied) return Response.json({ status: "failed", error: denied }, { status: 400 });

    const sql = this.neon();
    const grants = await this.list<GrantRecord>("grants");
    const suffix = String(grants.length + 1).padStart(3, "0");
    const grantId = sql ? generatedId("grant") : `grant_${suffix}`;
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
    await this.putMapItem("grants", grantId, grant);
    await this.persistGrant(grant);
    await this.audit("user", "user_local", "grant.created", {
      workspace_id: body.workspace_id,
      app_id: body.app_id,
      device_id: body.device_id,
      metadata: { grant_id: grantId, allowed_channels: body.allowed_channels },
    });
    return Response.json({ grant_id: grantId, status: "active", grant: await this.grantView(grant) });
  }

  private async handleListGrants(url: URL): Promise<Response> {
    const sql = this.neon();
    if (!sql) {
      let grants = await this.list<GrantRecord>("grants");
      for (const field of ["app_id", "device_id", "workspace_id"] as const) {
        const value = url.searchParams.get(field);
        if (value) grants = grants.filter((grant) => grant[field] === value);
      }
      return Response.json({ grants, next_cursor: null });
    }
    let rows = await sql`
      select *
      from app_device_channel_grants
      order by created_at desc
      limit 100
    ` as GrantRecord[];
    for (const field of ["app_id", "device_id", "workspace_id"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((grant) => grant[field] === value);
    }
    const grants = await Promise.all(rows.map((grant) => this.grantView(grant)));
    return Response.json({ grants, next_cursor: null });
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
    const sql = this.neon();
    const device = sql ? await this.hostedDevice(deviceId) : await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    if (device.status === "revoked" || device.revoked_at) return Response.json({ error: "device revoked" }, { status: 403 });
    const body = await request.json() as {
      plugins: Array<{
        name: string;
        version: string;
        channels: string[];
        permissions: string[];
        manifest?: Record<string, unknown>;
      }>;
    };
    const existing = sql ? [] : await this.list<DevicePluginCapabilityRecord>("device_plugin_capabilities");
    const now = new Date().toISOString();
    device.last_capability_report_at = now;
    await this.putMapItem("devices", deviceId, device);
    await this.persistDevice(device);
    for (const [index, plugin] of (body.plugins ?? []).entries()) {
      const id = sql ? generatedId("cap") : `cap_${String(existing.length + index + 1).padStart(6, "0")}_${plugin.name}`;
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
    const sql = this.neon();
    const grant = sql ? await this.hostedGrant(grantId) : await this.getMapItem<GrantRecord>("grants", grantId);
    if (!grant) return Response.json({ error: "not found" }, { status: 404 });
    grant.revoked_at = new Date().toISOString();
    grant.revoked_by = "user_local";
    grant.updated_at = grant.revoked_at;
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

  private async handleListAuthorizedApps(): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const apps = await sql`
      select *
      from apps
      where type = 'third_party'
      order by created_at desc
      limit 100
    ` as AppRecord[];
    const appIds = apps.map((app) => app.id);
    if (appIds.length === 0) return Response.json({ authorized_apps: [], apps: [] });

    const publisherIds = [...new Set(apps.map((app) => app.publisher_id).filter(Boolean))] as string[];
    const [publishers, declarations, grants, reports] = await Promise.all([
      publisherIds.length
        ? sql`select * from publisher_profiles where id = any(${publisherIds}::text[])` as Promise<PublisherRecord[]>
        : Promise.resolve([]),
      sql`
        select *
        from app_permission_declarations
        where app_id = any(${appIds}::text[])
        order by created_at asc
      ` as Promise<PermissionDeclarationRecord[]>,
      sql`
        select *
        from app_device_channel_grants
        where app_id = any(${appIds}::text[])
        order by created_at desc
      ` as Promise<GrantRecord[]>,
      sql`
        select *
        from app_abuse_reports
        where app_id = any(${appIds}::text[])
        order by created_at desc
      ` as Promise<AppAbuseReportRecord[]>,
    ]);

    const deviceIds = [...new Set(grants.map((grant) => grant.device_id).filter(Boolean))] as string[];
    const devices = deviceIds.length
      ? await sql`select * from devices where id = any(${deviceIds}::text[])` as DeviceRecord[]
      : [];

    const publishersById = new Map(publishers.map((publisher) => [publisher.id, publisher]));
    const devicesById = new Map(devices.map((device) => [device.id, device]));
    const declarationsByAppId = groupBy(declarations, (declaration) => declaration.app_id);
    const grantsByAppId = groupBy(grants, (grant) => grant.app_id);
    const reportsByAppId = groupBy(reports, (report) => report.app_id);

    const rows = [];
    for (const app of apps) {
      const appGrants = grantsByAppId.get(app.id) ?? [];
      const activeGrants = appGrants.filter((grant) => !grant.revoked_at);
      const appView = {
        ...app,
        publisher: app.publisher_id ? publishersById.get(app.publisher_id) : undefined,
        permission_declarations: declarationsByAppId.get(app.id) ?? [],
        authorized_device_count: new Set(activeGrants.map((grant) => grant.device_id)).size,
        allowed_channel_count: new Set(activeGrants.flatMap((grant) => grant.allowed_channels ?? [])).size,
      };
      rows.push({
        app: appView,
        grants: appGrants.map((grant) => ({
          ...grant,
          status: grant.revoked_at ? "revoked" : "active",
          app,
          device: devicesById.get(grant.device_id),
        })),
        reports: reportsByAppId.get(app.id) ?? [],
      });
    }
    return Response.json({ authorized_apps: rows, apps: rows });
  }

  private async handleResolvePlugin(url: URL): Promise<Response> {
    const requestedName = url.searchParams.get("name") ?? "";
    const requestedVersion = url.searchParams.get("version") ?? "latest";
    const plugin = registryPluginResponse(requestedName, requestedVersion);
    if (!plugin) return Response.json({ error: "not found" }, { status: 404 });
    await this.audit("user", "user_local", requestedVersion === "latest" ? "plugin.update_checked" : "plugin.registry_resolved", {
      workspace_id: "ws_local",
      metadata: { plugin_name: requestedName, requested_version: requestedVersion, resolved_version: plugin.plugin.version },
    });
    return Response.json(plugin);
  }

  private async workspacePluginPolicy(): Promise<WorkspacePluginPolicyRecord> {
    return await this.state.storage.get<WorkspacePluginPolicyRecord>("workspace_plugin_policy") ?? defaultWorkspacePluginPolicy();
  }

  private async handleUpdateWorkspacePluginPolicy(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Partial<WorkspacePluginPolicyRecord>;
    const policy = await this.workspacePluginPolicy();
    if (body.require_signature !== undefined) policy.require_signature = body.require_signature;
    if (body.allowed_trust_levels) policy.allowed_trust_levels = body.allowed_trust_levels;
    if (body.allowed_plugins) policy.allowed_plugins = body.allowed_plugins;
    if (body.blocked_plugins) policy.blocked_plugins = body.blocked_plugins;
    if (body.require_approval_for_permission_increase !== undefined) {
      policy.require_approval_for_permission_increase = body.require_approval_for_permission_increase;
    }
    policy.updated_at = new Date().toISOString();
    await this.state.storage.put("workspace_plugin_policy", policy);
    await this.audit("user", "user_local", "workspace.plugin_policy_updated", {
      workspace_id: "ws_local",
      metadata: { policy },
    });
    return Response.json({ policy });
  }

  private async handleReportApp(request: Request, appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { reason?: string; description?: string };
    await this.persistUser({ id: "user_local", name: "Local User" });
    const report: AppAbuseReportRecord = {
      id: generatedId("report"),
      app_id: appId,
      reporter_user_id: "user_local",
      reason: body.reason || "other",
      description: body.description,
      status: "open",
      created_at: new Date().toISOString(),
    };
    await sql`
      insert into app_abuse_reports (
        id, app_id, reporter_user_id, reason, description, status, created_at
      ) values (
        ${report.id}, ${report.app_id}, ${report.reporter_user_id ?? null}, ${report.reason},
        ${report.description ?? null}, ${report.status}, ${report.created_at}
      )
    `;
    await this.audit("user", "user_local", "app.reported", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { report_id: report.id, reason: report.reason },
    });
    await this.audit("user", "user_local", "third_party_app.reported", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { report_id: report.id, reason: report.reason },
    });
    return Response.json({ report });
  }

  private async handleSuspendApp(appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();
    await sql`
      update apps
      set status = 'suspended',
          disabled_at = ${now},
          disabled_by = 'admin_local',
          updated_at = ${now}
      where id = ${app.id}
    `;
    app.status = "suspended";
    app.disabled_at = now;
    app.disabled_by = "admin_local";
    await this.putMapItem("apps", app.id, app);
    await this.audit("admin", "admin_local", "app.suspended", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id },
    });
    await this.audit("admin", "admin_local", "third_party_app.suspended", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id },
    });
    return Response.json({ app: await this.hostedAppView(app) });
  }

  private async handleRevokeApp(appId: string): Promise<Response> {
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const app = await this.hostedApp(appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();
    await sql`
      update apps
      set status = 'revoked',
          revoked_at = ${now},
          revoked_by = 'user_local',
          updated_at = ${now}
      where id = ${app.id}
    `;
    await sql`
      update app_api_keys
      set status = 'revoked',
          revoked_at = ${now},
          revoked_by = 'user_local'
      where app_id = ${app.id} and status = 'active'
    `;
    await sql`
      update app_device_channel_grants
      set revoked_at = ${now},
          revoked_by = 'user_local',
          updated_at = ${now}
      where app_id = ${app.id} and revoked_at is null
    `;
    app.status = "revoked";
    app.revoked_at = now;
    app.revoked_by = "user_local";
    await this.putMapItem("apps", app.id, app);
    await this.audit("user", "user_local", "app.revoked", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id },
    });
    await this.audit("user", "user_local", "third_party_app.revoked", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_id: app.id },
    });
    return Response.json({ app_id: app.id, status: app.status });
  }

  private async handleGetApp(appId: string): Promise<Response> {
    const sql = this.neon();
    if (sql) {
      const app = await this.hostedApp(appId);
      if (!app) return Response.json({ error: "not found" }, { status: 404 });
      const active_key = (await sql`
        select *
        from app_keys
        where app_id = ${app.id} and status = 'active'
        order by created_at desc
        limit 1
      ` as AppKeyRecord[])[0];
      const api_keys = await sql`
        select id, app_id, name, prefix, status, created_at, last_used_at, revoked_at, revoked_by
        from app_api_keys
        where app_id = ${app.id}
        order by created_at asc
      ` as AppApiKeyRecord[];
      const grants = await Promise.all((await this.hostedAppGrants(app.id)).map((grant) => this.grantView(grant)));
      return Response.json({
        app: await this.hostedAppView(app),
        active_key,
        api_keys,
        grants,
        recent_messages: [],
        recent_audit_events: (await sql`
          select *
          from audit_events
          where app_id = ${app.id}
          order by created_at desc
          limit 50
        ` as AuditEventRecord[]),
      });
    }
    const app = await this.getMapItem<AppRecord>("apps", appId);
    if (!app) return Response.json({ error: "not found" }, { status: 404 });
    const active_key = (await this.list<AppKeyRecord>("app_keys")).find(
      (key) => key.app_id === app.id && key.status === "active",
    );
    return Response.json({ app, active_key });
  }

  private async handleGetDevice(deviceId: string): Promise<Response> {
    const sql = this.neon();
    if (sql) {
      const device = await this.hostedDevice(deviceId);
      if (!device) return Response.json({ error: "not found" }, { status: 404 });
      const status = await this.deviceStatus(deviceId);
      const active_key = (await sql`
        select *
        from device_keys
        where device_id = ${device.id} and status = 'active'
        order by created_at desc
        limit 1
      ` as DeviceKeyRecord[])[0];
      return Response.json({
        device: { ...device, status: device.status === "revoked" ? "revoked" : status },
        active_key,
        capabilities: await sql`
          select *
          from device_plugin_capabilities
          where device_id = ${device.id}
          order by reported_at desc
        `,
        grants: await Promise.all((await this.hostedDeviceGrants(device.id)).map((grant) => this.grantView(grant))),
        recent_messages: [],
        recent_audit_events: await sql`
          select *
          from audit_events
          where device_id = ${device.id}
          order by created_at desc
          limit 50
        `,
      });
    }
    const device = await this.getMapItem<DeviceRecord>("devices", deviceId);
    if (!device) return Response.json({ error: "not found" }, { status: 404 });
    const status = await this.deviceStatus(deviceId);
    const active_key = (await this.list<DeviceKeyRecord>("device_keys")).find(
      (key) => key.device_id === device.id && key.status === "active",
    );
    return Response.json({ device: { ...device, status }, active_key });
  }

  private async handleCreateMessage(request: Request): Promise<Response> {
    const auth = readBearer(request) ? await this.authenticateAppRequest(request) : undefined;
    if (auth instanceof Response) return auth;
    const envelope = await request.json() as MessageEnvelope;
    if (auth && envelope.app_id !== auth.app.id) {
      return Response.json({ message_id: envelope.message_id, status: "failed", error: "app id mismatch" }, { status: 403 });
    }
    const stored: StoredMessage = {
      envelope,
      status: "created",
      history: ["created"],
      result_events: [],
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
      result_events: item.result_events ?? [],
    });
  }

  private async handleListMessages(url: URL): Promise<Response> {
    let messages = await this.list<StoredMessage>("messages");
    for (const field of ["app_id", "device_id", "channel", "status"] as const) {
      const value = url.searchParams.get(field);
      if (!value) continue;
      messages = messages.filter((item) => field === "status" ? item.status === value : item.envelope[field] === value);
    }
    const rows = messages
      .sort((a, b) => (b.envelope.created_at ?? "").localeCompare(a.envelope.created_at ?? ""))
      .slice(0, 100)
      .map((item) => ({
        id: item.envelope.message_id,
        message_id: item.envelope.message_id,
        workspace_id: item.envelope.workspace_id,
        app_id: item.envelope.app_id,
        device_id: item.envelope.device_id,
        channel: item.envelope.channel,
        status: item.status,
        created_at: item.envelope.created_at,
        updated_at: item.envelope.created_at,
        duration_ms: null,
        crypto: {
          version: (item.envelope.crypto as any)?.version,
          alg: (item.envelope.crypto as any)?.alg,
          sender_key_id: (item.envelope.crypto as any)?.sender_key_id,
          recipient_key_id: (item.envelope.crypto as any)?.recipient_key_id,
          payload_size: item.envelope.ciphertext.length,
        },
      }));
    return Response.json({ messages: rows, next_cursor: null });
  }

  private async handleGetMessageEvents(messageId: string, url: URL): Promise<Response> {
    const item = await this.getMapItem<StoredMessage>("messages", messageId);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
    const events = (item.result_events ?? []).slice(cursor);
    return Response.json({
      message_id: item.envelope.message_id,
      status: item.status,
      cursor,
      next_cursor: String(cursor + events.length),
      events,
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
    const sql = this.neon();
    const events = sql
      ? await sql`select * from audit_events order by created_at desc limit 100` as AuditEventRecord[]
      : await this.list<AuditEventRecord>("audit_events");
    return Response.json({
      audit_events: messageId ? events.filter((event) => event.message_id === messageId) : events,
    });
  }

  private async handleListGrantedAppDevices(request: Request): Promise<Response> {
    const auth = await this.authenticateAppRequest(request);
    if (auth instanceof Response) return auth;
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const rows = await sql`
      select
        devices.id,
        devices.name,
        devices.status,
        devices.platform,
        devices.workspace_id,
        devices.last_seen_at,
        devices.last_capability_report_at,
        app_device_channel_grants.allowed_channels,
        app_device_channel_grants.queueing_allowed
      from app_device_channel_grants
      join devices on devices.id = app_device_channel_grants.device_id
      where app_device_channel_grants.app_id = ${auth.app.id}
        and app_device_channel_grants.revoked_at is null
        and devices.revoked_at is null
        and devices.status != 'revoked'
      order by devices.created_at asc
    ` as any[];
    return Response.json({
      devices: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        platform: row.platform,
        workspace_id: row.workspace_id,
        allowed_channels: row.allowed_channels,
        queueing_allowed: row.queueing_allowed,
        last_seen_at: row.last_seen_at,
        last_capability_report_at: row.last_capability_report_at,
      })),
    });
  }

  private async handleGetAppDevicePublicKey(request: Request, deviceId: string): Promise<Response> {
    const auth = await this.authenticateAppRequest(request);
    if (auth instanceof Response) return auth;
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const grant = (await sql`
      select app_device_channel_grants.*
      from app_device_channel_grants
      join devices on devices.id = app_device_channel_grants.device_id
      where app_device_channel_grants.app_id = ${auth.app.id}
        and app_device_channel_grants.device_id = ${deviceId}
        and app_device_channel_grants.revoked_at is null
        and devices.revoked_at is null
        and devices.status != 'revoked'
      order by app_device_channel_grants.created_at desc
      limit 1
    ` as GrantRecord[])[0];
    if (!grant) return Response.json({ error: "grant denied" }, { status: 403 });
    const key = (await sql`
      select *
      from device_keys
      where device_id = ${deviceId}
        and status = 'active'
      order by created_at desc
      limit 1
    ` as DeviceKeyRecord[])[0];
    if (!key) return Response.json({ error: "device key denied" }, { status: 404 });
    return Response.json({
      device_id: deviceId,
      device_key_id: key.id,
      public_key: key.public_key,
      allowed_channels: grant.allowed_channels,
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
      const sql = this.neon();
      if (sql) {
        const active_key = (await sql`
          select device_keys.*
          from device_keys
          join devices on devices.id = device_keys.device_id
          where device_keys.device_id = ${activeKeyMatch[1]}
            and device_keys.status = 'active'
            and devices.revoked_at is null
            and devices.status != 'revoked'
          order by device_keys.created_at desc
          limit 1
        ` as DeviceKeyRecord[])[0];
        return active_key ? Response.json({ active_key }) : Response.json({ error: "not found" }, { status: 404 });
      }
      const active_key = (await this.list<DeviceKeyRecord>("device_keys")).find(
        (key) => key.device_id === activeKeyMatch[1] && key.status === "active",
      );
      return active_key ? Response.json({ active_key }) : Response.json({ error: "not found" }, { status: 404 });
    }

    const workspaceMatch = url.pathname.match(/^\/internal\/control\/devices\/([^/]+)\/workspace$/);
    if (workspaceMatch) {
      const sql = this.neon();
      if (sql) {
        const hostedDevice = await this.hostedDevice(workspaceMatch[1]);
        return hostedDevice ? Response.json({ workspace_id: hostedDevice.workspace_id }) : Response.json({ error: "not found" }, { status: 404 });
      }
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
        item.result_events = [...(item.result_events ?? []), result];
        if (isTerminalMessageState(result.status)) {
          item.result = result;
        }
        await this.putMapItem("messages", result.message_id, item);
        await this.persistMessage(item);
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
      const sql = this.neon();
      const device = sql ? await this.hostedDevice(body.device_id) : await this.getMapItem<DeviceRecord>("devices", body.device_id);
      if (!device) return Response.json({ error: "not found" }, { status: 404 });
      if (device.status === "revoked" || device.revoked_at) return Response.json({ error: "device revoked" }, { status: 409 });
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
    const sql = this.neon();
    if (sql) {
      const app = await this.hostedApp(appId);
      if (!app || app.workspace_id !== workspaceId || app.status !== "active") return app?.status === "suspended" ? "app suspended" : "app denied";
      if (app.trust_status === "blocked") return "app blocked";
      const publisher = app.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
      if (publisher?.verification_status === "suspended") return "publisher suspended";
      if (app.type === "third_party" && !(await this.hostedDeclaresChannel(app.id, channel))) return "undeclared channel denied";
      const device = await this.hostedDevice(deviceId);
      if (!device || device.workspace_id !== workspaceId) return "device denied";
      if (device.status === "revoked" || device.revoked_at) return "device revoked";
      const activeAppKey = (await sql`
        select id
        from app_keys
        where app_id = ${appId} and status = 'active'
        limit 1
      ` as any[])[0];
      if (!activeAppKey) return "app key denied";
      const activeDeviceKey = (await sql`
        select id
        from device_keys
        where device_id = ${deviceId} and status = 'active'
        limit 1
      ` as any[])[0];
      if (!activeDeviceKey) return "device key denied";
      const grant = await this.activeGrantFor(workspaceId, appId, deviceId, channel);
      if (!grant) return "grant denied";
      if (!grant.allowed_channels.includes(channel)) return "channel denied";
      return undefined;
    }
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
    const sql = this.neon();
    if (sql) {
      return (await sql`
        select *
        from app_device_channel_grants
        where workspace_id = ${workspaceId}
          and app_id = ${appId}
          and device_id = ${deviceId}
          and revoked_at is null
        order by created_at desc
        limit 1
      ` as GrantRecord[]).find((grant) => grant.allowed_channels.includes(channel));
    }
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
    const sql = this.neon();
    if (sql) {
      const app = await this.hostedApp(appId);
      if (!app || app.workspace_id !== workspaceId || app.status !== "active") return "app denied";
      if (app.trust_status === "blocked") return "app blocked";
      const publisher = app.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
      if (publisher?.verification_status === "suspended") return "publisher suspended";
      const device = await this.hostedDevice(deviceId);
      if (!device || device.workspace_id !== workspaceId) return "device denied";
      if (device.status === "revoked" || device.revoked_at) return "device revoked";
      const activeAppKey = (await sql`
        select id
        from app_keys
        where app_id = ${appId} and status = 'active'
        limit 1
      ` as any[])[0];
      if (!activeAppKey) return "app key denied";
      const activeDeviceKey = (await sql`
        select id
        from device_keys
        where device_id = ${deviceId} and status = 'active'
        limit 1
      ` as any[])[0];
      if (!activeDeviceKey) return "device key denied";
      return undefined;
    }
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
    const event = this.auditEvent(actorType, actorId, eventType, fields);
    await this.putMapItem("audit_events", event.id, event);
    await this.persistAuditEvent(event);
  }

  private auditEvent(
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
  ): AuditEventRecord {
    return {
      id: generatedId("audit"),
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
        last_capability_report_at,
        created_at,
        revoked_by,
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
        ${device.last_capability_report_at ?? null},
        ${device.created_at},
        ${device.revoked_by ?? null},
        ${device.revoked_at ?? null}
      )
      on conflict (id) do update set
        name = excluded.name,
        platform = excluded.platform,
        cli_version = excluded.cli_version,
        status = case
          when devices.status = 'revoked' or devices.revoked_at is not null then devices.status
          else excluded.status
        end,
        last_seen_at = excluded.last_seen_at,
        last_capability_report_at = excluded.last_capability_report_at,
        revoked_by = coalesce(devices.revoked_by, excluded.revoked_by),
        revoked_at = coalesce(devices.revoked_at, excluded.revoked_at)
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
        description,
        type,
        status,
        publisher_id,
        website,
        privacy_policy_url,
        terms_url,
        trust_status,
        review_status,
        created_by,
        created_at,
        updated_at,
        disabled_at,
        disabled_by,
        revoked_by,
        revoked_at
      ) values (
        ${app.id},
        ${app.workspace_id},
        ${app.name},
        ${app.description ?? null},
        ${app.type},
        ${app.status},
        ${app.publisher_id ?? null},
        ${app.website ?? null},
        ${app.privacy_policy_url ?? null},
        ${app.terms_url ?? null},
        ${app.trust_status ?? (app.type === "third_party" ? "unverified" : "official")},
        ${app.review_status ?? "approved"},
        ${null},
        ${app.created_at},
        ${app.updated_at ?? null},
        ${app.disabled_at ?? null},
        ${app.disabled_by ?? null},
        ${app.revoked_by ?? null},
        ${app.revoked_at ?? null}
      )
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        type = excluded.type,
        status = excluded.status,
        publisher_id = excluded.publisher_id,
        website = excluded.website,
        privacy_policy_url = excluded.privacy_policy_url,
        terms_url = excluded.terms_url,
        trust_status = excluded.trust_status,
        review_status = excluded.review_status,
        updated_at = excluded.updated_at,
        disabled_at = excluded.disabled_at,
        disabled_by = excluded.disabled_by,
        revoked_by = excluded.revoked_by,
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

    await this.persistGrantQuery(sql, grant);
  }

  private persistGrantQuery(sql: any, grant: GrantRecord) {
    return sql`
      insert into app_device_channel_grants (
        id,
        workspace_id,
        app_id,
        device_id,
        name,
        description,
        allowed_channels,
        queueing_allowed,
        created_from_consent_request_id,
        created_by,
        created_at,
        updated_at,
        revoked_by,
        revoked_at
      ) values (
        ${grant.id},
        ${grant.workspace_id},
        ${grant.app_id},
        ${grant.device_id},
        ${grant.name ?? null},
        ${grant.description ?? null},
        ${grant.allowed_channels},
        ${grant.queueing_allowed},
        ${grant.created_from_consent_request_id ?? null},
        ${null},
        ${grant.created_at},
        ${grant.updated_at ?? null},
        ${grant.revoked_by ?? null},
        ${grant.revoked_at ?? null}
      )
      on conflict (id) do update set
        name = excluded.name,
        description = excluded.description,
        allowed_channels = excluded.allowed_channels,
        queueing_allowed = excluded.queueing_allowed,
        created_from_consent_request_id = excluded.created_from_consent_request_id,
        updated_at = excluded.updated_at,
        revoked_by = excluded.revoked_by,
        revoked_at = excluded.revoked_at
    `;
  }

  private async persistAuditEvent(event: AuditEventRecord) {
    const sql = this.neon();
    if (!sql) return;

    await this.persistAuditEventQuery(sql, event);
  }

  private persistAuditEventQuery(sql: any, event: AuditEventRecord) {
    return sql`
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

  private neonRequired() {
    const sql = this.neon();
    if (!sql) {
      return Response.json({ error: "neon required for hosted trust state" }, { status: 503 });
    }
    return sql;
  }

  private async hostedApp(appId: string): Promise<AppRecord | undefined> {
    const sql = this.neon();
    if (!sql) return undefined;
    return (await sql`
      select *
      from apps
      where id = ${appId}
      limit 1
    ` as AppRecord[])[0];
  }

  private async hostedDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    const sql = this.neon();
    if (!sql) return undefined;
    return (await sql`
      select *
      from devices
      where id = ${deviceId}
      limit 1
    ` as DeviceRecord[])[0];
  }

  private async hostedPublisher(publisherId: string): Promise<PublisherRecord | undefined> {
    const sql = this.neon();
    if (!sql) return undefined;
    return (await sql`
      select *
      from publisher_profiles
      where id = ${publisherId}
      limit 1
    ` as PublisherRecord[])[0];
  }

  private async hostedConsent(consentId: string): Promise<ConsentRequestRecord | undefined> {
    const sql = this.neon();
    if (!sql) return undefined;
    return (await sql`
      select *
      from consent_requests
      where id = ${consentId}
      limit 1
    ` as ConsentRequestRecord[])[0];
  }

  private async hostedGrant(grantId: string): Promise<GrantRecord | undefined> {
    const sql = this.neon();
    if (!sql) return undefined;
    return (await sql`
      select *
      from app_device_channel_grants
      where id = ${grantId}
      limit 1
    ` as GrantRecord[])[0];
  }

  private async hostedPermissionDeclarations(appId: string): Promise<PermissionDeclarationRecord[]> {
    const sql = this.neon();
    if (!sql) return [];
    return await sql`
      select *
      from app_permission_declarations
      where app_id = ${appId}
      order by created_at asc
    ` as PermissionDeclarationRecord[];
  }

  private async hostedDeclaresChannel(appId: string, channel: string): Promise<boolean> {
    const declarations = await this.hostedPermissionDeclarations(appId);
    if (declarations.length === 0) return false;
    return declarations.some((declaration) => declaration.channels.includes(channel));
  }

  private async hostedAppGrants(appId: string): Promise<GrantRecord[]> {
    const sql = this.neon();
    if (!sql) return [];
    return await sql`
      select *
      from app_device_channel_grants
      where app_id = ${appId}
      order by created_at desc
    ` as GrantRecord[];
  }

  private async hostedDeviceGrants(deviceId: string): Promise<GrantRecord[]> {
    const sql = this.neon();
    if (!sql) return [];
    return await sql`
      select *
      from app_device_channel_grants
      where device_id = ${deviceId}
      order by created_at desc
    ` as GrantRecord[];
  }

  private async hostedAppReports(appId: string): Promise<AppAbuseReportRecord[]> {
    const sql = this.neon();
    if (!sql) return [];
    return await sql`
      select *
      from app_abuse_reports
      where app_id = ${appId}
      order by created_at desc
    ` as AppAbuseReportRecord[];
  }

  private async hostedAppView(app: AppRecord | any) {
    const publisher = app.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
    const grants = await this.hostedAppGrants(app.id);
    return {
      ...app,
      publisher,
      permission_declarations: await this.hostedPermissionDeclarations(app.id),
      authorized_device_count: new Set(grants.filter((grant) => !grant.revoked_at).map((grant) => grant.device_id)).size,
      allowed_channel_count: new Set(grants.filter((grant) => !grant.revoked_at).flatMap((grant) => grant.allowed_channels)).size,
    };
  }

  private async grantView(grant: GrantRecord) {
    return {
      ...grant,
      status: grant.revoked_at ? "revoked" : "active",
      app: await this.hostedApp(grant.app_id) ?? await this.getMapItem<AppRecord>("apps", grant.app_id),
      device: await this.hostedDevice(grant.device_id) ?? await this.getMapItem<DeviceRecord>("devices", grant.device_id),
    };
  }

  private async createAppApiKey(app: AppRecord, name: string): Promise<{ secret: string; key: AppApiKeyRecord }> {
    const sql = this.neonRequired();
    if (sql instanceof Response) throw new Error("neon required for hosted trust state");
    const secret = `musubi_app_sk_${randomBase64Url(24)}`;
    const key: AppApiKeyRecord = {
      id: generatedId("appapikey"),
      app_id: app.id,
      name,
      prefix: secret.slice(0, 18),
      key_hash: await sha256Hex(secret),
      status: "active",
      created_at: new Date().toISOString(),
    };
    await sql`
      insert into app_api_keys (
        id, app_id, name, prefix, key_hash, status, created_at
      ) values (
        ${key.id}, ${key.app_id}, ${key.name}, ${key.prefix}, ${key.key_hash}, ${key.status}, ${key.created_at}
      )
    `;
    await this.audit("user", "user_local", "app_api_key.created", {
      workspace_id: app.workspace_id,
      app_id: app.id,
      metadata: { app_api_key_id: key.id, prefix: key.prefix },
    });
    return { secret, key };
  }

  private appApiKeyView(key: AppApiKeyRecord) {
    const { key_hash: _keyHash, ...view } = key;
    return view;
  }

  private async authenticateAppRequest(request: Request): Promise<AppAuth | Response> {
    const token = readBearer(request);
    if (!token) return Response.json({ error: "missing app api key" }, { status: 401 });
    const sql = this.neonRequired();
    if (sql instanceof Response) return sql;
    const keyHash = await sha256Hex(token);
    const apiKey = (await sql`
      select *
      from app_api_keys
      where key_hash = ${keyHash}
        and status = 'active'
      limit 1
    ` as AppApiKeyRecord[])[0];
    if (!apiKey) return Response.json({ error: "invalid app api key" }, { status: 401 });
    const app = await this.hostedApp(apiKey.app_id);
    if (!app || app.status !== "active") return Response.json({ error: app?.status === "suspended" ? "app suspended" : "app denied" }, { status: 403 });
    if (app.trust_status === "blocked") return Response.json({ error: "app blocked" }, { status: 403 });
    const publisher = app.publisher_id ? await this.hostedPublisher(app.publisher_id) : undefined;
    if (publisher?.verification_status === "suspended") return Response.json({ error: "publisher suspended" }, { status: 403 });
    await sql`
      update app_api_keys
      set last_used_at = ${new Date().toISOString()}
      where id = ${apiKey.id}
    `;
    return { app, apiKey };
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

const HOSTED_PLUGIN_NAMES = ["echo", "hermes", "codex", "community-signed", "community-unsigned"];
const HOSTED_PLUGIN_SIGNING_KEY_ID = "pluginkey_musubi_hosted";
const HOSTED_PLUGIN_SIGNING_PUBLIC_KEY = "MCowBQYDK2VwAyEADF5vh2Howbqtkfpc73jOz9EgrXsiV7cCx9VVhVKuuks=";
const HOSTED_PLUGIN_LATEST_BY_NAME: Record<string, string> = {
  echo: "0.1.0",
  hermes: "0.1.0",
  codex: "0.3.0",
  "community-signed": "1.0.0",
  "community-unsigned": "1.0.0",
};
const HOSTED_PLUGIN_REGISTRY: Record<string, {
  version: string;
  trust: string;
  channels: string[];
  permissions: string[];
  package_digest: string;
  signed_payload: string;
  signature: string;
  signature_status: "verified" | "invalid" | "unsigned";
}> = {
  "codex@0.2.5": {
    version: "0.2.5",
    trust: "official",
    channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
    permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
    package_digest: "sha256:f45a11b2380474b6a546d09fe3d1a3a14e5ec14184600d1cf5ae7ac0a5403aee",
    signed_payload: "codex|0.2.5|5ade71883bff64709b8e86c9db0408190df42d9816a5beb9fcd5d1a983b2f2d5",
    signature: "i+5/zri1IJ8NxrjPaKcZ3qgTjcBEtD8yMv6x75iSNpvKV3BQhdK6i855i00xivPo7/cAoBUShhk88j9mRoTWCA==",
    signature_status: "verified",
  },
  "codex@0.3.0": {
    version: "0.3.0",
    trust: "official",
    channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
    permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound", "fs.write.any"],
    package_digest: "sha256:114700cdc1cead4023cd7390e9dc5e1b81cf6b23e27dc89f232d40c30eaa54a0",
    signed_payload: "codex|0.3.0|d6c6ce7a5922ecbfcfc9c870045fef543ff000f2d5b67f602713d73e79ed0c28",
    signature: "EZi34q/gUmqhN8a3DerHO+l1vSTIYVMpjO/DxQVPuhRalD0rfpgxKT79HYjvy0qMq7n4MJHAdH3Tppwy+XUPDw==",
    signature_status: "verified",
  },
  "codex@tampered": {
    version: "tampered",
    trust: "official",
    channels: ["codex.task.create"],
    permissions: ["process.spawn"],
    package_digest: "sha256:19bcb761acd18593b64bd27b0d3a00fbb0ecfae2c634cd2bb80b0b9d72aad81b",
    signed_payload: "codex|tampered|80f8c9d4dc67f79e5a4129f47a80ede81d6172849fcd65a2d264e9d3f0231f7c",
    signature: "xkdr47+dsa0BkHt4stX/V8tD9djSY5vnLtn/apO7KBodShuLcNw0Y0/7Kqp5yBWMp2p4sCixDXSmsvaslslaDQxx",
    signature_status: "invalid",
  },
  "echo@0.1.0": {
    version: "0.1.0",
    trust: "official",
    channels: ["echo.echo", "echo.ping"],
    permissions: ["status.report"],
    package_digest: "sha256:91a5f6eda390ea588e9a831d44af522ca088168622aaa0243c74cc45541049cf",
    signed_payload: "echo|0.1.0|434af7c4b02316f48bac7a94e4f3e075bf38749df80f5f8a326f0c778cbf33c1",
    signature: "Tz8gDIUfmknIbjfFuHspQksSsKlx8VLKfZodo2x9IrQnE9lSgdMcA2be4H+Ol5UOOvd3Y2pKrLR30gnv7poJAQ==",
    signature_status: "verified",
  },
  "hermes@0.1.0": {
    version: "0.1.0",
    trust: "official",
    channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
    permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
    package_digest: "sha256:07ce6a3f2e540092c9eee6254f7cefcfdb718bcd14e38436b4d4e9a45e824d97",
    signed_payload: "hermes|0.1.0|564398536c9c474907ca0bc204cb8db9db04ba78a2c9583be892a9456679ed99",
    signature: "LbFgZEVyTcna1bdN3bTwIIubIC6SCl0vYrw8PGnGYMGrOvt4Bb8X5RcvlpV1GyeIPJHOe/6iMlNlBBjOAQ/qCg==",
    signature_status: "verified",
  },
  "community-signed@1.0.0": {
    version: "1.0.0",
    trust: "community",
    channels: ["community.run"],
    permissions: ["process.spawn"],
    package_digest: "sha256:4486bc69be1b8672e2d3cca51f5c3ac7532a04899c349c90b34120ec1c264e63",
    signed_payload: "community-signed|1.0.0|a1fd19dd525ff1826dbca9f6da7de0472095ada1f0cc4cf63916af3d8598535f",
    signature: "MoIUViA5UNLYsMIl0FrkIv3lTNxuPFlJo3Buxj7DHBiAOg/9BqTBkS66+8cje2fOJKig/rmi06LAUSK2r1RXCg==",
    signature_status: "verified",
  },
  "community-unsigned@1.0.0": {
    version: "1.0.0",
    trust: "community",
    channels: ["community.run"],
    permissions: ["process.spawn.any"],
    package_digest: "sha256:d804719b90b2f2e6310e088bb5d4f4d9de7b99e359e030e5e8972aacd101558c",
    signed_payload: "community-unsigned|1.0.0|18bbe856307aae9659e1a26c3cec2c04fa8d682d4368bd990e9a1c79c88d7da8",
    signature: "",
    signature_status: "unsigned",
  },
};

function defaultWorkspacePluginPolicy(): WorkspacePluginPolicyRecord {
  return {
    require_signature: true,
    allowed_trust_levels: ["official", "verified"],
    allowed_plugins: ["echo", "hermes", "codex"],
    blocked_plugins: [],
    require_approval_for_permission_increase: true,
  };
}

function registryPluginResponse(name: string, version = "latest") {
  const resolved = registryVersion(name, version);
  if (!resolved) return undefined;
  const manifest = resolved.manifest as { publisher?: unknown };
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
      signing_public_key: HOSTED_PLUGIN_SIGNING_PUBLIC_KEY,
      signature_status: resolved.signature_status,
    },
  };
}

function registryVersion(name: string, version = "latest"): RegistryPluginVersion | undefined {
  const resolved = version === "latest" ? HOSTED_PLUGIN_LATEST_BY_NAME[name] : version;
  const seed = HOSTED_PLUGIN_REGISTRY[`${name}@${resolved}`];
  if (!seed) return undefined;
  return {
    version: seed.version,
    manifest: pluginManifestV2(name, seed.version, seed.trust, seed.channels, seed.permissions),
    package_url: `registry://plugins/${name}/${seed.version}`,
    package_digest: seed.package_digest,
    signed_payload: seed.signed_payload,
    signature: seed.signature,
    signing_key_id: HOSTED_PLUGIN_SIGNING_KEY_ID,
    signature_status: seed.signature_status,
  };
}

function pluginManifestV2(name: string, version: string, trust: string, channels: string[], permissions: string[]) {
  return {
    name,
    version,
    publisher: {
      id: trust === "official" ? "plugpub_musubi" : "plugpub_community",
      name: trust === "official" ? "Musubi" : "Community",
      trust,
    },
    description: `${name} plugin package`,
    runtime: "bun",
    entry: `bun run plugins/${name}/src/main.ts`,
    channels,
    event_channels: channels.some((channel) => channel.includes("codex"))
      ? ["codex.task.event"]
      : channels.some((channel) => channel.includes("hermes"))
        ? ["hermes.task.event"]
        : [],
    permissions,
    config_schema: {},
  };
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

function groupBy<T>(items: T[], keyFor: (item: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = keyFor(item);
    if (!value) continue;
    const group = grouped.get(value) ?? [];
    group.push(item);
    grouped.set(value, group);
  }
  return grouped;
}

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readBearer(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

function generatedId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function callbackUrl(base: string, state: string | undefined, status: string, grantId?: string): string {
  const url = new URL(base);
  url.searchParams.set("status", status);
  if (state) url.searchParams.set("state", state);
  if (grantId) url.searchParams.set("grant_id", grantId);
  return url.toString();
}
