import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(20000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice2`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
try {
  const registerOutput = await run("go", [
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
    "M1 Slice2 Device",
  ]);
  if (!registerOutput.includes("registered device dev_001 with key devkey_001")) {
    throw new Error("device registration output did not include expected IDs");
  }

  const config = JSON.parse(readFileSync(`${home}/config.json`, "utf8"));
  if (config.device_id !== "dev_001") throw new Error("config missing device_id");
  if (!config.device_private_key || !config.device_public_key) {
    throw new Error("config missing generated key pair");
  }

  const statusOutput = await run("go", [
    "run",
    "./cmd/musubi",
    "status",
    "--home",
    home,
  ]);
  if (!statusOutput.includes("Device ID: dev_001")) {
    throw new Error("status command did not show registered device");
  }

  const device = await requestJson(`${serverUrl}/v1/devices/dev_001`);
  if (device.device.id !== "dev_001") throw new Error("server device record missing");
  if (device.active_key.id !== "devkey_001") throw new Error("server active device key missing");
  if (device.active_key.public_key !== config.device_public_key) {
    throw new Error("server public key does not match local config");
  }
} finally {
  server.stop(true);
}

console.log("[slice2] ok: CLI registered device, stored local key/config, and server stored active public key");

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
