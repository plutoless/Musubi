import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";
import { MusubiApp, echoPayload, invokeCodex, invokeHermes, MusubiAuthError } from "../sdk/app-js/src/index.ts";

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

const port = String(34000 + Math.floor(Math.random() * 1000));
const serverUrl = `http://127.0.0.1:${port}`;
const home = `${process.cwd()}/.musubi/m3-app-sdk`;
const workspace = process.cwd();
const echoText = "M3_APP_SDK_ECHO_SECRET";
const hermesText = "M3_APP_SDK_HERMES_SECRET";
const codexText = "M3_APP_SDK_CODEX_SECRET";

await rm(home, { recursive: true, force: true });
await assertArtifacts();

const server = startRelay({ hostname: "127.0.0.1", port: Number(port) });
let device: ReturnType<typeof spawn> | undefined;
try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", "ws_local", "--name", "M3 SDK Mac"]);
  const envOutput = await run("go", [
    "run",
    "./cmd/musubi",
    "app",
    "create",
    "M3 User App",
    "--server",
    serverUrl,
    "--home",
    home,
    "--workspace",
    "ws_local",
    "--type",
    "user_owned",
    "--generate-key-local",
    "--env",
  ]);
  const sdkEnv = parseEnv(envOutput);
  if (!sdkEnv.MUSUBI_API_KEY?.startsWith("musubi_app_sk_")) throw new Error("CLI did not print app API key");
  if (!sdkEnv.MUSUBI_APP_PRIVATE_KEY) throw new Error("CLI did not print app private key");

  const appDetail = await requestJson(`${serverUrl}/v1/apps/${sdkEnv.MUSUBI_APP_ID}`);
  if (JSON.stringify(appDetail).includes(sdkEnv.MUSUBI_APP_PRIVATE_KEY)) throw new Error("server exposed app private key");
  if (JSON.stringify(appDetail.api_keys).includes(sdkEnv.MUSUBI_API_KEY)) throw new Error("server exposed app API key secret");
  if (appDetail.app.type !== "user_owned") throw new Error("created app was not user_owned");

  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: sdkEnv.MUSUBI_APP_ID,
    device_id: "dev_001",
    allowed_channels: [
      "echo.echo",
      "hermes.task.create",
      "hermes.task.cancel",
      "codex.task.create",
      "codex.task.cancel",
      "codex.task.status",
    ],
  });
  await writePolicy(home, sdkEnv.MUSUBI_APP_ID, [workspace]);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      HERMES_COMMAND: "/bin/echo",
      CODEX_COMMAND_JSON: JSON.stringify(["/bin/sh", "-c", "if [ \"$1\" = \"M3_CANCEL_SECRET\" ]; then sleep 2; fi; printf 'M3_CODEX_RESULT:%s\\n' \"$1\"", "codex-mock"]),
      CODEX_ALLOWED_WORKSPACE_DIRS_JSON: JSON.stringify([workspace]),
      CODEX_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();

  const client = new MusubiApp({
    apiBaseUrl: serverUrl,
    appId: sdkEnv.MUSUBI_APP_ID,
    appKeyId: sdkEnv.MUSUBI_APP_KEY_ID,
    apiKey: sdkEnv.MUSUBI_API_KEY,
    privateKey: sdkEnv.MUSUBI_APP_PRIVATE_KEY,
    workspaceId: "ws_local",
  });
  const devices = await client.devices.listGranted();
  if (devices.length !== 1 || devices[0].id !== "dev_001") throw new Error("SDK did not list granted device");

  const echoInvocation = await client.invoke({
    deviceId: "dev_001",
    channel: "echo.echo",
    payload: echoPayload(echoText),
  });
  const echoEvents = await collectEvents(echoInvocation);
  const echoResult = await echoInvocation.result<any>();
  if (echoResult.body?.echo !== echoText) throw new Error("SDK encrypted echo did not round trip");
  if (!echoEvents.find((event) => event.status === "processing")) throw new Error("SDK did not receive/decrypt processing event");
  await assertNoPlaintextLeak(echoInvocation.messageId, [echoText]);

  const hermesInvocation = await invokeHermes(client, "dev_001", hermesText, { workspaceHint: workspace });
  const hermesResult = await hermesInvocation.result<any>();
  if (!String(hermesResult.body?.echo || "").includes(hermesText)) throw new Error("SDK Hermes invocation did not return encrypted result");
  await assertNoPlaintextLeak(hermesInvocation.messageId, [hermesText]);

  const codexInvocation = await invokeCodex(client, "dev_001", codexText, { workspaceHint: workspace, maxDurationSeconds: 5 });
  const codexEvents = await collectEvents(codexInvocation);
  const codexResult = await codexInvocation.result<any>();
  if (!String(codexResult.body?.echo || "").includes(`M3_CODEX_RESULT:${codexText}`)) throw new Error("SDK Codex invocation did not return encrypted result");
  if (!codexEvents.find((event) => event.payload?.body?.event_type === "accepted")) throw new Error("SDK did not stream Codex accepted event");
  await assertNoPlaintextLeak(codexInvocation.messageId, [codexText, "M3_CODEX_RESULT"]);

  const cancelInvocation = await client.invoke({
    deviceId: "dev_001",
    channel: "codex.task.create",
    payload: {
      type: "codex.task.create",
      body: { instruction: "M3_CANCEL_SECRET", workspace_hint: workspace, stream: true },
    },
  });
  const cancel = await cancelInvocation.cancel({
    reason: "M3 verifier",
    cancelChannel: "codex.task.cancel",
    payload: { type: "codex.task.cancel", body: { reason: "M3 verifier" } },
  });
  if (cancel.status !== "cancelled") throw new Error("SDK cancellation did not return cancelled");

  const forbiddenGrant = await postJsonWithStatus(`${serverUrl}/v1/grants`, {
    workspace_id: "ws_local",
    app_id: sdkEnv.MUSUBI_APP_ID,
    device_id: "dev_001",
    allowed_channels: ["echo.echo"],
  }, sdkEnv.MUSUBI_API_KEY);
  if (forbiddenGrant.status !== 403) throw new Error("app API key was able to manage grants");

  const keyList = await requestJson(`${serverUrl}/v1/apps/${sdkEnv.MUSUBI_APP_ID}/api-keys`);
  const keyId = keyList.api_keys[0].id;
  await postJson(`${serverUrl}/v1/apps/${sdkEnv.MUSUBI_APP_ID}/api-keys/${keyId}/revoke`, {});
  const revokedClient = new MusubiApp({
    apiBaseUrl: serverUrl,
    appId: sdkEnv.MUSUBI_APP_ID,
    apiKey: sdkEnv.MUSUBI_API_KEY,
    privateKey: sdkEnv.MUSUBI_APP_PRIVATE_KEY,
  });
  try {
    await revokedClient.devices.listGranted();
    throw new Error("revoked API key still worked");
  } catch (error) {
    if (!(error instanceof MusubiAuthError)) throw error;
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[m3-app-sdk] ok: user-owned app CLI, hashed API keys, SDK encrypted invoke/events/result/cancel, scoped auth, and audit privacy verified");
process.exit(0);

async function assertArtifacts() {
  for (const file of [
    "docs/app_sdk_m3.md",
    "docs/sdk/app-sdk-js.md",
    "docs/guides/create-user-owned-app.md",
    "docs/guides/send-hermes-task.md",
    "docs/guides/send-codex-task.md",
    "docs/security/app-keys-vs-api-keys.md",
  ]) {
    if (!(await Bun.file(file).exists())) throw new Error(`missing ${file}`);
  }
}

async function writePolicy(homePath: string, appId: string, allowedWorkspaceDirs: string[]) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          echo: { allow: ["echo.echo"], require_local_confirm: false },
          hermes: { allow: ["hermes.task.create", "hermes.task.cancel"], require_local_confirm: false },
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
      echo: { enabled: true, permissions: ["status.report"] },
      hermes: { enabled: true, permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"] },
      codex: {
        enabled: true,
        permissions: ["process.spawn", "fs.read.project", "fs.write.project", "network.outbound"],
        config: { codex_binary: "codex", default_working_dir: workspace, allowed_workspace_dirs: allowedWorkspaceDirs },
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

async function collectEvents(invocation: any) {
  const events: any[] = [];
  for await (const event of invocation.events()) events.push(event);
  return events;
}

async function assertNoPlaintextLeak(messageId: string, needles: string[]) {
  const combined = JSON.stringify({
    message: await requestJson(`${serverUrl}/v1/messages/${messageId}`),
    audit: await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`),
  });
  for (const needle of needles) {
    if (combined.includes(needle)) throw new Error(`server-visible data leaked plaintext ${needle}`);
  }
}

function parseEnv(output: string) {
  const env: Record<string, string> = {};
  for (const line of output.trim().split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
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
  const response = await postJsonWithStatus(url, body);
  if (response.status < 200 || response.status >= 300) throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function postJsonWithStatus(url: string, body: unknown, bearer?: string): Promise<{ status: number; body: any }> {
  const args = [
    "--noproxy",
    "127.0.0.1",
    "-sS",
    "-w",
    "\n%{http_code}",
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
  ];
  if (bearer) args.push("-H", `Authorization: Bearer ${bearer}`);
  args.push("--data-binary", JSON.stringify(body), url);
  const proc = Bun.spawn(["curl", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  const lines = stdout.trimEnd().split("\n");
  const status = Number(lines.pop());
  const bodyText = lines.join("\n");
  return { status, body: bodyText ? JSON.parse(bodyText) : {} };
}
