import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(27000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice9`;

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
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
  });
  await writePolicy(home);
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
    "--channel",
    "hermes.task.create",
    "--text",
    "summarize this project",
  ]);
  if (!output.includes("hermes simulated result: summarize this project")) {
    throw new Error("Hermes skeleton did not return expected encrypted result");
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[slice9] ok: encrypted Hermes task reached Hermes plugin skeleton and returned decrypted result");
process.exit(0);

async function writePolicy(home: string) {
  await mkdir(home, { recursive: true });
  await writeFile(`${home}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      app_001: {
        plugins: {
          hermes: {
            allow: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
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
