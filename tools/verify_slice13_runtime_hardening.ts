import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const promptNeedles = [
  "M16_MISSING_GRANT_SECRET",
  "M16_CHANNEL_DENIED_SECRET",
  "M16_LOCAL_POLICY_SECRET",
  "M16_UNSUPPORTED_CHANNEL_SECRET",
  "M16_RUNTIME_EXIT_SECRET",
  "M16_RUNTIME_TIMEOUT_SECRET",
];
let nextPort = 31000 + Math.floor(Math.random() * 1000);

await assertDirectPluginHardening();
await assertServerDenied("missing-grant", "codex.task.create", "M16_MISSING_GRANT_SECRET", undefined);
await assertServerDenied("channel-denied", "codex.task.create", "M16_CHANNEL_DENIED_SECRET", ["echo.echo"]);
await assertDeviceFailed({
  name: "local-policy-denied",
  channel: "codex.task.create",
  prompt: "M16_LOCAL_POLICY_SECRET",
  grantChannels: ["codex.task.create"],
  policyChannels: [],
});
await assertDeviceFailed({
  name: "unsupported-codex-channel",
  channel: "codex.task.exfiltrate",
  prompt: "M16_UNSUPPORTED_CHANNEL_SECRET",
  grantChannels: ["codex.task.exfiltrate"],
  policyChannels: ["codex.task.exfiltrate"],
});
await assertDeviceFailed({
  name: "runtime-exit",
  channel: "codex.task.create",
  prompt: "M16_RUNTIME_EXIT_SECRET",
  grantChannels: ["codex.task.create"],
  policyChannels: ["codex.task.create"],
  env: { CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "exit 7"]) },
});
await assertDeviceFailed({
  name: "runtime-timeout",
  channel: "codex.task.create",
  prompt: "M16_RUNTIME_TIMEOUT_SECRET",
  grantChannels: ["codex.task.create"],
  policyChannels: ["codex.task.create"],
  env: { CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "sleep 1"]), CODEX_TIMEOUT_MS: "50" },
});

console.log("[slice13] ok: runtime hardening denied unsafe paths and kept audit/status payload-opaque");
process.exit(0);

async function assertDirectPluginHardening() {
  const unsupported = await callCodexPlugin("codex.task.exfiltrate", "direct unsupported");
  assertPluginFailure(unsupported, "CODEX_CHANNEL_UNSUPPORTED");

  const exit = await callCodexPlugin("codex.task.create", "direct exit", {
    CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "exit 7"]),
  });
  assertPluginFailure(exit, "CODEX_PROCESS_FAILED");
  if (exit.body.exit_code !== 7) throw new Error(`expected runtime exit code 7, got ${exit.body.exit_code}`);

  const timeout = await callCodexPlugin("codex.task.create", "direct timeout", {
    CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "sleep 1"]),
    CODEX_TIMEOUT_MS: "50",
  });
  assertPluginFailure(timeout, "CODEX_TIMEOUT");
  if (timeout.body.timed_out !== true) throw new Error("expected timed_out=true for runtime timeout");

  const capped = await callCodexPlugin("codex.task.create", "direct output cap", {
    CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "printf 1234567890"]),
    CODEX_MAX_OUTPUT_BYTES: "4",
  });
  if (capped.status !== "completed" || capped.body.echo !== "1234") {
    throw new Error(`expected capped stdout 1234, got ${JSON.stringify(capped)}`);
  }
}

function assertPluginFailure(result: any, errorCode: string) {
  if (result.status !== "failed") throw new Error(`expected plugin failed status, got ${result.status}`);
  if (result.body?.ok !== false) throw new Error("expected plugin ok=false");
  if (result.body?.echo !== "Codex runtime failed") throw new Error("plugin failure text was not sanitized");
  if (result.body?.error_code !== errorCode) {
    throw new Error(`expected plugin error_code=${errorCode}, got ${result.body?.error_code}`);
  }
}

async function callCodexPlugin(channel: string, text: string, env: Record<string, string> = {}) {
  const child = spawn("bun", ["run", "plugins/codex/src/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "musubi.message.handle",
    params: { channel, payload: { type: "task.create", body: { text } } },
  };
  child.stdin.end(`${JSON.stringify(request)}\n`);
  const [stdout, stderr, code] = await Promise.all([
    streamText(child.stdout),
    streamText(child.stderr),
    waitForExit(child),
  ]);
  if (code !== 0) throw new Error(`codex plugin exited ${code}: ${stderr}`);
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error("codex plugin did not return a JSON-RPC response");
  const response = JSON.parse(line);
  if (response.error) throw new Error(`codex plugin returned JSON-RPC error ${JSON.stringify(response.error)}`);
  return response.result;
}

async function assertServerDenied(name: string, channel: string, prompt: string, grantChannels: string[] | undefined) {
  const context = await setupContext(name);
  try {
    if (grantChannels) {
      await createGrant(context.serverUrl, grantChannels);
    }
    const output = await runExpectFailure("go", sendArgs(context.serverUrl, context.home, channel, prompt));
    if (!output.includes("send failed: 403")) throw new Error(`${name} did not fail at server authorization`);
    const messageId = requiredMessageId(output);
    await assertStatusAndAuditOpaque(context.serverUrl, messageId);
  } finally {
    context.stop();
  }
}

async function assertDeviceFailed(options: {
  name: string;
  channel: string;
  prompt: string;
  grantChannels: string[];
  policyChannels: string[];
  env?: Record<string, string>;
}) {
  const context = await setupContext(options.name);
  let device: ReturnType<typeof spawn> | undefined;
  try {
    await createGrant(context.serverUrl, options.grantChannels);
    await writePolicy(context.home, options.policyChannels);
    device = spawn("go", ["run", "./cmd/musubi", "start", "--home", context.home], {
      cwd: process.cwd(),
      env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build`, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    device.stdout.on("data", (chunk) => process.stdout.write(chunk));
    device.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await waitForOnline(context.serverUrl);
    await assertCodexCapabilities(context.serverUrl);

    const output = await runExpectFailure("go", sendArgs(context.serverUrl, context.home, options.channel, options.prompt));
    if (!output.includes("message did not complete: failed")) {
      throw new Error(`${options.name} did not become a failed terminal message`);
    }
    const messageId = requiredMessageId(output);
    await assertStatusAndAuditOpaque(context.serverUrl, messageId);
  } finally {
    device?.kill("SIGKILL");
    context.stop();
  }
}

async function setupContext(name: string) {
  const home = `${process.cwd()}/.musubi/slice13-${name}`;
  await rm(home, { recursive: true, force: true });
  const { server, serverUrl } = startAvailableRelay();
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Codex Web", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  return {
    home,
    serverUrl,
    stop: () => server.stop(true),
  };
}

function startAvailableRelay() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = nextPort;
    nextPort += 1;
    try {
      return {
        server: startRelay({ hostname: "127.0.0.1", port }),
        serverUrl: `http://127.0.0.1:${port}`,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE" && !String(error).includes("EADDRINUSE")) throw error;
    }
  }
  throw new Error("could not find an available local relay port");
}

async function createGrant(serverUrl: string, allowedChannels: string[]) {
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: allowedChannels,
  });
}

async function writePolicy(home: string, allow: string[]) {
  await mkdir(home, { recursive: true });
  await writeFile(`${home}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      app_001: {
        plugins: {
          codex: {
            allow,
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

function sendArgs(serverUrl: string, home: string, channel: string, text: string) {
  return [
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
    channel,
    "--text",
    text,
  ];
}

async function assertStatusAndAuditOpaque(serverUrl: string, messageId: string) {
  const status = await requestJson(`${serverUrl}/v1/messages/${messageId}`);
  if (status.status !== "failed") throw new Error(`expected failed status for ${messageId}, got ${status.status}`);
  const combined = JSON.stringify({
    status,
    audit: await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`),
  });
  for (const needle of promptNeedles) {
    if (combined.includes(needle)) {
      throw new Error(`audit/status JSON leaked plaintext needle ${needle}`);
    }
  }
}

async function waitForOnline(serverUrl: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function assertCodexCapabilities(serverUrl: string) {
  const response = await requestJson(`${serverUrl}/v1/device-plugin-capabilities`);
  const codex = response.capabilities.find((capability: { plugin_name: string }) => capability.plugin_name === "codex");
  if (!codex) throw new Error("Codex capabilities were not reported");
  if (codex.channels.includes("codex.task.exfiltrate")) {
    throw new Error("Codex reported unsupported channel as a capability");
  }
}

function requiredMessageId(output: string): string {
  const match = output.match(/msg_m1_\d+/);
  if (!match) throw new Error(`could not parse message id from output:\n${output}`);
  return match[0];
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

function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    stream.on("data", (chunk) => {
      output += String(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => resolve(output));
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", resolve));
}
