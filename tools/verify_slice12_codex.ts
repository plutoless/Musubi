import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(29000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice12`;
const codexCommand = process.env.CODEX_COMMAND;
const codexPrompt = process.env.CODEX_PROMPT ?? "inspect local m1.5 adapter seam";
const codexExpected = process.env.CODEX_EXPECT ?? `codex simulated result: ${codexPrompt}`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ReturnType<typeof spawn> | undefined;
try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Codex Web", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["codex.task.create"],
  });
  await writePolicy(home);
  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      ...(codexCommand ? { CODEX_COMMAND: codexCommand } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();
  await assertCapabilities();

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
    "codex.task.create",
    "--text",
    codexPrompt,
  ]);
  if (!output.includes("processing processing completed")) {
    throw new Error("Codex flow did not expose encrypted processing event before completion");
  }
  if (!output.includes(codexExpected)) {
    throw new Error(`Codex plugin did not return expected output ${JSON.stringify(codexExpected)}`);
  }
  if (!output.includes('"handled_by":"codex"')) {
    throw new Error("Codex result did not identify the Codex plugin");
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log(`[slice12] ok: Codex plugin handled encrypted task and returned encrypted result containing ${JSON.stringify(codexExpected)}`);
process.exit(0);

async function writePolicy(homePath: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      app_001: {
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

async function waitForOnline() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function assertCapabilities() {
  const response = await requestJson(`${serverUrl}/v1/device-plugin-capabilities`);
  const pluginNames = new Set(response.capabilities.map((capability: { plugin_name: string }) => capability.plugin_name));
  if (!pluginNames.has("codex")) {
    throw new Error("CLI did not report Codex plugin capabilities");
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
