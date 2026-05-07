import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { MusubiApp, generateX25519KeyPair, hermesPayload } from "../sdk/app-js/src/index.ts";
import { loadEnvFiles } from "./env.ts";

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
  const extraKey = await postJson<any>(`${apiBaseUrl}/v1/developer/apps/${app.app_id}/api-keys`, { name: "Hosted verifier key" });
  if (!extraKey.api_key?.startsWith("musubi_app_sk_")) throw new Error("hosted app API key creation failed");

  await postJson(`${apiBaseUrl}/v1/developer/apps/${app.app_id}/permission-declarations`, {
    plugin_name: "hermes",
    channels: ["hermes.task.create"],
    reason: "Run queued hosted verifier task",
    queueing_requested: true,
  });
  const deniedConsent = await postJson<any>(`${apiBaseUrl}/v1/consent-requests`, {
    app_id: app.app_id,
    state: "deny",
    redirect_uri: "https://example.test/callback",
    requested_capabilities: [{ plugin: "hermes", channels: ["hermes.task.create"], reason: "denial proof" }],
  });
  const denied = await postJson<any>(`${apiBaseUrl}/v1/consent-requests/${deniedConsent.consent_request.id}/deny`, { reason: "user_declined" });
  if (denied.status !== "denied") throw new Error("hosted consent deny failed");

  const consent = await postJson<any>(`${apiBaseUrl}/v1/consent-requests`, {
    app_id: app.app_id,
    state: "approve",
    redirect_uri: "https://example.test/callback",
  });
  const consentDetail = await requestJson<any>(`${apiBaseUrl}/v1/consent-requests/${consent.consent_request.id}`);
  if (consentDetail.publisher.display_name !== "Hosted M4 Publisher") throw new Error("hosted consent detail missed publisher");
  const approved = await postJson<any>(`${apiBaseUrl}/v1/consent-requests/${consent.consent_request.id}/approve`, {
    device_id: device.device_id,
    allowed_channels: ["hermes.task.create"],
    queueing_allowed: true,
  });
  if (!approved.grant_id) throw new Error("hosted consent approval did not create grant");

  const client = new MusubiApp({
    apiBaseUrl,
    appId: app.app_id,
    appKeyId: app.app_key_id,
    apiKey: app.api_key,
    privateKey: appKeys.privateKey,
    workspaceId: workspace,
  });
  const devices = await client.devices.listGranted();
  if (devices.length !== 1 || devices[0].id !== device.device_id) throw new Error("hosted SDK did not list granted device");
  await client.invoke({
    deviceId: device.device_id,
    channel: "hermes.task.create",
    payload: hermesPayload("HOSTED_M4_ENCRYPTED_PAYLOAD"),
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

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
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
