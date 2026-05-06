import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { startRelay } from "../apps/relay-server/src/main.ts";

for (const path of ["migrations/001_init.sql", "migrations/002_keys.sql", "migrations/003_messages_audit.sql"]) {
  const sql = readFileSync(path, "utf8");
  if (!sql.includes("create table")) throw new Error(`${path} does not define tables`);
}

const port = String(25000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice7`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ReturnType<typeof spawn> | undefined;
try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Hermes Web", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["echo.echo"],
    queueing_allowed: true,
  });
  const expiredMessageId = `msg_m1_expired_${Date.now()}`;
  const expired = await postJson(`${serverUrl}/v1/messages`, {
    message_id: expiredMessageId,
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    channel: "echo.echo",
    metadata: {
      trace_id: "trace_expired",
      ttl_seconds: 1,
      created_at: "2026-05-06T00:00:00.000Z",
    },
    encryption: {
      alg: "musubi-demo-aes-256-gcm",
      key_id: "expired-test",
    },
    ciphertext: "opaque-expired-ciphertext",
  }, 410);
  if (expired.status !== "expired") throw new Error("expired message was not rejected as expired");
  const expiredStatus = await requestJson(`${serverUrl}/v1/messages/${expiredMessageId}`);
  if (expiredStatus.status !== "expired") throw new Error("expired message status API did not return expired");

  await writePolicy(home, true);
  const queuedOutputPromise = startQueuedMessage(home);
  await waitForQueued();
  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();
  const queuedOutput = await queuedOutputPromise;
  const queuedMessageId = queuedOutput.match(/msg_m1_\d+/)?.[0];
  if (!queuedMessageId) throw new Error("could not discover queued message ID");
  await waitForCompleted(queuedMessageId);

  const output = await run("go", [
    "run",
    "./cmd/musubi",
    "dev",
    "echo",
    "send",
    "--server",
    serverUrl,
    "--home",
    home,
    "--app",
    "app_001",
    "--text",
    "slice7 plaintext must not appear in audit",
  ]);
  const messageId = output.match(/msg_m1_\d+/)?.[0];
  if (!messageId) throw new Error("could not discover message ID from sender output");

  const status = await requestJson(`${serverUrl}/v1/messages/${messageId}`);
  if (status.status !== "completed") throw new Error("message status API did not return completed");

  const audit = await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`);
  const eventTypes = audit.audit_events.map((event: any) => event.event_type);
  for (const expected of ["message.created", "message.validated", "message.delivered", "message.received", "message.processing", "message.completed"]) {
    if (!eventTypes.includes(expected)) throw new Error(`missing audit event ${expected}`);
  }
  const auditText = JSON.stringify(audit);
  if (auditText.includes("slice7 plaintext")) {
    throw new Error("audit events leaked decrypted plaintext");
  }

  const cancelTerminal = await postJson(`${serverUrl}/v1/messages/${messageId}/cancel`, {});
  if (cancelTerminal.status !== "completed" || cancelTerminal.error !== "message already terminal") {
    throw new Error("cancel endpoint should not mutate completed messages");
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[slice7] ok: message status, cancel API, and audit events cover lifecycle without plaintext");
process.exit(0);

async function waitForOnline() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function waitForCompleted(messageId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/messages/${messageId}`);
    if (status.status === "completed") return;
    await Bun.sleep(100);
  }
  throw new Error("queued message did not complete after device connected");
}

async function waitForQueued() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const audit = await requestJson(`${serverUrl}/v1/audit-events`);
    if (JSON.stringify(audit).includes("message.queued")) return;
    await Bun.sleep(100);
  }
  throw new Error("message did not enter queued state before device connected");
}

function startQueuedMessage(homePath: string) {
  return run("go", [
    "run",
    "./cmd/musubi",
    "dev",
    "echo",
    "send",
    "--server",
    serverUrl,
    "--home",
    homePath,
    "--app",
    "app_001",
    "--text",
    "slice7 queued plaintext must not appear in audit",
  ]);
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
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      process.stderr.write(chunk);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function requestJson(url: string): Promise<any> {
  const proc = Bun.spawn(["curl", "--noproxy", "127.0.0.1", "-sS", url], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}

async function postJson(url: string, body: unknown, expectedStatus = 200): Promise<any> {
  const proc = Bun.spawn([
    "curl",
    "--noproxy",
    "127.0.0.1",
    "-sS",
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
    "--data-binary",
    JSON.stringify(body),
    url,
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  const parsed = JSON.parse(stdout);
  if (expectedStatus !== 200) return parsed;
  return parsed;
}

async function writePolicy(home: string, allowEcho: boolean) {
  await mkdir(home, { recursive: true });
  await writeFile(`${home}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      app_001: {
        plugins: {
          echo: {
            allow: allowEcho ? ["echo.echo"] : [],
            require_local_confirm: false,
          },
        },
      },
    },
    plugins: {
      echo: {
        enabled: true,
        permissions: ["status.report"],
      },
    },
  }, null, 2));
}
