import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

type Child = ReturnType<typeof spawn>;

async function main() {
  const port = String(19000 + Math.floor(Math.random() * 1000));
  const relayUrl = `http://127.0.0.1:${port}`;
  const relayWs = `ws://127.0.0.1:${port}/v1/devices/dev_demo/connect`;
  const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
  try {
    const useGoDevice = process.env.MUSUBI_VERIFY_DEVICE === "go";
    const device = useGoDevice
      ? start("device-go", ["run", "./cmd/musubi", "--relay", relayWs], {
          GOCACHE: `${process.cwd()}/.cache/go-build`,
        }, "go")
      : start("device", ["run", "apps/device-harness/src/main.ts"], {
          MUSUBI_RELAY_WS: relayWs,
        });
    try {
      await sleep(useGoDevice ? 2500 : 500);
      const ok = await run("app-ok", ["run", "apps/app-simulator/src/main.ts", "echo.echo"], 0, {
        MUSUBI_RELAY_URL: relayUrl,
      });
      if (!ok.includes('"echo":"hello from musubi"')) {
        throw new Error("successful echo result was not decrypted by app simulator");
      }
      if (!ok.includes('"received"') || !ok.includes('"processing"')) {
        throw new Error("message history did not include received and processing states");
      }

      const denied = await run(
        "app-denied",
        ["run", "apps/app-simulator/src/main.ts", "shell.run"],
        2,
        { MUSUBI_RELAY_URL: relayUrl },
      );
      if (!denied.includes("channel denied")) {
        throw new Error("unauthorized channel did not fail at cloud authorization");
      }
    } finally {
      device.kill();
    }
  } finally {
    server.stop(true);
  }

  console.log("[verify] ok: encrypted echo path and unauthorized-channel rejection passed");
}

function start(
  name: string,
  args: string[],
  env: Record<string, string> = {},
  bin = "bun",
): Child {
  const child = spawn(bin, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

function run(
  name: string,
  args: string[],
  expectedCode: number,
  env: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      process.stdout.write(`[${name}] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      process.stderr.write(`[${name}] ${chunk}`);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${name} timed out`));
    }, 10000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === expectedCode) resolve(output);
      else reject(new Error(`${name} exited ${code}, expected ${expectedCode}`));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
