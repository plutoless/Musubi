import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { startRelay } from "../apps/relay-server/src/main.ts";
import {
  MusubiApp,
  createNativeAuthorization,
  exchangeNativeAuthorizationCode,
  generateX25519KeyPair,
  invokeHermes,
} from "../sdk/app-js/src/index.ts";

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

const home = `${process.cwd()}/.musubi/hermes-native-consent`;
const workspaceId = "ws_local";
const prompt = "HERMES_NATIVE_CONSENT_SECRET";

await rm(home, { recursive: true, force: true });
const { server, serverUrl } = startAvailableRelay();
let device: ReturnType<typeof spawn> | undefined;

try {
  const js = await Bun.file("apps/control-plane/app.js").text();
  for (const forbidden of ["MUSUBI_API_KEY", "MUSUBI_APP_PRIVATE_KEY", "--with-hermes", "Authorization: `Basic", "Basic "]) {
    if (js.includes(forbidden)) throw new Error(`control-plane frontend contains forbidden setup/auth string: ${forbidden}`);
  }
  if (!js.includes("loopback PKCE") || !js.includes("Native app consent")) {
    throw new Error("control plane does not expose native consent copy");
  }

  const unauthCreate = await postJsonWithStatus(`${serverUrl}/v1/apps`, {
    workspace_id: workspaceId,
    name: "Unauth App",
    type: "first_party",
  });
  if (unauthCreate.status !== 401) throw new Error("unauthenticated admin app create was not rejected");

  const adminCookie = await adminLogin();
  const app = await postJson<any>(`${serverUrl}/v1/apps`, {
    workspace_id: workspaceId,
    name: "Hermes Companion",
    type: "first_party",
    description: "Native Hermes Companion public client",
  }, adminCookie);
  if (!app.app_id?.startsWith("app_")) throw new Error("admin app creation did not return app id");
  if (app.app_key_id) throw new Error("admin pre-approval should not create a per-install native app key");

  const deviceOutput = await run("go", ["run", "./cmd/musubi", "device", "register", "--server", serverUrl, "--home", home, "--workspace", workspaceId, "--name", "Hermes Native Mac"]);
  if (deviceOutput.includes("--with-hermes") || deviceOutput.includes("MUSUBI_API_KEY")) {
    throw new Error("device registration printed Hermes app secrets");
  }
  await writePolicy(home, app.app_id);
  device = spawn("go", ["run", "./cmd/musubi", "start", "--home", home], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOCACHE: `${process.cwd()}/.cache/go-build`,
      HERMES_COMMAND: "/bin/echo",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  device.stdout.on("data", (chunk) => process.stdout.write(chunk));
  device.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForOnline();

  await expectRedirectDenied(app.app_id, "http://localhost:55555/callback");
  await expectRedirectDenied(app.app_id, "http://127.0.0.1:49151/callback");
  await expectRedirectDenied(app.app_id, "https://127.0.0.1:55555/callback");
  await expectRedirectDenied(app.app_id, "http://127.0.0.1:55555/other");
  await expectRedirectDenied(app.app_id, "http://0.0.0.0:55555/callback");

  const keyPair = generateX25519KeyPair();
  const redirectUri = "http://127.0.0.1:55555/callback";
  const auth = await createNativeAuthorization({
    apiBaseUrl: serverUrl,
    clientId: app.app_id,
    workspaceId,
    redirectUri,
    appPublicKey: keyPair.publicKey,
    state: "native-verifier",
  });
  if (!auth.authorization_id?.startsWith("nativeauth_")) throw new Error("native authorization did not return id");
  if (!auth.authorization_url.includes("#consent/")) throw new Error("native authorization did not return consent URL");

  const consent = await requestJson<any>(`${serverUrl}/v1/consent-requests/${auth.authorization_id}`);
  if (consent.consent_request.kind !== "native_pkce") throw new Error("consent detail did not preserve native kind");
  if (!consent.eligible_devices.find((device: any) => device.id === "dev_001")) throw new Error("native consent did not list registered device");

  const approved = await postJson<any>(`${serverUrl}/v1/consent-requests/${auth.authorization_id}/approve`, {
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
    queueing_allowed: false,
  });
  if (!approved.redirect_uri?.startsWith(redirectUri)) throw new Error("native approval did not redirect to loopback callback");
  const code = new URL(approved.redirect_uri).searchParams.get("code");
  if (!code) throw new Error("native approval callback did not include authorization code");

  const wrongVerifier = await postJsonWithStatus(`${serverUrl}/v1/oauth/native/token`, {
    code,
    redirect_uri: redirectUri,
    code_verifier: "wrong-verifier",
  });
  if (wrongVerifier.status !== 400) throw new Error("token exchange accepted wrong PKCE verifier");

  const token = await exchangeNativeAuthorizationCode({
    apiBaseUrl: serverUrl,
    code,
    redirectUri,
    codeVerifier: auth.codeVerifier,
  }) as any;
  if (!token.access_token?.startsWith("musubi_session_")) throw new Error("native token exchange did not return session token");
  if (JSON.stringify(token).includes("musubi_app_sk_") || JSON.stringify(token).includes(keyPair.privateKey)) {
    throw new Error("native token response exposed long-lived API key or app private key");
  }

  const replay = await postJsonWithStatus(`${serverUrl}/v1/oauth/native/token`, {
    code,
    redirect_uri: redirectUri,
    code_verifier: auth.codeVerifier,
  });
  if (replay.status !== 400) throw new Error("authorization code was reusable");

  const appSessionDenied = await postJsonWithStatus(`${serverUrl}/v1/apps`, {
    workspace_id: workspaceId,
    name: "Session Managed App",
    type: "first_party",
  }, undefined, token.access_token);
  if (appSessionDenied.status !== 403) throw new Error("native app session could manage admin app resources");

  const client = new MusubiApp({
    apiBaseUrl: serverUrl,
    appSessionToken: token.access_token,
    privateKey: keyPair.privateKey,
  });
  const grantedDevices = await client.devices.listGranted();
  if (grantedDevices.length !== 1 || grantedDevices[0].id !== "dev_001") throw new Error("native session did not list approved device");
  if (client.appId !== app.app_id) throw new Error("SDK did not infer app id from native session");

  const invocation = await invokeHermes(client, "dev_001", prompt, { workspaceHint: process.cwd() });
  const result = await invocation.result<any>();
  if (!String(result.body?.echo || "").includes(prompt)) throw new Error("native session Hermes invocation did not complete");
  await assertNoPlaintextLeak(invocation.messageId);

  await postJson(`${serverUrl}/v1/grants/${approved.grant_id}/revoke`, {});
  const deniedPublicKey = await requestJsonWithStatus(`${serverUrl}/v1/app/devices/dev_001/public-key`, token.access_token);
  if (deniedPublicKey.status !== 403) throw new Error("revoked grant still allowed device public key fetch");
  try {
    await invokeHermes(client, "dev_001", "HERMES_NATIVE_REVOKED_SECRET", { workspaceHint: process.cwd() });
    throw new Error("revoked grant still allowed Hermes invocation");
  } catch (error) {
    if (!String(error).includes("grant denied")) throw error;
  }
} finally {
  device?.kill("SIGKILL");
  server.stop(true);
}

console.log("[hermes-native-consent] ok: admin session, simplified setup, loopback PKCE, native session token, encrypted Hermes invoke, and revocation verified");
process.exit(0);

function startAvailableRelay() {
  const firstPort = 36000 + Math.floor(Math.random() * 500);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = firstPort + attempt;
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

async function adminLogin() {
  const response = await fetch(`${serverUrl}/v1/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "musubi-admin-local" }),
  });
  if (!response.ok) throw new Error(`admin login failed: ${response.status} ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("admin login did not set cookie");
  return cookie;
}

async function expectRedirectDenied(appId: string, redirectUri: string) {
  const keyPair = generateX25519KeyPair();
  const denied = await postJsonWithStatus(`${serverUrl}/v1/oauth/native/authorize`, {
    client_id: appId,
    workspace_id: workspaceId,
    redirect_uri: redirectUri,
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
    requested_capabilities: [{ plugin: "hermes", channels: ["hermes.task.create"] }],
    app_public_key: keyPair.publicKey,
  });
  if (denied.status !== 400) throw new Error(`redirect URI was accepted unexpectedly: ${redirectUri}`);
}

async function writePolicy(homePath: string, appId: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(`${homePath}/policy.yaml`, JSON.stringify({
    version: "m1",
    apps: {
      [appId]: {
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await requestJson<any>(`${serverUrl}/v1/devices/dev_001`);
    if (status.device.status === "online") return;
    await Bun.sleep(250);
  }
  throw new Error("device did not become online");
}

async function assertNoPlaintextLeak(messageId: string) {
  const combined = JSON.stringify({
    message: await requestJson(`${serverUrl}/v1/messages/${messageId}`),
    audit: await requestJson(`${serverUrl}/v1/audit-events?message_id=${messageId}`),
  });
  for (const needle of [prompt, "HERMES_NATIVE_REVOKED_SECRET"]) {
    if (combined.includes(needle)) throw new Error(`server-visible data leaked plaintext ${needle}`);
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

async function requestJson<T = any>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json as T;
}

async function requestJsonWithStatus(url: string, bearer?: string) {
  const response = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postJson<T = any>(url: string, body: unknown, cookie?: string, bearer?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json as T;
}

async function postJsonWithStatus(url: string, body: unknown, cookie?: string, bearer?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
