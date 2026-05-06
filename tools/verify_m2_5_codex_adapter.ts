import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const port = String(33000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/m2-5-codex`;
const workspace = process.cwd();
const prompt = "M25_REAL_CODEX_ADAPTER_PROMPT";
const forbiddenPrompt = "M25_FORBIDDEN_WORKSPACE_PROMPT";
const cancelPrompt = "M25_CANCEL_PROMPT";

await rm(home, { recursive: true, force: true });
await assertArtifacts();
await assertDirectPluginContract();

const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ReturnType<typeof spawn> | undefined;
try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local", "--name", "M2.5 Codex Mac"]);
  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Codex Demo App", "--server", serverUrl, "--home", home, "--workspace", "ws_local"]);
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
  });
  await writePolicy(home, [workspace]);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "if [ \"$1\" = \"M25_CANCEL_PROMPT\" ]; then sleep 2; fi; pwd; printf '\\nM25_RESULT:%s\\n' \"$1\"", "codex-mock"]),
      CODEX_ALLOWED_WORKSPACE_DIRS_JSON: JSON.stringify([workspace]),
      CODEX_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();
  await assertCodexCapabilityVisible();

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
    prompt,
    "--workspace-hint",
    workspace,
    "--max-duration",
    "5",
  ]);
  if (!output.includes(`M25_RESULT:${prompt}`)) throw new Error("real Codex adapter command output did not return encrypted");
  if (!output.includes('"handled_by":"codex"')) throw new Error("result did not identify codex handler");
  if (!output.includes('"task_id":"codex_task_')) throw new Error("result did not include Codex task id");
  const messageId = requiredMessageId(output);

  const message = await requestJson(`${serverUrl}/v1/messages/${messageId}`);
  const statuses = message.status_events.map((event: { status: string }) => event.status);
  for (const required of ["created", "validated", "delivered", "received", "processing", "completed"]) {
    if (!statuses.includes(required)) throw new Error(`message timeline missing ${required}`);
  }
  const combined = JSON.stringify({
    message,
    audit: await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`),
  });
  for (const needle of [prompt, "M25_RESULT"]) {
    if (combined.includes(needle)) throw new Error(`server-visible status/audit leaked plaintext ${needle}`);
  }

  const denied = await runExpectFailure("go", [
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
    forbiddenPrompt,
    "--workspace-hint",
    "/private/not-allowed-m2-5",
  ]);
  if (!denied.includes("message did not complete: failed")) throw new Error("disallowed workspace did not fail terminally");

  const cancelOutput = await run("go", [
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
    cancelPrompt,
    "--workspace-hint",
    workspace,
    "--no-wait",
  ]);
  const cancelledMessageId = requiredMessageId(cancelOutput);
  const cancelResponse = await postJson(`${serverUrl}/v1/messages/${cancelledMessageId}/cancel`, {});
  if (cancelResponse.status !== "cancelled") throw new Error("message cancel did not return cancelled status");
  await Bun.sleep(2500);
  const cancelledMessage = await requestJson(`${serverUrl}/v1/messages/${cancelledMessageId}`);
  const cancelStatuses = cancelledMessage.status_events.map((event: { status: string }) => event.status);
  if (!cancelStatuses.includes("cancel_requested") || !cancelStatuses.includes("cancelled")) {
    throw new Error("message timeline did not include cancel_requested -> cancelled");
  }
  if (cancelledMessage.status !== "cancelled") throw new Error(`cancelled message was overwritten by plugin result: ${cancelledMessage.status}`);

  await postJson(`${serverUrl}/v1/grants/grant_001/revoke`, {});
  const revoked = await runExpectFailure("go", [
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
    "M25_REVOKED_GRANT_PROMPT",
    "--workspace-hint",
    workspace,
  ]);
  if (!revoked.includes("grant denied")) throw new Error("revoked grant did not block future Codex task");
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[m2.5-codex] ok: real Codex adapter contract, workspace policy, encrypted events/results, timeline, audit privacy, and revoke gate verified");
process.exit(0);

async function assertArtifacts() {
  const doc = await Bun.file("docs/codex_adapter_m2_5.md").text();
  for (const required of ["Run approved local Codex tasks", "WORKSPACE_NOT_ALLOWED", "codex.task.create", "codex.task.event"]) {
    if (!doc.includes(required)) throw new Error(`M2.5 Codex adapter doc missing ${required}`);
  }
  const manifest = await Bun.file("plugins/codex/musubi.plugin.json").json();
  for (const required of ["codex.task.create", "codex.task.cancel", "codex.task.status", "codex.task.event"]) {
    if (!manifest.channels.includes(required)) throw new Error(`Codex manifest missing ${required}`);
  }
  if (!manifest.config_schema?.allowed_workspace_dirs?.required) {
    throw new Error("Codex manifest does not require allowed_workspace_dirs config schema");
  }
}

async function assertDirectPluginContract() {
  const missing = await callPlugin([{ channel: "codex.task.create", payload: { body: { instruction: "missing binary" } } }], {
    CODEX_BINARY: "definitely-not-installed-musubi-codex",
  });
  assertFailure(missing.responses[0].result, "CODEX_NOT_INSTALLED");

  const disallowed = await callPlugin([{ channel: "codex.task.create", payload: { body: { instruction: "bad workspace", workspace_hint: "/private/not-allowed-m2-5" } } }], {
    CODEX_ALLOWED_WORKSPACE_DIRS_JSON: JSON.stringify([workspace]),
  });
  assertFailure(disallowed.responses[0].result, "WORKSPACE_NOT_ALLOWED");

  const cancelled = await callPlugin([
    { channel: "codex.task.create", payload: { body: { instruction: "long task", workspace_hint: workspace } } },
    { channel: "codex.task.cancel", payload: { body: { task_id: "__latest__", reason: "verifier cancellation" } } },
  ], {
    CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "sleep 2; echo should-not-complete", "codex-mock"]),
    CODEX_ALLOWED_WORKSPACE_DIRS_JSON: JSON.stringify([workspace]),
    CODEX_TIMEOUT_MS: "5000",
  }, true);
  if (!cancelled.events.find((event: any) => event.params?.body?.event_type === "cancelled")) {
    throw new Error("cancel flow did not emit cancelled event");
  }
}

function assertFailure(result: any, code: string) {
  if (result?.status !== "failed") throw new Error(`expected failed result for ${code}`);
  if (result?.body?.error_code !== code) throw new Error(`expected ${code}, got ${result?.body?.error_code}`);
  if (result?.body?.echo !== "Codex runtime failed") throw new Error("failure text was not sanitized");
}

async function callPlugin(
  requests: Array<{ channel: string; payload: any }>,
  env: Record<string, string>,
  cancelLatest = false,
) {
  const child = spawn("bun", ["run", "plugins/codex/src/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let latestTaskId = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout += text;
    for (const line of text.trim().split("\n")) {
      if (!line) continue;
      const parsed = JSON.parse(line);
      const taskId = parsed.params?.body?.task_id || parsed.result?.body?.task_id;
      if (taskId) latestTaskId = taskId;
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  for (let index = 0; index < requests.length; index += 1) {
    const item = requests[index];
    if (cancelLatest && item.payload.body?.task_id === "__latest__") {
      for (let attempt = 0; attempt < 20 && !latestTaskId; attempt += 1) await Bun.sleep(50);
      item.payload.body.task_id = latestTaskId;
    }
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: index + 1,
      method: "musubi.message.handle",
      params: item,
    })}\n`);
    if (cancelLatest && index === 0) await Bun.sleep(100);
  }
  child.stdin.end();
  const code = await waitForExit(child);
  if (code !== 0) throw new Error(`codex plugin exited ${code}`);
  const lines = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return {
    events: lines.filter((line) => line.method === "musubi.message.event"),
    responses: lines.filter((line) => line.id),
  };
}

async function writePolicy(homePath: string, allowedWorkspaceDirs: string[]) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      app_001: {
        plugins: {
          codex: {
            allow: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
            require_local_confirm: false,
            allowed_workspace_dirs: allowedWorkspaceDirs,
            max_task_duration_seconds: 10,
            approval_mode: "codex_default",
            sandbox_mode: "codex_default",
          },
        },
      },
    },
    plugins: {
      codex: {
        enabled: true,
        permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
        config: {
          codex_binary: "codex",
          default_working_dir: workspace,
          allowed_workspace_dirs: allowedWorkspaceDirs,
        },
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

async function assertCodexCapabilityVisible() {
  const response = await requestJson(`${serverUrl}/v1/device-plugin-capabilities`);
  const codex = response.capabilities.find((capability: { plugin_name: string }) => capability.plugin_name === "codex");
  if (!codex) throw new Error("Codex capability not reported");
  for (const required of ["codex.task.create", "codex.task.cancel", "codex.task.status"]) {
    if (!codex.channels.includes(required)) throw new Error(`Codex capability missing ${required}`);
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

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", resolve));
}
