import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(22000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice4`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
try {
  await run("go", [
    "run",
    "./cmd/musubi",
    "device",
    "register",
    "--server",
    serverUrl,
    "--home",
    home,
    "--workspace",
    "ws_local",
    "--name",
    "M1 Slice4 Device",
  ]);
  await run("go", [
    "run",
    "./cmd/musubi",
    "dev",
    "app",
    "create",
    "Hermes Web",
    "--server",
    serverUrl,
    "--home",
    home,
    "--workspace",
    "ws_local",
  ]);

  const grant = await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
    queueing_allowed: false,
  });
  if (grant.grant_id !== "grant_001" || grant.status !== "active") {
    throw new Error("grant creation failed");
  }

  const allowed = await check("hermes.task.create");
  if (!allowed.allowed) throw new Error("allowed channel was denied");

  const denied = await check("shell.run");
  if (denied.allowed || denied.error !== "channel denied") {
    throw new Error("denied channel did not fail");
  }

  await postJson(`${serverUrl}/v1/grants/grant_001/revoke`, {});
  const revoked = await check("hermes.task.create");
  if (revoked.allowed || revoked.error !== "grant denied") {
    throw new Error("revoked grant did not fail");
  }
} finally {
  server.stop(true);
}

console.log("[slice4] ok: grants allow channels, deny unknown channels, and fail after revocation");

function check(channel: string) {
  return postJson(`${serverUrl}/v1/permissions/check`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    channel,
  });
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

async function postJson(url: string, body: unknown): Promise<any> {
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
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}
