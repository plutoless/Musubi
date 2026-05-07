import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";
import { MusubiApp, codexPayload, generateX25519KeyPair } from "../sdk/app-js/src/index.ts";

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

const port = String(35000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/m4-platform-trust`;
const workspace = process.cwd();

await rm(home, { recursive: true, force: true });
await assertArtifacts();

const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ChildProcessWithoutNullStreams | undefined;

try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local", "--name", "M4 Trust Mac"]);

  const install = await run("go", ["run", "./cmd/musubi", "plugin", "install", "codex", "--server", serverUrl, "--home", home, "--version", "0.2.5", "--yes"]);
  mustInclude(install, "Signature: verified", "plugin install did not show signature review");
  mustInclude(install, "Requested permissions:", "plugin install did not show permission review");

  await patchJson(`${serverUrl}/v1/workspace/plugin-policy`, {
    allowed_plugins: ["echo", "hermes", "codex", "community-unsigned"],
    allowed_trust_levels: ["official", "verified", "community"],
  });
  const unsigned = await runWithStatus("go", ["run", "./cmd/musubi", "plugin", "install", "community-unsigned", "--server", serverUrl, "--home", home, "--yes"]);
  if (unsigned.status === 0 || !unsigned.output.includes("unsigned plugin blocked")) throw new Error("unsigned plugin was not blocked by signature policy");

  const tampered = await runWithStatus("go", ["run", "./cmd/musubi", "plugin", "install", "codex", "--server", serverUrl, "--home", home, "--version", "tampered", "--yes"]);
  if (tampered.status === 0 || !tampered.output.includes("signature verification failed")) throw new Error("tampered plugin was not blocked by signature verification");

  await patchJson(`${serverUrl}/v1/workspace/plugin-policy`, {
    allowed_plugins: ["echo", "hermes", "codex", "community-signed"],
    allowed_trust_levels: ["official", "verified"],
  });
  const community = await runWithStatus("go", ["run", "./cmd/musubi", "plugin", "install", "community-signed", "--server", serverUrl, "--home", home, "--yes"]);
  if (community.status === 0 || !community.output.includes("workspace plugin policy requires trusted publisher")) {
    throw new Error("workspace policy did not block untrusted signed plugin");
  }
  await patchJson(`${serverUrl}/v1/workspace/plugin-policy`, {
    allowed_plugins: ["echo", "hermes", "codex"],
    allowed_trust_levels: ["official", "verified"],
  });

  const update = await run("go", ["run", "./cmd/musubi", "plugin", "update-check", "codex", "--server", serverUrl, "--home", home]);
  mustInclude(update, "codex 0.2.5 -> 0.3.0", "update check did not show latest version");
  mustInclude(update, "fs.write.any", "update check did not show permission increase");

  const keyPair = generateX25519KeyPair();
  const developer = await postJson<any>(`${serverUrl}/v1/developers`, { name: "M4 Developer", email: "m4@example.test" });
  const publisher = await postJson<any>(`${serverUrl}/v1/publishers`, {
    developer_id: developer.developer.id,
    display_name: "M4 Publisher",
    website: "https://example.test",
    privacy_policy_url: "https://example.test/privacy",
  });
  const app = await postJson<any>(`${serverUrl}/v1/developer/apps`, {
    workspace_id: "ws_local",
    name: "M4 Third-party Codex",
    type: "third_party",
    publisher_id: publisher.publisher.id,
    public_key: keyPair.publicKey,
    privacy_policy_url: "https://example.test/privacy",
  });
  const apiKey = app.api_key;
  if (!apiKey?.startsWith("musubi_app_sk_")) throw new Error("developer app did not receive API key");

  await postJson(`${serverUrl}/v1/developer/apps/${app.app_id}/permission-declarations`, {
    plugin_name: "codex",
    channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
    reason: "Create scoped local coding tasks",
  });
  const consent = await postJson<any>(`${serverUrl}/v1/consent-requests`, { app_id: app.app_id, state: "m4" });
  const consentDetail = await requestJson<any>(`${serverUrl}/v1/consent-requests/${consent.consent_request.id}`);
  if (consentDetail.app.publisher.display_name !== "M4 Publisher") throw new Error("consent did not include publisher identity");
  await postJson(`${serverUrl}/v1/consent-requests/${consent.consent_request.id}/approve`, {
    device_id: "dev_001",
    allowed_channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
  });
  await writePolicy(home, app.app_id, [workspace]);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "printf 'M4_CODEX_RESULT:%s\\n' \"$1\"", "codex-mock"]),
      CODEX_ALLOWED_WORKSPACE_DIRS_JSON: JSON.stringify([workspace]),
      CODEX_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();

  const deviceDetail = await requestJson<any>(`${serverUrl}/v1/devices/dev_001`);
  const codexCapability = deviceDetail.capabilities.find((capability: any) => capability.plugin_name === "codex");
  if (codexCapability?.manifest?.trust_level !== "official") throw new Error("device did not report plugin trust metadata");
  if (codexCapability?.manifest?.signature_status !== "verified") throw new Error("device did not report signature metadata");
  if (codexCapability?.manifest?.install_source !== "registry") throw new Error("device did not report registry source");

  const client = new MusubiApp({
    apiBaseUrl: serverUrl,
    appId: app.app_id,
    appKeyId: app.app_key_id,
    apiKey,
    privateKey: keyPair.privateKey,
    workspaceId: "ws_local",
    pollIntervalMs: 75,
  });
  const devices = await client.devices.listGranted();
  if (devices.length !== 1 || devices[0].id !== "dev_001") throw new Error("third-party app did not list consented device");
  const invocation = await client.invoke({
    deviceId: "dev_001",
    channel: "codex.task.create",
    payload: codexPayload("M4_THIRD_PARTY_SECRET", { workspaceHint: workspace, maxDurationSeconds: 5 }),
  });
  const result = await invocation.result<any>();
  if (!String(result.body?.echo || "").includes("M4_CODEX_RESULT:M4_THIRD_PARTY_SECRET")) throw new Error("third-party encrypted invoke did not complete");

  const grants = await requestJson<any>(`${serverUrl}/v1/grants?app_id=${app.app_id}`);
  await postJson(`${serverUrl}/v1/grants/${grants.grants[0].id}/revoke`, {});
  await expectSDKDenied(() => client.invoke({
    deviceId: "dev_001",
    channel: "codex.task.create",
    payload: codexPayload("M4_REVOKED_SECRET", { workspaceHint: workspace, maxDurationSeconds: 5 }),
  }), "revoked grant still allowed send");

  const secondConsent = await postJson<any>(`${serverUrl}/v1/consent-requests`, { app_id: app.app_id, state: "m4-second" });
  await postJson(`${serverUrl}/v1/consent-requests/${secondConsent.consent_request.id}/approve`, {
    device_id: "dev_001",
    allowed_channels: ["codex.task.create"],
  });
  await postJson(`${serverUrl}/v1/apps/${app.app_id}/suspend`, {});
  await expectSDKDenied(() => client.devices.listGranted(), "suspended app still authenticated");

  await postJson(`${serverUrl}/v1/apps/${app.app_id}/report`, { reason: "suspicious", description: "M4 verifier report" });
  const authorized = await requestJson<any>(`${serverUrl}/v1/authorized-apps`);
  if (!JSON.stringify(authorized).includes("M4 Publisher")) throw new Error("authorized apps did not include publisher");
  if (!JSON.stringify(authorized).includes("suspicious")) throw new Error("authorized apps did not include report");

  const audit = await requestJson<any>(`${serverUrl}/v1/audit-events`);
  for (const event of ["developer.created", "publisher.created", "app.permission_declared", "consent.approved", "grant.revoked", "app.reported", "app.suspended", "plugin.install_reported", "plugin.update_checked", "message.completed"]) {
    if (!audit.audit_events.find((item: any) => item.event_type === event)) throw new Error(`missing audit event ${event}`);
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[m4-platform-trust] ok: third-party consent, scoped grants, revocation/suspension, registry signature policy, plugin trust reporting, update review, UI/docs artifacts verified");
process.exit(0);

async function assertArtifacts() {
  for (const file of [
    "docs/third_party_app_platform_m4.md",
    "docs/plugin_registry_trust_m4_5.md",
    "docs/musubi_m_4_third_party_app_and_m_4_5_plugin_trust_plan.md",
  ]) {
    if (!(await Bun.file(file).exists())) throw new Error(`missing ${file}`);
  }
  const controlPlane = await Bun.file("apps/control-plane/app.js").text();
  for (const text of ["renderConsent", "renderPlugins", "renderAuthorizedApps", "trust_status", "Payload encrypted end-to-end"]) {
    if (!controlPlane.includes(text)) throw new Error(`control plane missing ${text}`);
  }
}

async function writePolicy(homePath: string, appId: string, allowedWorkspaceDirs: string[]) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          codex: {
            allow: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
            require_local_confirm: false,
            allowed_workspace_dirs: allowedWorkspaceDirs,
            max_task_duration_seconds: 10,
            approval_mode: "codex_default",
            sandbox_mode: "codex_default",
          },
        },
      },
    },
    plugins: {
      echo: { enabled: true, permissions: ["status.report"] },
      hermes: { enabled: true, permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"] },
      codex: {
        enabled: true,
        permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
        config: { codex_binary: "codex", default_working_dir: workspace, allowed_workspace_dirs: allowedWorkspaceDirs },
      },
    },
  }, null, 2));
}

async function waitForOnline() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await requestJson<any>(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function expectSDKDenied(fn: () => Promise<unknown>, message: string) {
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
  const result = await runWithStatus(command, args);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.output}`);
  return result.output;
}

async function runWithStatus(command: string, args: string[]): Promise<{ status: number; output: string }> {
  const proc = Bun.spawn([command, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { status, output: `${stdout}${stderr}` };
}

function mustInclude(text: string, needle: string, message: string) {
  if (!text.includes(needle)) throw new Error(`${message}\nOutput:\n${text}`);
}
