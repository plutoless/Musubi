import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(24000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice6`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ReturnType<typeof spawn> | undefined;
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
    "M1 Slice6 Device",
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
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["echo.echo"],
    queueing_allowed: false,
  });
  await writePolicy(home, true);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();

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
    "hello from m1 public key flow",
  ]);
  if (!output.includes('"echo":"hello from m1 public key flow"')) {
    throw new Error("app sender did not decrypt expected public-key echo result");
  }
  assertOrderedHistory(output, ["created", "validated", "delivered", "received", "processing", "completed"]);
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[slice6] ok: app encrypted to device public key, Go CLI decrypted, echo plugin ran, and app decrypted result");
process.exit(0);

function assertOrderedHistory(output: string, expectedStates: string[]) {
  const match = output.match(/message history \[([^\]]+)\]/);
  if (!match) throw new Error("message history was not printed by app sender");
  const actualStates = match[1].split(/\s+/).filter(Boolean);
  let cursor = 0;
  for (const state of expectedStates) {
    const index = actualStates.indexOf(state, cursor);
    if (index === -1) {
      throw new Error(`message history missing ordered state ${state}: ${actualStates.join(" ")}`);
    }
    cursor = index + 1;
  }
}

async function waitForOnline() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
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
  const proc = Bun.spawn(["curl", "--noproxy", "127.0.0.1", "-sS", url], {
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
