import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { loadEnvFiles } from "./env.ts";

loadEnvFiles();
const hostedUrl = process.env.MUSUBI_HOSTED_URL;
const databaseUrl = process.env.NEON_DATABASE_URL;
if (!hostedUrl) {
  throw new Error("MUSUBI_HOSTED_URL is required, for example https://musubi-m1.<account>.workers.dev. Set it in the shell or in .env.local; see .env.example.");
}
if (!databaseUrl) {
  throw new Error("NEON_DATABASE_URL is required so the deployed Codex verifier can prove hosted persistence. Set it in the shell or in .env.local; see .env.example.");
}

const serverUrl = hostedUrl.replace(/\/$/, "");
const home = `${process.cwd()}/.musubi/slice12-deployed`;
const workspaceId = process.env.MUSUBI_CODEX_HOSTED_WORKSPACE ?? "ws_codex_deployed";
const codexCommand = process.env.MUSUBI_CODEX_HOSTED_COMMAND ?? "/bin/echo deployed-codex";
const prompt = process.env.MUSUBI_CODEX_HOSTED_PROMPT ?? "deployed codex worker route";
const expected = process.env.MUSUBI_CODEX_HOSTED_EXPECT ?? `deployed-codex ${prompt}`;

await rm(home, { recursive: true, force: true });
let device: ReturnType<typeof spawn> | undefined;
let messageId = "";
let deviceId = "";
let appId = "";
try {
  await ensureHealth();
  const deviceOutput = await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
  deviceId = requiredMatch(deviceOutput, /registered device (dev_[a-z0-9]+)/, "device id");
  const appOutput = await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Codex Web", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
  appId = requiredMatch(appOutput, /created app (app_[a-z0-9]+)/, "app id");
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: appId,
    device_id: deviceId,
    allowed_channels: ["codex.task.create"],
  });
  await writePolicy(home, appId);

  device = startDevice(home);
  await waitForStatus(deviceId, "online");

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
    appId,
    "--channel",
    "codex.task.create",
    "--text",
    prompt,
  ]);
  if (!output.includes(expected)) {
    throw new Error(`deployed Worker did not return expected encrypted Codex result ${JSON.stringify(expected)}`);
  }
  if (!output.includes('"handled_by":"codex"')) {
    throw new Error("deployed Codex result did not identify the Codex plugin");
  }
  const match = output.match(/message id (msg_m1_\d+)/);
  if (!match) throw new Error("could not find message id in deployed Codex verifier output");
  messageId = match[1];

  await verifyNeonRows({ messageId, deviceId, appId });
} finally {
  killDevice(device);
}

console.log(`[slice12-deployed] ok: deployed Worker completed encrypted Codex flow and Neon rows exist for ${messageId}`);
process.exit(0);

async function ensureHealth() {
  const health = await requestJson(`${serverUrl}/v1/health`);
  if (!health.ok) throw new Error(`hosted health check failed: ${JSON.stringify(health)}`);
  if (!health.neon_configured) {
    throw new Error("hosted Worker reports neon_configured=false; set the NEON_DATABASE_URL Wrangler secret and redeploy");
  }
}

async function writePolicy(homePath: string, appId: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          codex: {
            allow: ["codex.task.create"],
            require_local_confirm: false,
          },
        },
      },
    },
    plugins: {
      codex: {
        enabled: true,
        permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
      },
    },
  }, null, 2));
}

function startDevice(homePath: string) {
  const child = spawn("go", ["run", "./cmd/musubi", "start", "--home", homePath], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      CODEX_COMMAND: codexCommand,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function killDevice(child: ReturnType<typeof spawn> | undefined) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function waitForStatus(deviceId: string, expectedStatus: "online" | "offline") {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/${deviceId}`);
    if (status.device?.status === expectedStatus) return;
    await Bun.sleep(250);
  }
  throw new Error(`deployed hosted device did not become ${expectedStatus}`);
}

function requiredMatch(output: string, pattern: RegExp, label: string): string {
  const match = output.match(pattern);
  if (!match) throw new Error(`could not parse ${label} from output:\n${output}`);
  return match[1];
}

async function verifyNeonRows(ids: { messageId: string; deviceId: string; appId: string }) {
  const sql = neon(databaseUrl!);
  const messages = await sql`
    select id, status, channel, ciphertext
    from messages
    where id = ${ids.messageId}
  `;
  if (messages.length !== 1) throw new Error(`Neon messages row missing for ${ids.messageId}`);
  if (messages[0].status !== "completed") throw new Error(`Neon message status is ${messages[0].status}, expected completed`);
  if (messages[0].channel !== "codex.task.create") throw new Error(`Neon message channel is ${messages[0].channel}, expected codex.task.create`);
  if (typeof messages[0].ciphertext !== "string" || messages[0].ciphertext.length < 20) {
    throw new Error("Neon Codex message ciphertext is missing or unexpectedly short");
  }

  const requiredAuditEvents = ["message.created", "message.validated", "message.delivered", "message.received", "message.processing", "message.completed"];
  let audits: Array<{ event_type: string; metadata: unknown }> = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    audits = await sql`
      select event_type, metadata
      from audit_events
      where message_id = ${ids.messageId}
    ` as Array<{ event_type: string; metadata: unknown }>;
    const eventTypes = new Set(audits.map((event) => event.event_type));
    const complete = requiredAuditEvents.every((eventType) => eventTypes.has(eventType));
    if (complete) break;
    if (attempt === 39) {
      const missing = requiredAuditEvents.filter((eventType) => !eventTypes.has(eventType));
      throw new Error(`Neon Codex audit rows missing ${missing.join(", ")}`);
    }
    await Bun.sleep(250);
  }
  const auditJson = JSON.stringify(audits);
  if (auditJson.includes(prompt) || auditJson.includes(expected)) {
    throw new Error("Neon audit metadata contains decrypted Codex payload/result text");
  }

  const grants = await sql`
    select id, app_id, device_id, allowed_channels
    from app_device_channel_grants
    where app_id = ${ids.appId} and device_id = ${ids.deviceId}
  `;
  if (grants.length < 1 || !grants[0].allowed_channels.includes("codex.task.create")) {
    throw new Error("Neon Codex grant row missing codex.task.create");
  }

  const capabilities = await sql`
    select plugin_name, channels
    from device_plugin_capabilities
    where device_id = ${ids.deviceId}
  `;
  const codex = capabilities.find((capability: { plugin_name: string }) => capability.plugin_name === "codex");
  if (!codex || !codex.channels.includes("codex.task.create")) {
    throw new Error("Neon device_plugin_capabilities rows missing Codex task channel");
  }
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
  const proc = Bun.spawn(["curl", "-sS", url], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}

async function postJson(url: string, body: unknown): Promise<any> {
  const proc = Bun.spawn([
    "curl",
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
  return JSON.parse(stdout);
}
