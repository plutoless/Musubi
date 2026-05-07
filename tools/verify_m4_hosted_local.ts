import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { MusubiApp, generateX25519KeyPair, hermesPayload } from "../sdk/app-js/src/index.ts";
import { loadEnvFiles } from "./env.ts";
import {
  assertApiKeyList,
  assertAppDetail,
  assertConsentDetail,
  assertDeviceDetail,
  assertMessageDetail,
} from "./api_contract_assertions.ts";

loadEnvFiles();
const databaseUrl = process.env.NEON_DATABASE_URL;

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

let port = randomPort();
let serverUrl = `http://127.0.0.1:${port}`;
const workspaceId = `ws_m4_hosted_local_${Date.now()}`;
const sql = databaseUrl ? neon(databaseUrl) : undefined;

if (import.meta.main) {
  if (!databaseUrl) {
    throw new Error("NEON_DATABASE_URL is required for verify:m4-hosted-local. Set it in the shell or in .env.local; see .env.example.");
  }
  await run("bun", ["run", "db:migrate:neon"]);

  let worker = startWorker();
  try {
    await waitForHealth();
    const result = await runHostedFlow(serverUrl, workspaceId);

    await stopWorker(worker);
    port = randomPort();
    serverUrl = `http://127.0.0.1:${port}`;
    worker = startWorker();
    await waitForHealth();

    const resumedConsent = await requestJson<any>(`${serverUrl}/v1/consent-requests/${result.consentId}`);
    if (resumedConsent.consent_request.status !== "approved") throw new Error("hosted consent did not survive Worker restart");
    const resumedGrants = await requestJson<any>(`${serverUrl}/v1/grants?app_id=${result.appId}`);
    if (!resumedGrants.grants.find((grant: any) => grant.id === result.grantId && grant.status === "active")) {
      throw new Error("hosted grant was not readable after Worker restart");
    }
    const resumedAuthorized = await requestJson<any>(`${serverUrl}/v1/authorized-apps`);
    if (!JSON.stringify(resumedAuthorized).includes(result.appId)) throw new Error("authorized app view was not readable after Worker restart");
    const resumedClient = new MusubiApp({
      apiBaseUrl: serverUrl,
      appId: result.appId,
      appKeyId: result.appKeyId,
      apiKey: result.apiKey,
      privateKey: result.privateKey,
      workspaceId,
    });
    await expectDenied(() => resumedClient.devices.listGranted(), "suspended app auth did not remain denied after Worker restart");
  } finally {
    await stopWorker(worker);
  }

  console.log("[m4-hosted-local] ok: hosted M4 trust APIs use Neon-backed state across Worker restart");
  process.exit(0);
}

function startWorker(): ChildProcessWithoutNullStreams {
  const child = spawn("bunx", ["wrangler", "dev", "--ip", "127.0.0.1", "--port", port, "--var", `NEON_DATABASE_URL:${databaseUrl}`], {
    cwd: `${process.cwd()}/server/workers`,
    env: {
      ...process.env,
      TMPDIR: `${process.cwd()}/.cache/tmp`,
      BUN_INSTALL_CACHE_DIR: `${process.cwd()}/.cache/bun`,
      NEON_DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopWorker(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
    setTimeout(resolve, 2_000);
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await requestJson<any>(`${serverUrl}/v1/health`);
      if (health.ok && health.neon_configured) return;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error("hosted local Worker did not become healthy with Neon configured");
}

export async function runHostedFlow(apiBaseUrl: string, workspace: string) {
  if (!databaseUrl || !sql) {
    throw new Error("NEON_DATABASE_URL is required for hosted M4 verification. Set it in the shell or in .env.local; see .env.example.");
  }
  const deviceKeys = generateX25519KeyPair();
  const appKeys = generateX25519KeyPair();
  const device = await postJson<any>(`${apiBaseUrl}/v1/devices/register`, {
    workspace_id: workspace,
    device_name: "Hosted M4 Device",
    platform: "darwin-arm64",
    cli_version: "0.1.0",
    public_key: deviceKeys.publicKey,
  });
  await postJson(`${apiBaseUrl}/v1/devices/${device.device_id}/capabilities`, {
    plugins: [{
      name: "hermes",
      version: "0.1.0",
      channels: ["hermes.task.create"],
      permissions: ["process.spawn"],
      manifest: { trust_level: "official", signature_status: "verified" },
    }],
  });

  const developer = await postJson<any>(`${apiBaseUrl}/v1/developers`, { name: "Hosted M4 Developer", email: "hosted-m4@example.test" });
  if (!developer.developer?.id) {
    throw new Error(`hosted M4 developer route returned unexpected shape; deploy the current Worker code. Response: ${JSON.stringify(redactSecrets(developer))}`);
  }
  const publisher = await postJson<any>(`${apiBaseUrl}/v1/publishers`, {
    developer_id: developer.developer.id,
    display_name: "Hosted M4 Publisher",
    website: "https://example.test",
    privacy_policy_url: "https://example.test/privacy",
  });
  await patchJson(`${apiBaseUrl}/v1/publishers/${publisher.publisher.id}`, { verification_status: "verified" });
  const app = await postJson<any>(`${apiBaseUrl}/v1/developer/apps`, {
    workspace_id: workspace,
    name: "Hosted M4 Hermes App",
    publisher_id: publisher.publisher.id,
    public_key: appKeys.publicKey,
    privacy_policy_url: "https://example.test/privacy",
  });
  if (!app.app_id || !app.app_key_id || !app.api_key_record?.id) {
    throw new Error(`hosted M4 app route returned unexpected shape; deploy the current Worker code. Response: ${JSON.stringify(redactSecrets(app))}`);
  }
  if (!app.api_key?.startsWith("musubi_app_sk_")) throw new Error("hosted developer app did not return API key");
  const seedAppId = app.app_id;
  const seedAppApiKey = app.api_key;
  const extraKey = await postJson<any>(`${apiBaseUrl}/v1/developer/apps/${app.app_id}/api-keys`, { name: "Hosted verifier key" });
  if (!extraKey.api_key?.startsWith("musubi_app_sk_")) throw new Error("hosted app API key creation failed");

  await postJson(`${apiBaseUrl}/v1/developer/apps/${app.app_id}/permission-declarations`, {
    plugin_name: "hermes",
    channels: ["hermes.task.create"],
    reason: "Run queued hosted verifier task",
    queueing_requested: true,
  });
  const extraDeviceKeys = generateX25519KeyPair();
  const secondaryDevice = await postJson<any>(`${apiBaseUrl}/v1/devices/register`, {
    workspace_id: workspace,
    device_name: "Hosted M4 Device 2",
    platform: "darwin-arm64",
    cli_version: "0.1.0",
    public_key: extraDeviceKeys.publicKey,
  });
  await postJson(`${apiBaseUrl}/v1/devices/${secondaryDevice.device_id}/capabilities`, {
    plugins: [{
      name: "echo",
      version: "0.1.0",
      channels: ["echo.task.echo"],
      permissions: ["process.spawn"],
      manifest: { trust_level: "official", signature_status: "verified" },
    }],
  });
  const secondDeveloper = await postJson<any>(`${apiBaseUrl}/v1/developers`, { name: "Hosted M4 Developer 2", email: "hosted-m4-2@example.test" });
  const secondPublisher = await postJson<any>(`${apiBaseUrl}/v1/publishers`, {
    developer_id: secondDeveloper.developer.id,
    display_name: "Hosted M4 Publisher 2",
    website: "https://example2.test",
    privacy_policy_url: "https://example2.test/privacy",
  });
  await patchJson(`${apiBaseUrl}/v1/publishers/${secondPublisher.publisher.id}`, { verification_status: "verified" });
  const secondaryApp = await postJson<any>(`${apiBaseUrl}/v1/developer/apps`, {
    workspace_id: workspace,
    name: "Hosted M4 Secondary App",
    publisher_id: secondPublisher.publisher.id,
    public_key: generateX25519KeyPair().publicKey,
    privacy_policy_url: "https://example2.test/privacy",
  });
  if (!secondaryApp.app_id) {
    throw new Error(`hosted secondary app route returned unexpected shape; deploy the current Worker code. Response: ${JSON.stringify(redactSecrets(secondaryApp))}`);
  }
  await postJson(`${apiBaseUrl}/v1/developer/apps/${secondaryApp.app_id}/permission-declarations`, {
    plugin_name: "hermes",
    channels: ["hermes.task.create"],
    reason: "Secondary app verification app",
  });

  await postJson(`${apiBaseUrl}/v1/grants`, {
    workspace_id: workspace,
    app_id: seedAppId,
    device_id: secondaryDevice.device_id,
    allowed_channels: ["hermes.task.create"],
  });
  await postJson(`${apiBaseUrl}/v1/grants`, {
    workspace_id: workspace,
    app_id: secondaryApp.app_id,
    device_id: device.device_id,
    allowed_channels: ["hermes.task.create"],
  });
  assertDeviceDetail(await requestJson<any>(`${apiBaseUrl}/v1/devices/${device.device_id}`), device.device_id);
  assertDeviceDetail(await requestJson<any>(`${apiBaseUrl}/v1/devices/${secondaryDevice.device_id}`), secondaryDevice.device_id);
  assertAppDetail(await requestJson<any>(`${apiBaseUrl}/v1/apps/${seedAppId}`), seedAppId);
  assertAppDetail(await requestJson<any>(`${apiBaseUrl}/v1/apps/${secondaryApp.app_id}`), secondaryApp.app_id);
  assertApiKeyList(await requestJson<any>(`${apiBaseUrl}/v1/apps/${seedAppId}/api-keys`), seedAppId);

  const deniedConsent = await postJson<any>(`${apiBaseUrl}/v1/consent-requests`, {
    app_id: app.app_id,
    state: "deny",
    redirect_uri: "https://example.test/callback",
    requested_capabilities: [{ plugin: "hermes", channels: ["hermes.task.create"], reason: "denial proof" }],
  });
  assertConsentDetail(await requestJson<any>(`${apiBaseUrl}/v1/consent-requests/${deniedConsent.consent_request.id}`), deniedConsent.consent_request.id);
  const denied = await postJson<any>(`${apiBaseUrl}/v1/consent-requests/${deniedConsent.consent_request.id}/deny`, { reason: "user_declined" });
  if (denied.status !== "denied") throw new Error("hosted consent deny failed");
  assertConsentDetail(await requestJson<any>(`${apiBaseUrl}/v1/consent-requests/${deniedConsent.consent_request.id}`), deniedConsent.consent_request.id, "cancelled");

  const consent = await postJson<any>(`${apiBaseUrl}/v1/consent-requests`, {
    app_id: app.app_id,
    state: "approve",
    redirect_uri: "https://example.test/callback",
  });
  const consentDetail = await requestJson<any>(`${apiBaseUrl}/v1/consent-requests/${consent.consent_request.id}`);
  assertConsentDetail(consentDetail, consent.consent_request.id);
  if (consentDetail.publisher.display_name !== "Hosted M4 Publisher") throw new Error("hosted consent detail missed publisher");
  const approved = await postJson<any>(`${apiBaseUrl}/v1/consent-requests/${consent.consent_request.id}/approve`, {
    device_id: device.device_id,
    allowed_channels: ["hermes.task.create"],
    queueing_allowed: true,
  });
  if (!approved.grant_id) throw new Error("hosted consent approval did not create grant");
  assertConsentDetail(await requestJson<any>(`${apiBaseUrl}/v1/consent-requests/${consent.consent_request.id}`), consent.consent_request.id, "approved");

  const client = new MusubiApp({
    apiBaseUrl,
    appId: app.app_id,
    appKeyId: app.app_key_id,
    apiKey: app.api_key,
    privateKey: appKeys.privateKey,
    workspaceId: workspace,
  });
  const firstInvocation = await client.invoke({
    deviceId: device.device_id,
    channel: "hermes.task.create",
    payload: hermesPayload("HOSTED_M4_ENCRYPTED_PAYLOAD_1"),
  });
  assertMessageDetail(await requestJson<any>(`${apiBaseUrl}/v1/messages/${firstInvocation.messageId}`), firstInvocation.messageId, ["HOSTED_M4_ENCRYPTED_PAYLOAD_1"]);
  const devices = await client.devices.listGranted();
  if (!devices.length) throw new Error("hosted SDK did not list any granted device");
  if (!devices.some((entry: { id: string }) => entry.id === device.device_id)) {
    throw new Error("hosted SDK did not list primary granted device");
  }
  const appDevices = await requestJsonWithApiKey<any>(`${apiBaseUrl}/v1/app/devices?limit=1`, seedAppApiKey);
  if (!Array.isArray(appDevices.devices) || appDevices.devices.length !== 1 || appDevices.limit !== 1) {
    throw new Error("app-auth devices list did not honor limit=1");
  }
  if (!Array.isArray(appDevices.devices[0].allowed_channels) || typeof appDevices.devices[0].queueing_allowed !== "boolean") {
    throw new Error("app-auth devices list missing grant fields");
  }
  const appDevicePublicKey = await requestJsonWithApiKey<any>(`${apiBaseUrl}/v1/app/devices/${device.device_id}/public-key`, seedAppApiKey);
  if (appDevicePublicKey.public_key !== deviceKeys.publicKey || appDevicePublicKey.device_id !== device.device_id) {
    throw new Error("app-auth device public key route returned unexpected key");
  }
  const secondInvocation = await client.invoke({
    deviceId: device.device_id,
    channel: "hermes.task.create",
    payload: hermesPayload("HOSTED_M4_ENCRYPTED_PAYLOAD_2"),
  });
  assertMessageDetail(await requestJson<any>(`${apiBaseUrl}/v1/messages/${secondInvocation.messageId}`), secondInvocation.messageId, ["HOSTED_M4_ENCRYPTED_PAYLOAD_2"]);
  const pagedListSeedParams = { requireNextCursor: true };
  await expectPagedList(`${apiBaseUrl}/v1/devices?workspace_id=${workspace}`, "devices", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.workspace_id !== workspace) throw new Error("devices list failed workspace_id filter");
      if (typeof row.plugin_count !== "number") throw new Error("devices list omitted plugin_count");
      if (typeof row.authorized_app_count !== "number") throw new Error("devices list omitted authorized_app_count");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/apps?type=third_party&status=active`, "apps", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.type !== "third_party" || row.status !== "active") throw new Error("apps list failed filter on type/status");
      if (typeof row.authorized_device_count !== "number") throw new Error("apps list omitted authorized_device_count");
      if (typeof row.allowed_channel_count !== "number") throw new Error("apps list omitted allowed_channel_count");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/grants?app_id=${seedAppId}`, "grants", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.app_id !== seedAppId) throw new Error("grants list filter did not persist");
      if (!row.app || !row.device) throw new Error("grants list missing app/device enrichment");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/messages?app_id=${seedAppId}`, "messages", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.app_id !== seedAppId) throw new Error("messages list filter did not persist");
      if (!row.id) throw new Error("messages list omitted id");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/audit-events?event_type=message.created`, "audit_events", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.event_type !== "message.created") throw new Error("audit list filter did not persist");
      if (!row.id) throw new Error("audit events missing id");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/device-plugin-capabilities`, "capabilities", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (!row.plugin_name || !row.device_id) throw new Error("device-plugin-capabilities row is missing enrichment");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/authorized-apps`, "authorized_apps", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (!row.app || !row.app.id) throw new Error("authorized apps missing app payload");
      if (!Array.isArray(row.grants)) throw new Error("authorized apps missing grant list");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/developers?status=active`, "developers", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.status !== "active") throw new Error("developers filter did not persist");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/publishers?verification_status=verified`, "publishers", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.verification_status !== "verified") throw new Error("publishers filter did not persist");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/apps/${seedAppId}/api-keys`, "api_keys", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (row.app_id !== seedAppId) throw new Error("app api keys list omitted app_id");
      if ("key_hash" in row || "api_key" in row) throw new Error("app api keys list exposed secret material");
    },
  });
  await expectPagedList(`${apiBaseUrl}/v1/app/devices`, "devices", {
    ...pagedListSeedParams,
    validateRow: (row) => {
      if (!row.id) throw new Error("app devices list omitted id");
      if (!Array.isArray(row.allowed_channels)) throw new Error("app devices list missing allowed_channels");
    },
    requestJson: (url) => requestJsonWithApiKey(url, seedAppApiKey),
  });

  await patchJson(`${apiBaseUrl}/v1/publishers/${publisher.publisher.id}`, { verification_status: "suspended" });
  await expectDenied(() => client.invoke({
    deviceId: device.device_id,
    channel: "hermes.task.create",
    payload: hermesPayload("HOSTED_M4_PUBLISHER_SUSPENDED"),
  }), "publisher suspension did not block hosted SDK send");
  await patchJson(`${apiBaseUrl}/v1/publishers/${publisher.publisher.id}`, { verification_status: "verified" });

  await postJson(`${apiBaseUrl}/v1/grants/${approved.grant_id}/revoke`, {});
  await expectDenied(() => client.invoke({
    deviceId: device.device_id,
    channel: "hermes.task.create",
    payload: hermesPayload("HOSTED_M4_REVOKED"),
  }), "grant revoke did not block hosted SDK send");

  const secondConsent = await postJson<any>(`${apiBaseUrl}/v1/consent-requests`, { app_id: app.app_id });
  const secondApproved = await postJson<any>(`${apiBaseUrl}/v1/consent-requests/${secondConsent.consent_request.id}/approve`, {
    device_id: device.device_id,
    allowed_channels: ["hermes.task.create"],
    queueing_allowed: true,
  });
  await postJson(`${apiBaseUrl}/v1/apps/${app.app_id}/report`, { reason: "suspicious", description: "hosted verifier report" });
  await postJson(`${apiBaseUrl}/v1/apps/${app.app_id}/suspend`, {});
  await expectDenied(() => client.devices.listGranted(), "app suspension did not block hosted SDK auth");

  await assertNeonRows({
    developerId: developer.developer.id,
    publisherId: publisher.publisher.id,
    appId: app.app_id,
    appKeyId: app.app_key_id,
    apiKeyId: app.api_key_record.id,
    consentId: consent.consent_request.id,
    grantId: approved.grant_id,
    deviceId: device.device_id,
  });

  return {
    appId: app.app_id,
    appKeyId: app.app_key_id,
    apiKey: app.api_key,
    privateKey: appKeys.privateKey,
    consentId: secondConsent.consent_request.id,
    grantId: secondApproved.grant_id,
  };
}

async function assertNeonRows(ids: Record<string, string>) {
  for (const [label, query] of Object.entries({
    developer: sql`select id from developer_accounts where id = ${ids.developerId}`,
    publisher: sql`select id from publisher_profiles where id = ${ids.publisherId}`,
    app: sql`select id from apps where id = ${ids.appId}`,
    appKey: sql`select id from app_keys where id = ${ids.appKeyId}`,
    apiKeyHash: sql`select id from app_api_keys where id = ${ids.apiKeyId} and key_hash is not null`,
    permissionDeclaration: sql`select id from app_permission_declarations where app_id = ${ids.appId}`,
    consent: sql`select id from consent_requests where id = ${ids.consentId} and status = 'approved'`,
    grant: sql`select id from app_device_channel_grants where id = ${ids.grantId}`,
    report: sql`select id from app_abuse_reports where app_id = ${ids.appId}`,
    message: sql`select id from messages where app_id = ${ids.appId}`,
    audit: sql`select id from audit_events where app_id = ${ids.appId}`,
  })) {
    const rows = await query as any[];
    if (rows.length === 0) throw new Error(`missing Neon row for ${label}`);
  }
  const plaintextLeaks = await sql`
    select id
    from audit_events
    where app_id = ${ids.appId}
      and metadata::text like '%HOSTED_M4_%'
    limit 1
  ` as any[];
  if (plaintextLeaks.length) throw new Error("hosted audit metadata leaked plaintext payload");
}

async function expectDenied(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
    throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
  }
}

type RequestJsonFn = (url: string) => Promise<any>;

interface PagedListExpectOptions {
  requireNextCursor?: boolean;
  requestJson?: RequestJsonFn;
  idForRow?: (row: any) => string;
  validateRow?: (row: any) => void;
}

async function expectPagedList(url: string, key: string, options: PagedListExpectOptions = {}) {
  const requestJsonFn = options.requestJson ?? requestJson;
  const idForRow = options.idForRow ?? ((row: unknown) => (row as { id?: string })?.id ?? "");
  const firstUrl = new URL(url);
  firstUrl.searchParams.set("limit", "1");
  const first = await requestJsonFn(firstUrl.toString()) as Record<string, unknown>;
  const firstRows = Array.isArray(first[key]) ? first[key] as unknown[] : [];
  if (firstRows.length !== 1) {
    throw new Error(`${key} first page did not honor limit=1 (received ${firstRows.length})`);
  }
  for (const row of firstRows) {
    options.validateRow?.(row);
  }
  if (options.requireNextCursor && typeof first.next_cursor !== "string") {
    throw new Error(`${key} first page did not return next_cursor`);
  }
  if (!first.next_cursor) return;

  const secondUrl = new URL(url);
  secondUrl.searchParams.set("limit", "1");
  secondUrl.searchParams.set("cursor", String(first.next_cursor));
  const second = await requestJsonFn(secondUrl.toString()) as Record<string, unknown>;
  const secondRows = Array.isArray(second[key]) ? second[key] as unknown[] : [];
  if (secondRows.length !== 1) {
    throw new Error(`${key} second page did not honor limit=1 (received ${secondRows.length})`);
  }
  for (const row of secondRows) {
    options.validateRow?.(row);
  }
  const firstId = idForRow(firstRows[0]);
  const secondId = idForRow(secondRows[0]);
  if (firstId && secondId && firstId === secondId) {
    throw new Error(`${key} pagination cursor returned duplicated row`);
  }
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function requestJsonWithApiKey<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function patchJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PATCH ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function run(command: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NEON_DATABASE_URL: databaseUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}${stderr}`;
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  return output;
}

function randomPort() {
  return String(36000 + Math.floor(Math.random() * 1000));
}

function redactSecrets(value: unknown) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (typeof key === "string" && key.toLowerCase().includes("key")) return "[redacted]";
    return item;
  }));
}
