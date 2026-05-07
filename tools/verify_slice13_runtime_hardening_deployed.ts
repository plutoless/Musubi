import { mkdir, rm } from "node:fs/promises";
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
  throw new Error("NEON_DATABASE_URL is required so the deployed hardening verifier can prove Neon persistence. Set it in the shell or in .env.local; see .env.example.");
}

const serverUrl = hostedUrl.replace(/\/$/, "");
const home = `${process.cwd()}/.musubi/slice13-deployed`;
const workspaceId = process.env.MUSUBI_HARDENING_HOSTED_WORKSPACE ?? "ws_hardening_deployed";
const needles = ["M16_DEPLOYED_MISSING_GRANT_SECRET", "M16_DEPLOYED_CHANNEL_DENIED_SECRET"];

await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });

await ensureHealth();
const deviceOutput = await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
const deviceId = requiredMatch(deviceOutput, /registered device (dev_[a-z0-9]+)/, "device id");
const appOutput = await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Codex Web", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
const appId = requiredMatch(appOutput, /created app (app_[a-z0-9]+)/, "app id");

const missingGrantMessageId = await assertDeployedDenied({
  name: "missing-grant",
  channel: "codex.task.create",
  prompt: needles[0],
});
await postJson(`${serverUrl}/v1/grants`, {
  workspace_id: workspaceId,
  app_id: appId,
  device_id: deviceId,
  allowed_channels: ["echo.echo"],
});
const deniedChannelMessageId = await assertDeployedDenied({
  name: "channel-denied",
  channel: "codex.task.create",
  prompt: needles[1],
});

await verifyNeonFailedRows([missingGrantMessageId, deniedChannelMessageId]);

console.log(`[slice13-deployed] ok: deployed Worker denied unsafe paths and Neon failed rows stayed payload-opaque`);
process.exit(0);

async function assertDeployedDenied(options: { name: string; channel: string; prompt: string }) {
  const output = await runExpectFailure("go", [
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
    options.channel,
    "--text",
    options.prompt,
  ]);
  if (!output.includes("send failed: 403")) {
    throw new Error(`deployed ${options.name} did not fail at hosted authorization`);
  }
  return requiredMatch(output, /(msg_m1_\d+)/, "message id");
}

async function ensureHealth() {
  const health = await requestJson(`${serverUrl}/v1/health`);
  if (!health.ok) throw new Error(`hosted health check failed: ${JSON.stringify(health)}`);
  if (!health.neon_configured) {
    throw new Error("hosted Worker reports neon_configured=false; set the NEON_DATABASE_URL Wrangler secret and redeploy");
  }
}

async function verifyNeonFailedRows(messageIds: string[]) {
  const sql = neon(databaseUrl!);
  for (const messageId of messageIds) {
    const messages = await sql`
      select id, status, channel, ciphertext
      from messages
      where id = ${messageId}
    `;
    if (messages.length !== 1) throw new Error(`Neon failed message row missing for ${messageId}`);
    if (messages[0].status !== "failed") throw new Error(`Neon message status is ${messages[0].status}, expected failed`);
    if (messages[0].channel !== "codex.task.create") {
      throw new Error(`Neon failed message channel is ${messages[0].channel}, expected codex.task.create`);
    }
    if (typeof messages[0].ciphertext !== "string" || messages[0].ciphertext.length < 20) {
      throw new Error("Neon failed message ciphertext is missing or unexpectedly short");
    }

    let audits: Array<{ event_type: string; metadata: unknown }> = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      audits = await sql`
        select event_type, metadata
        from audit_events
        where message_id = ${messageId}
      ` as Array<{ event_type: string; metadata: unknown }>;
      const eventTypes = new Set(audits.map((event) => event.event_type));
      if (eventTypes.has("message.created") && eventTypes.has("message.failed")) break;
      if (attempt === 39) throw new Error(`Neon failed audit rows missing created/failed for ${messageId}`);
      await Bun.sleep(250);
    }

    const persistedJson = JSON.stringify({ messages, audits });
    for (const needle of needles) {
      if (persistedJson.includes(needle)) {
        throw new Error(`Neon failed rows leaked plaintext needle ${needle}`);
      }
    }
  }
}

function requiredMatch(output: string, pattern: RegExp, label: string): string {
  const match = output.match(pattern);
  if (!match) throw new Error(`could not parse ${label} from output:\n${output}`);
  return match[1];
}

function run(bin: string, args: string[]): Promise<string> {
  return runWithExpectedCode(bin, args, 0);
}

function runExpectFailure(bin: string, args: string[]): Promise<string> {
  return runWithExpectedCode(bin, args, 1);
}

function runWithExpectedCode(bin: string, args: string[], expectedCode: number): Promise<string> {
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
      if (code === expectedCode) resolve(output);
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}, expected ${expectedCode}`));
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
