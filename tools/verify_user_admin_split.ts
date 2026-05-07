import { rm } from "node:fs/promises";
import { startRelay } from "../apps/relay-server/src/main.ts";
import { createNativeAuthorization, exchangeNativeAuthorizationCode, generateX25519KeyPair } from "../sdk/app-js/src/index.ts";

process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = ["127.0.0.1", "localhost", process.env.no_proxy].filter(Boolean).join(",");

const home = `${process.cwd()}/.musubi/user-admin-split`;
const workspaceId = "ws_local";

await rm(home, { recursive: true, force: true });
const { server, serverUrl } = startAvailableRelay();

try {
  const redirect = await fetch(`${serverUrl}/control-plane`, { redirect: "manual" });
  if (redirect.status !== 302 || !redirect.headers.get("location")?.endsWith("/control-plane/user")) {
    throw new Error("/control-plane did not redirect to the user UI");
  }
  const userHtml = await text(`${serverUrl}/control-plane/user`);
  const adminHtml = await text(`${serverUrl}/control-plane/admin`);
  if (!userHtml.includes("Musubi Control Plane") || !adminHtml.includes("Musubi Control Plane")) {
    throw new Error("split control-plane URLs did not serve the SPA");
  }
  for (const forbidden of ["primary-nav", "sidebar", "Admin Home", "Authorized Apps", "Refresh"]) {
    if (userHtml.includes(forbidden) || adminHtml.includes(forbidden)) {
      throw new Error(`unauthenticated control-plane HTML leaked shell navigation: ${forbidden}`);
    }
  }
  const js = await text(`${serverUrl}/control-plane/app.js`);
  for (const required of ["/v1/user/signup", "/v1/user/login", "/v1/user/device-registration-tokens", "/v1/users", "/control-plane/admin", "/control-plane/user", "--registration-token"]) {
    if (!js.includes(required)) throw new Error(`control-plane split is missing ${required}`);
  }
  for (const required of ["auth-shell", "ensureAuthShell", "ensureAppShell"]) {
    if (!js.includes(required)) throw new Error(`control-plane auth shell is missing ${required}`);
  }
  const envExample = await Bun.file(".env.example").text();
  for (const required of ["MUSUBI_ADMIN_USERNAME=admin", "MUSUBI_ADMIN_PASSWORD=musubi-admin-local"]) {
    if (!envExample.includes(required)) throw new Error(`.env.example is missing ${required}`);
  }

  const unauthApp = await postJsonWithStatus(`${serverUrl}/v1/apps`, { workspace_id: workspaceId, name: "Denied", type: "first_party" });
  if (unauthApp.status !== 401) throw new Error("unauthenticated admin app create was not rejected");

  const adminCookie = await adminLogin();
  const app = await postJson<any>(`${serverUrl}/v1/apps`, {
    workspace_id: workspaceId,
    name: "Hermes Companion",
    type: "first_party",
  }, adminCookie);
  if (!app.app_id) throw new Error("admin did not create Hermes Companion app");

  const userOneCookie = await userSignup("user-one@example.test", "User One");
  const userTwoCookie = await userSignup("user-two@example.test", "User Two");
  const adminUsers = await requestJson<any>(`${serverUrl}/v1/users`, adminCookie);
  if (!adminUsers.users.some((user: any) => user.email === "user-one@example.test") || JSON.stringify(adminUsers).includes("password_hash")) {
    throw new Error("admin users list did not expose safe user account metadata");
  }
  const userAppCreate = await postJsonWithStatus(`${serverUrl}/v1/apps`, { workspace_id: workspaceId, name: "User App", type: "first_party" }, userOneCookie);
  if (userAppCreate.status !== 401) throw new Error("normal user session managed admin app resources");

  const token = await postJson<any>(`${serverUrl}/v1/user/device-registration-tokens`, { workspace_id: workspaceId }, userOneCookie);
  if (!token.registration_token?.startsWith("musubi_devreg_")) throw new Error("device registration token was not issued");
  const registerOutput = await run("go", [
    "run", "./cmd/musubi", "device", "register",
    "--server", serverUrl,
    "--home", home,
    "--workspace", workspaceId,
    "--name", "User One Mac",
    "--registration-token", token.registration_token,
  ]);
  if (!registerOutput.includes("registered device dev_001")) throw new Error(`device registration did not use the user token:\n${registerOutput}`);

  const reusedToken = await postJsonWithStatus(`${serverUrl}/v1/devices/register`, {
    workspace_id: workspaceId,
    device_name: "Replay",
    platform: "test",
    cli_version: "0.1.0",
    public_key: "pub",
    registration_token: token.registration_token,
  });
  if (reusedToken.status !== 403) throw new Error("device registration token was reusable");

  const userOneDevices = await requestJson<any>(`${serverUrl}/v1/devices`, userOneCookie);
  if (!userOneDevices.devices.some((device: any) => device.id === "dev_001")) throw new Error("owner user cannot see registered device");
  const userTwoDevices = await requestJson<any>(`${serverUrl}/v1/devices`, userTwoCookie);
  if (userTwoDevices.devices.some((device: any) => device.id === "dev_001")) throw new Error("second user can see first user's device");
  const userTwoDeviceDetail = await requestJsonWithStatus(`${serverUrl}/v1/devices/dev_001`, userTwoCookie);
  if (userTwoDeviceDetail.status !== 404) throw new Error("second user can inspect first user's device");

  const keys = generateX25519KeyPair();
  const redirectUri = "http://127.0.0.1:55555/callback";
  const auth = await createNativeAuthorization({
    apiBaseUrl: serverUrl,
    clientId: app.app_id,
    workspaceId,
    redirectUri,
    appPublicKey: keys.publicKey,
  }) as any;
  const userTwoConsent = await requestJson<any>(`${serverUrl}/v1/consent-requests/${auth.authorization_id}`, userTwoCookie);
  if (userTwoConsent.devices.some((device: any) => device.id === "dev_001")) throw new Error("consent listed another user's device");
  const deniedApproval = await postJsonWithStatus(`${serverUrl}/v1/consent-requests/${auth.authorization_id}/approve`, {
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create"],
  }, userTwoCookie);
  if (deniedApproval.status !== 403) throw new Error("second user approved first user's device");

  const approved = await postJson<any>(`${serverUrl}/v1/consent-requests/${auth.authorization_id}/approve`, {
    device_id: "dev_001",
    allowed_channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
  }, userOneCookie);
  const code = new URL(approved.redirect_uri).searchParams.get("code");
  if (!code) throw new Error("native consent approval did not return code");
  const nativeToken = await exchangeNativeAuthorizationCode({
    apiBaseUrl: serverUrl,
    code,
    redirectUri,
    codeVerifier: auth.codeVerifier,
  }) as any;
  const nativeDevices = await requestJson<any>(`${serverUrl}/v1/app/devices`, undefined, nativeToken.access_token);
  if (!nativeDevices.devices.some((device: any) => device.id === "dev_001")) throw new Error("native session cannot see approved device");

  await postJson(`${serverUrl}/v1/apps/${app.app_id}/revoke`, {}, userOneCookie);
  const nativeDevicesAfterRevoke = await requestJson<any>(`${serverUrl}/v1/app/devices`, undefined, nativeToken.access_token);
  if (nativeDevicesAfterRevoke.devices.some((device: any) => device.id === "dev_001")) throw new Error("user app revoke did not revoke owned grants");

  console.log("[user-admin-split] ok: user/admin URLs, user sessions, device ownership, token registration, and consent scoping verified");
} finally {
  server.stop(true);
}

function startAvailableRelay() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      const server = startRelay({ port });
      return { server, serverUrl: `http://127.0.0.1:${port}` };
    } catch {
      continue;
    }
  }
  throw new Error("no available local relay port");
}

async function adminLogin() {
  const response = await fetch(`${serverUrl}/v1/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "musubi-admin-local" }),
  });
  if (!response.ok) throw new Error(`admin login failed: ${response.status} ${await response.text()}`);
  return cookieFrom(response);
}

async function userSignup(email: string, name: string) {
  const response = await fetch(`${serverUrl}/v1/user/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password: "password-123", workspace_id: workspaceId }),
  });
  if (!response.ok) throw new Error(`user signup failed: ${response.status} ${await response.text()}`);
  return cookieFrom(response);
}

function cookieFrom(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("response did not set a session cookie");
  return cookie;
}

async function text(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.text();
}

async function requestJson<T = any>(url: string, cookie?: string, bearer?: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function requestJsonWithStatus(url: string, cookie?: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postJson<T = any>(url: string, body: unknown, cookie?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function postJsonWithStatus(url: string, body: unknown, cookie?: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function run(command: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}
