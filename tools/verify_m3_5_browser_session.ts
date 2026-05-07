import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";
import { startHermesCompanion } from "../apps/hermes-companion/src/main.ts";
import { MusubiApp } from "../sdk/app-js/src/index.ts";

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

const relayPort = String(35000 + Math.floor(Math.random() * 1000));
const companionPort = String(36000 + Math.floor(Math.random() * 1000));
const relayUrl = `http://127.0.0.1:${relayPort}`;
const companionUrl = `http://127.0.0.1:${companionPort}`;
const home = `${process.cwd()}/.musubi/m3-5-browser-session`;
const userToken = "m35-user-token";
const secretInstruction = "M35_BROWSER_SESSION_SECRET";
let capturedLogs = "";

await rm(home, { recursive: true, force: true });
await assertArtifacts();

const originalLog = console.log;
const originalError = console.error;
console.log = (...args: unknown[]) => {
  capturedLogs += `${args.map(formatLogArg).join(" ")}\n`;
  originalLog(...args);
};
console.error = (...args: unknown[]) => {
  capturedLogs += `${args.map(formatLogArg).join(" ")}\n`;
  originalError(...args);
};

const relay = startRelay({ hostname: "127.0.0.1", port: Number(relayPort) });
let companion: ReturnType<typeof startHermesCompanion> | undefined;
let device: ReturnType<typeof spawn> | undefined;
try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", relayUrl, "--home", home, "--workspace", "ws_local", "--name", "M3.5 Browser Mac"]);
  const envOutput = await run("go", [
    "run",
    "./cmd/musubi",
    "app",
    "create",
    "Hermes Companion Web",
    "--server",
    relayUrl,
    "--home",
    home,
    "--workspace",
    "ws_local",
    "--type",
    "user_owned",
    "--generate-key-local",
    "--env",
  ]);
  const sdkEnv = parseEnv(envOutput);
  await postJson(`${relayUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: sdkEnv.MUSUBI_APP_ID,
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
  });
  await writePolicy(home, sdkEnv.MUSUBI_APP_ID);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      HERMES_COMMAND: "/bin/echo",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => {
    capturedLogs += String(chunk);
    process.stdout.write(chunk);
  });
  device.stderr.on("data", (chunk) => {
    capturedLogs += String(chunk);
    process.stderr.write(chunk);
  });
  await waitForOnline(relayUrl);

  const musubi = new MusubiApp({
    apiBaseUrl: relayUrl,
    apiKey: sdkEnv.MUSUBI_API_KEY,
    privateKey: sdkEnv.MUSUBI_APP_PRIVATE_KEY,
  });
  companion = startHermesCompanion({
    hostname: "127.0.0.1",
    port: Number(companionPort),
    musubi,
    userToken,
  });
  capturedLogs = "";

  await assertBrowserAssetsDoNotExposeSecrets(sdkEnv);
  const devices = await requestJson(`${companionUrl}/api/devices`, userToken);
  if (devices.devices.length !== 1 || devices.devices[0].id !== "dev_001") throw new Error("companion backend did not list granted device");
  assertNoSecrets(JSON.stringify(devices), sdkEnv, "device API response");

  const start = await postJson(`${companionUrl}/api/tasks`, {
    device_id: "dev_001",
    channel: "hermes.task.create",
    body: {
      instruction: secretInstruction,
      workspace_hint: process.cwd(),
      stream: true,
    },
  }, userToken);
  const taskId = start.task_session_id;
  if (!taskId?.startsWith("ats_")) throw new Error("companion did not return app task session id");
  assertNoSecrets(JSON.stringify(start), sdkEnv, "task start response");

  const liveEvents = await readSse(`${companionUrl}/api/tasks/${taskId}/events?token=${encodeURIComponent(userToken)}`, {
    until: (events) => events.some((event) => event.type === "task.result"),
  });
  if (!liveEvents.some((event) => event.type === "task.progress")) throw new Error("browser did not receive live progress event");
  if (!liveEvents.some((event) => JSON.stringify(event.data).includes(secretInstruction))) {
    throw new Error("browser did not receive decrypted Hermes result through backend bridge");
  }

  const task = await requestJson(`${companionUrl}/api/tasks/${taskId}`, userToken);
  if (task.task.status !== "completed") throw new Error(`task status was not recoverable as completed: ${task.task.status}`);
  if (JSON.stringify(task).includes("msg_sdk_")) throw new Error("browser task session exposed internal Musubi message id");
  assertNoSecrets(JSON.stringify(task), sdkEnv, "task session response");

  const reconnectEvents = await readSse(`${companionUrl}/api/tasks/${taskId}/events?token=${encodeURIComponent(userToken)}&after=0`, {
    until: (events) => events.some((event) => event.type === "task.result"),
  });
  if (!reconnectEvents.length) throw new Error("browser reconnect did not recover event history");

  const deniedStream = await fetch(`${companionUrl}/api/tasks/${taskId}/events?token=wrong-user-token`);
  if (deniedStream.status !== 401) throw new Error("other user could subscribe to task events");
  deniedStream.body?.cancel();

  const deniedTask = await postJsonWithStatus(`${companionUrl}/api/tasks`, {
    device_id: "dev_missing",
    channel: "hermes.task.create",
    body: { instruction: "should fail" },
  }, userToken);
  if (deniedTask.status !== 403 || deniedTask.body.message !== "Hermes is not authorized for this device.") {
    throw new Error("grant/device error was not mapped to browser-safe message");
  }

  const cancelStart = await postJson(`${companionUrl}/api/tasks`, {
    device_id: "dev_001",
    channel: "hermes.task.create",
    body: { instruction: "cancel me", stream: true },
  }, userToken);
  const cancelResponse = await postJson(`${companionUrl}/api/tasks/${cancelStart.task_session_id}/cancel`, {}, userToken);
  if (cancelResponse.status !== "cancelled") throw new Error("browser cancel did not return cancelled state");
  const cancelled = await requestJson(`${companionUrl}/api/tasks/${cancelStart.task_session_id}`, userToken);
  if (cancelled.task.status !== "cancelled") throw new Error("cancelled task status was not recoverable");

  assertNoSecrets(capturedLogs, sdkEnv, "backend/device logs");
  if (capturedLogs.includes(secretInstruction)) throw new Error("backend logs included raw decrypted task event");
} finally {
  console.log = originalLog;
  console.error = originalError;
  device?.kill("SIGKILL");
  companion?.stop(true);
  relay.stop(true);
}

console.log("[m3.5-browser-session] ok: Hermes web task start, SSE events, cancel, reconnect, auth scoping, error UX, and secret boundaries verified");
process.exit(0);

async function assertArtifacts() {
  for (const file of [
    "docs/browser_session_keys_m3_5.md",
    "docs/guides/using-musubi-from-browser-app.md",
    "docs/security/why-not-browser-private-key.md",
    "apps/hermes-companion/src/main.ts",
    "apps/hermes-companion/static/index.html",
    "sdk/app-js/src/event_bridge.ts",
    "sdk/browser-client/src/index.ts",
  ]) {
    if (!(await Bun.file(file).exists())) throw new Error(`missing ${file}`);
  }
}

async function assertBrowserAssetsDoNotExposeSecrets(env: Record<string, string>) {
  for (const path of ["/", "/app.js", "/styles.css"]) {
    const response = await fetch(`${companionUrl}${path}`);
    const text = await response.text();
    if (!response.ok) throw new Error(`failed to fetch browser asset ${path}`);
    assertNoSecrets(text, env, `browser asset ${path}`);
  }
}

function assertNoSecrets(text: string, env: Record<string, string>, label: string) {
  for (const key of ["MUSUBI_API_KEY", "MUSUBI_APP_PRIVATE_KEY"]) {
    if (text.includes(env[key])) throw new Error(`${label} exposed ${key}`);
  }
  if (text.includes("musubi_app_sk_")) throw new Error(`${label} exposed a Musubi app API key`);
}

async function writePolicy(homePath: string, appId: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          hermes: { allow: ["hermes.task.create", "hermes.task.cancel"], require_local_confirm: false },
        },
      },
    },
    plugins: {
      hermes: {
        enabled: true,
        permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
      },
    },
  }, null, 2));
}

async function waitForOnline(serverUrl: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function readSse(url: string, options: { until: (events: Array<{ type: string; data: any }>) => boolean }) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ type: string; data: any }> = [];
  const deadline = Date.now() + 10_000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const parsed = parseSseEvent(raw);
        if (parsed) events.push(parsed);
        if (options.until(events)) {
          controller.abort();
          return events;
        }
        index = buffer.indexOf("\n\n");
      }
    }
  } finally {
    controller.abort();
  }
  throw new Error(`SSE did not reach expected condition; got ${JSON.stringify(events)}`);
}

function parseSseEvent(raw: string) {
  if (raw.startsWith(":")) return undefined;
  let type = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) type = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data += line.slice("data:".length).trim();
  }
  return data ? { type, data: JSON.parse(data) } : undefined;
}

function parseEnv(output: string) {
  const env: Record<string, string> = {};
  for (const line of output.trim().split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      capturedLogs += String(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      capturedLogs += String(chunk);
      process.stderr.write(chunk);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function requestJson(url: string, token?: string): Promise<any> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function postJson(url: string, body: unknown, token?: string): Promise<any> {
  const response = await postJsonWithStatus(url, body, token);
  if (response.status < 200 || response.status >= 300) throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function postJsonWithStatus(url: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function formatLogArg(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
