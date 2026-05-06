import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const port = String(29000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice11-hosted-local`;
const wranglerEnv = {
  ...process.env,
  TMPDIR: `${process.cwd()}/.cache/tmp`,
  BUN_INSTALL_CACHE_DIR: `${process.cwd()}/.cache/bun`,
};

await rm(home, { recursive: true, force: true });

const worker = spawn("bunx", ["wrangler", "dev", "--ip", "127.0.0.1", "--port", port], {
  cwd: `${process.cwd()}/server/workers`,
  env: wranglerEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
let workerOutput = "";
worker.stdout.on("data", (chunk) => {
  workerOutput += String(chunk);
  process.stdout.write(chunk);
});
worker.stderr.on("data", (chunk) => {
  workerOutput += String(chunk);
  process.stderr.write(chunk);
});

let device: ReturnType<typeof spawn> | undefined;
try {
  await waitForHealth();

  const deviceOutput = await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_hosted_local"]);
  const deviceId = requiredMatch(deviceOutput, /registered device (dev_\d+)/, "device id");
  const appOutput = await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Hermes Web", "--server", serverUrl, "--home", home, "--workspace", "ws_hosted_local"]);
  const appId = requiredMatch(appOutput, /created app (app_\d+)/, "app id");
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_hosted_local",
    app_id: appId,
    device_id: deviceId,
    allowed_channels: ["hermes.task.create"],
  });
  await writePolicy(home, appId);

  device = startDevice(home);
  await waitForOnline(deviceId);
  const capabilities = await requestJson(`${serverUrl}/v1/device-plugin-capabilities`);
  const pluginNames = new Set((capabilities.capabilities ?? []).map((capability: { plugin_name: string }) => capability.plugin_name));
  if (!pluginNames.has("echo") || !pluginNames.has("hermes")) {
    throw new Error("hosted local Worker did not record echo and Hermes plugin capabilities");
  }

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
    "hermes.task.create",
    "--text",
    "hosted local worker route",
  ]);
  if (!output.includes("hosted-hermes hosted local worker route")) {
    throw new Error("hosted local Worker did not return encrypted Hermes result");
  }

  const audit = await requestJson(`${serverUrl}/v1/audit-events`);
  const eventTypes = new Set((audit.audit_events ?? []).map((event: { event_type: string }) => event.event_type));
  for (const eventType of ["message.created", "message.validated", "message.delivered", "message.received", "message.processing", "message.completed"]) {
    if (!eventTypes.has(eventType)) throw new Error(`hosted local Worker audit is missing ${eventType}`);
  }

  killDevice(device);
  device = undefined;
  await waitForStatus(deviceId, "offline");
  device = startDevice(home);
  await waitForStatus(deviceId, "online");
} finally {
  killDevice(device);
  worker.kill("SIGKILL");
}

console.log("[slice11-hosted-local] ok: wrangler dev Worker recorded capabilities, completed encrypted Hermes flow, and reconnected device");
process.exit(0);

async function writePolicy(homePath: string, appId: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          hermes: {
            allow: ["hermes.task.create"],
            require_local_confirm: false,
          },
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

function startDevice(homePath: string) {
  const child = spawn("go", ["run", "./cmd/musubi", "start", "--home", homePath], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      HERMES_COMMAND: "/bin/echo hosted-hermes",
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

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await requestJson(`${serverUrl}/v1/health`);
      if (health.ok) return;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error(`worker did not become healthy:\n${workerOutput}`);
}

async function waitForOnline(deviceId: string) {
  return waitForStatus(deviceId, "online");
}

async function waitForStatus(deviceId: string, expectedStatus: "online" | "offline") {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/${deviceId}`);
    if (status.device?.status === expectedStatus) return;
    await Bun.sleep(250);
  }
  throw new Error(`hosted local device did not become ${expectedStatus}`);
}

function requiredMatch(output: string, pattern: RegExp, label: string): string {
  const match = output.match(pattern);
  if (!match) throw new Error(`could not parse ${label} from output:\n${output}`);
  return match[1];
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
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
}
