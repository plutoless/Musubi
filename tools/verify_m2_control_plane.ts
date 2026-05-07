import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";

const home = `${process.cwd()}/.musubi/m2-control-plane`;
const workspaceId = "ws_local";
const prompt = "M2_CONTROL_PLANE_SECRET_PROMPT";

await rm(home, { recursive: true, force: true });
await assertM2Artifacts();
const { server, serverUrl } = startAvailableRelay();
let device: ReturnType<typeof spawn> | undefined;

try {
  await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", workspaceId, "--name", "M2 Test Mac"]);
  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Hermes Web", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
  await writePolicy(home, "app_001", ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"]);

  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();

  const controlPlaneHtml = await text(`${serverUrl}/control-plane`);
  if (!controlPlaneHtml.includes("Musubi Control Plane")) throw new Error("control plane HTML route did not render");
  const controlPlaneJs = await text(`${serverUrl}/control-plane/app.js`);
  if (!controlPlaneJs.includes("Payload encrypted end-to-end")) throw new Error("control plane JS is missing privacy copy");
  if (!controlPlaneJs.includes("data-edit-grant")) throw new Error("control plane JS is missing grant edit flow");
  if (!controlPlaneJs.includes("message-status-filter") || !controlPlaneJs.includes("audit-event-filter")) {
    throw new Error("control plane JS is missing message/audit filter controls");
  }

  const devices = await requestJson(`${serverUrl}/v1/devices`);
  assertNoPlaintext(devices, "devices list");
  const deviceRow = devices.devices.find((item: { id: string }) => item.id === "dev_001");
  if (!deviceRow || deviceRow.status !== "online") throw new Error("devices list did not show online registered device");
  if (deviceRow.plugin_count < 1) throw new Error("devices list did not include reported plugin count");

  const apps = await requestJson(`${serverUrl}/v1/apps`);
  const appRow = apps.apps.find((item: { id: string }) => item.id === "app_001");
  if (!appRow || appRow.type !== "first_party") throw new Error("apps list did not show first-party app");

  const deviceDetail = await requestJson(`${serverUrl}/v1/devices/dev_001`);
  const hermes = deviceDetail.capabilities.find((item: { plugin_name: string }) => item.plugin_name === "hermes");
  if (!hermes) throw new Error("device detail did not include Hermes capability");
  if (!hermes.channels.includes("hermes.task.create")) throw new Error("Hermes create channel missing from device capability detail");
  if (!deviceDetail.local_policy?.copy?.includes("Local policy")) throw new Error("device detail did not include local policy placeholder copy");

  const createdGrant = await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
    queueing_allowed: false,
    description: "M2 verifier grant",
  });
  if (createdGrant.status !== "active") throw new Error("grant create did not return active status");
  const grantId = createdGrant.grant_id;
  const editedGrant = await patchJson(`${serverUrl}/v1/grants/${grantId}`, {
    allowed_channels: ["hermes.task.create", "hermes.task.status"],
    queueing_allowed: true,
    description: "M2 verifier edited grant",
  });
  if (!editedGrant.grant?.allowed_channels?.includes("hermes.task.status")) {
    throw new Error("grant edit did not preserve edited channel selection");
  }
  if (editedGrant.grant?.queueing_allowed !== true) {
    throw new Error("grant edit did not update queueing flag");
  }
  const seededDeveloper = await postJson<any>(`${serverUrl}/v1/developers`, {
    name: "M2 Verify Developer",
    email: "third-party@m2.verify",
  });
  const seededPublisher = await postJson<any>(`${serverUrl}/v1/publishers`, {
    developer_id: seededDeveloper.developer.id,
    display_name: "M2 Verify Publisher",
    website: "https://example.test",
    privacy_policy_url: "https://example.test/privacy",
  });
  await postJson(`${serverUrl}/v1/publishers/${seededPublisher.publisher.id}`, { verification_status: "verified" });
  const seededSecondDeveloper = await postJson<any>(`${serverUrl}/v1/developers`, {
    name: "M2 Verify Developer 2",
    email: "third-party-2@m2.verify",
  });
  const seededSecondPublisher = await postJson<any>(`${serverUrl}/v1/publishers`, {
    developer_id: seededSecondDeveloper.developer.id,
    display_name: "M2 Verify Publisher 2",
    website: "https://example-2.test",
    privacy_policy_url: "https://example-2.test/privacy",
  });
  const thirdPartyAppOne = await postJson<any>(`${serverUrl}/v1/developer/apps`, {
    workspace_id: workspaceId,
    name: "M2 Verify Third-party App One",
    publisher_id: seededPublisher.publisher.id,
    public_key: "m2_verify_partner_public_key_1",
  });
  const thirdPartyAppTwo = await postJson<any>(`${serverUrl}/v1/developer/apps`, {
    workspace_id: workspaceId,
    name: "M2 Verify Third-party App Two",
    publisher_id: seededSecondPublisher.publisher.id,
    public_key: "m2_verify_partner_public_key_2",
  });
  await postJson(`${serverUrl}/v1/apps/${thirdPartyAppOne.app_id}/api-keys`, { name: "Verifier extra key 1" });
  await postJson(`${serverUrl}/v1/apps/${thirdPartyAppOne.app_id}/api-keys`, { name: "Verifier extra key 2" });
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: thirdPartyAppOne.app_id,
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create"],
  });
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: thirdPartyAppTwo.app_id,
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create"],
  });
  const secondSend = await run("go", sendArgs("app_001", "hermes.task.create", "M2_SECOND_MESSAGE"));
  const secondMessageId = requiredMatch(secondSend, /(msg_m1_\d+)/, "second message id");
  if (!secondMessageId) {
    throw new Error("second Hermes message send did not return a message id");
  }

  const completedOutput = await run("go", sendArgs("app_001", "hermes.task.create", prompt));
  if (!completedOutput.includes("completed")) throw new Error("Hermes task did not complete through M1 flow");
  const messageId = requiredMatch(completedOutput, /(msg_m1_\d+)/, "message id");

  const messages = await requestJson(`${serverUrl}/v1/messages?app_id=app_001`);
  assertNoPlaintext(messages, "messages list");
  if (!messages.messages.find((item: { id: string; status: string }) => item.id === messageId && item.status === "completed")) {
    throw new Error("messages list did not include completed Hermes message");
  }

  const messageDetail = await requestJson(`${serverUrl}/v1/messages/${messageId}`);
  assertNoPlaintext(messageDetail, "message detail");
  const statuses = messageDetail.status_events.map((event: { status: string }) => event.status);
  for (const required of ["created", "validated", "delivered", "received", "processing", "completed"]) {
    if (!statuses.includes(required)) throw new Error(`message detail timeline missing ${required}`);
  }
  if (!messageDetail.crypto?.sender_key_id || !messageDetail.crypto?.recipient_key_id) {
    throw new Error("message detail did not include crypto metadata");
  }

  const audit = await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`);
  assertNoPlaintext(audit, "audit detail");
  if (!audit.audit_events.find((event: { event_type: string }) => event.event_type === "message.completed")) {
    throw new Error("audit did not include message.completed");
  }
  await expectPagedList(`${serverUrl}/v1/device-plugin-capabilities`, "capabilities");
  await expectPagedList(`${serverUrl}/v1/audit-events`, "audit_events");
  await expectPagedList(`${serverUrl}/v1/devices`, "devices");
  await expectPagedList(`${serverUrl}/v1/apps`, "apps", true);
  await expectPagedList(`${serverUrl}/v1/grants`, "grants", true);
  await expectPagedList(`${serverUrl}/v1/messages?app_id=app_001`, "messages", true);
  await expectPagedList(`${serverUrl}/v1/developers`, "developers", true);
  await expectPagedList(`${serverUrl}/v1/publishers`, "publishers", true);
  await expectPagedList(`${serverUrl}/v1/authorized-apps`, "authorized_apps", true);
  await expectPagedList(`${serverUrl}/v1/apps/${thirdPartyAppOne.app_id}/api-keys`, "api_keys", true);
  await expectPagedList(`${serverUrl}/v1/plugins`, "plugins");

  await postJson(`${serverUrl}/v1/grants/${grantId}/revoke`, {});
  await expectSendDenied("app_001", "hermes.task.create", "M2_GRANT_REVOKED_SECRET", "grant denied");

  const secondGrant = await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: "app_001",
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create"],
  });
  if (secondGrant.status !== "active") throw new Error("second grant was not created");
  await postJson(`${serverUrl}/v1/apps/app_001/revoke`, {});
  await expectSendDenied("app_001", "hermes.task.create", "M2_APP_REVOKED_SECRET", "app denied");

  await run("go", ["run", "./cmd/musubi", "dev", "app", "create", "Device Revoke Test", "--server", serverUrl, "--home", home, "--workspace", workspaceId]);
  await expectPagedList(`${serverUrl}/v1/apps`, "apps");
  await postJson(`${serverUrl}/v1/grants`, {
    workspace_id: workspaceId,
    app_id: "app_002",
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create"],
  });
  await postJson(`${serverUrl}/v1/devices/dev_001/revoke`, {});
  await expectSendDenied("app_002", "hermes.task.create", "M2_DEVICE_REVOKED_SECRET", "device revoked");
  const revokedDevice = await requestJson(`${serverUrl}/v1/devices/dev_001`);
  if (revokedDevice.device.status !== "revoked") throw new Error("device detail did not show revoked status");

  device?.kill("SIGKILL");
  device = undefined;
  await expectDeviceReconnectDenied();
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[m2-control-plane] ok: local control plane APIs, UI route, grant flow, timeline, audit privacy, and revokes verified");
process.exit(0);

function startAvailableRelay() {
  const firstPort = 30000 + Math.floor(Math.random() * 500);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = firstPort + attempt;
    try {
      return {
        server: startRelay({ hostname: "127.0.0.1", port }),
        serverUrl: `http://127.0.0.1:${port}`,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE" && !String(error).includes("EADDRINUSE")) {
        throw error;
      }
    }
  }
  throw new Error("could not find an available local relay port");
}

async function assertM2Artifacts() {
  const productContract = await Bun.file("docs/control_plane_m2.md").text();
  for (const required of ["/control-plane", "Route Map", "Payload encrypted end-to-end", "verify:m2-control-plane"]) {
    if (!productContract.includes(required)) throw new Error(`M2 product contract missing ${required}`);
  }
  const plan = await Bun.file("docs/musubi_m_2_control_plane_plan.md").text();
  if (!plan.includes("Implementation source plan")) throw new Error("M2 plan status was not updated");
  const migration = await Bun.file("migrations/005_control_plane_m2.sql").text();
  for (const required of ["message_status_events", "local_policy_reports", "last_capability_report_at", "revoked_by"]) {
    if (!migration.includes(required)) throw new Error(`M2 migration missing ${required}`);
  }
}

async function writePolicy(homePath: string, appId: string, allow: string[]) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
        plugins: {
          hermes: {
            allow,
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

function sendArgs(appId: string, channel: string, textValue: string) {
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
    appId,
    "--channel",
    channel,
    "--text",
    textValue,
  ];
}

async function waitForOnline() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await requestJson(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function expectSendDenied(appId: string, channel: string, textValue: string, expectedError: string) {
  const output = await runExpectFailure("go", sendArgs(appId, channel, textValue));
  if (!output.includes("send failed: 403")) throw new Error(`send was not denied at server authorization: ${output}`);
  if (!output.includes(expectedError)) throw new Error(`send denial did not include ${expectedError}: ${output}`);
  const deniedMessageId = requiredMatch(output, /(msg_m1_\d+)/, "denied message id");
  const detail = await requestJson(`${serverUrl}/v1/messages/${deniedMessageId}`);
  assertNoPlaintext(detail, `denied message ${deniedMessageId}`);
}

async function expectDeviceReconnectDenied() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
      cwd: process.cwd(),
      env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("revoked device start did not fail promptly"));
    }, 4000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      process.stderr.write(chunk);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) reject(new Error("revoked device start exited successfully"));
      else if (!output.includes("websocket upgrade failed: 401 Unauthorized")) reject(new Error(`revoked device reconnect did not fail with 401: ${output}`));
      else resolve();
    });
  });
}

function assertNoPlaintext(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  for (const needle of [prompt, "M2_GRANT_REVOKED_SECRET", "M2_APP_REVOKED_SECRET", "M2_DEVICE_REVOKED_SECRET"]) {
    if (serialized.includes(needle)) throw new Error(`${label} leaked plaintext needle ${needle}`);
  }
}

async function expectPagedList(url: string, key: string, requireNextCursor = false) {
  const firstUrl = new URL(url);
  firstUrl.searchParams.set("limit", "1");
  const first = await requestJson(firstUrl.toString());
  if (!Array.isArray(first[key]) || first[key].length !== 1) {
    throw new Error(`${key} first page did not honor limit=1`);
  }
  if (requireNextCursor && (!first.next_cursor || typeof first.next_cursor !== "string")) {
    throw new Error(`${key} first page did not return next_cursor`);
  }
  if (!first.next_cursor) return;
  const secondUrl = new URL(url);
  secondUrl.searchParams.set("limit", "1");
  secondUrl.searchParams.set("cursor", first.next_cursor);
  const second = await requestJson(secondUrl.toString());
  if (!Array.isArray(second[key]) || second[key].length !== 1) {
    throw new Error(`${key} second page did not honor limit=1`);
  }
  if (JSON.stringify(second[key][0]) === JSON.stringify(first[key][0])) {
    throw new Error(`${key} cursor returned the same row twice`);
  }
}

function requiredMatch(output: string, pattern: RegExp, label: string): string {
  const match = output.match(pattern);
  if (!match) throw new Error(`could not parse ${label} from output:\n${output}`);
  return match[1];
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
  return JSON.parse(await text(url));
}

async function text(url: string): Promise<string> {
  const proc = Bun.spawn(["curl", "--noproxy", "127.0.0.1", "-sS", url], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout;
}

async function postJson(url: string, body: unknown): Promise<any> {
  return sendJson("POST", url, body);
}

async function patchJson(url: string, body: unknown): Promise<any> {
  return sendJson("PATCH", url, body);
}

async function sendJson(method: string, url: string, body: unknown): Promise<any> {
  const proc = Bun.spawn([
    "curl",
    "--noproxy",
    "127.0.0.1",
    "-sS",
    "-X",
    method,
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
