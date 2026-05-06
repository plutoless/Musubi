import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(21000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/slice3`;

await rm(home, { recursive: true, force: true });
const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
try {
  const output = await run("go", [
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
  if (!output.includes("created app app_001 with key appkey_001")) {
    throw new Error("app creation output did not include expected IDs");
  }

  const appConfig = JSON.parse(readFileSync(`${home}/apps/app_001.json`, "utf8"));
  if (!appConfig.app_private_key || !appConfig.app_public_key) {
    throw new Error("dev app config missing generated key pair");
  }

  const app = await requestJson(`${serverUrl}/v1/apps/app_001`);
  if (app.app.id !== "app_001") throw new Error("server app record missing");
  if (app.active_key.id !== "appkey_001") throw new Error("server active app key missing");
  if (app.active_key.public_key !== appConfig.app_public_key) {
    throw new Error("server app public key does not match dev config");
  }
} finally {
  server.stop(true);
}

console.log("[slice3] ok: dev helper created first-party app, local private key, and server active public key");

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
