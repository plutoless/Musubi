import { loadEnvFiles } from "./env.ts";

loadEnvFiles();

const hostedUrl = process.env.MUSUBI_HOSTED_URL;
const basicAuth = process.env.CONTROL_PLANE_BASIC_AUTH;

if (!hostedUrl) {
  throw new Error("MUSUBI_HOSTED_URL is required for verify:control-plane:deployed.");
}
if (!basicAuth) {
  throw new Error("CONTROL_PLANE_BASIC_AUTH is required for verify:control-plane:deployed.");
}

const serverUrl = hostedUrl.replace(/\/$/, "");

const anonymous = await fetch(`${serverUrl}/control-plane`);
if (anonymous.status !== 401) {
  throw new Error(`control plane should require auth, got HTTP ${anonymous.status}`);
}

const headers = {
  Authorization: `Basic ${btoa(basicAuth)}`,
};

const html = await text(`${serverUrl}/control-plane`, headers);
if (!html.includes("Musubi Control Plane") || !html.includes("/control-plane/app.js")) {
  throw new Error("control plane HTML did not include expected app shell");
}

const appJs = await text(`${serverUrl}/control-plane/app.js`, headers);
if (!appJs.includes("Apps can ask. Your machine decides.")) {
  throw new Error("control plane app.js did not include expected Musubi copy");
}

const css = await text(`${serverUrl}/control-plane/styles.css`, headers);
if (!css.includes(".shell") || !css.includes(".sidebar")) {
  throw new Error("control plane styles.css did not include expected layout styles");
}

for (const path of [
  "/v1/devices",
  "/v1/apps",
  "/v1/messages",
  "/v1/audit-events",
  "/v1/device-plugin-capabilities",
  "/v1/authorized-apps",
  "/v1/plugins",
  "/v1/workspace/plugin-policy",
]) {
  await json(`${serverUrl}${path}`, headers);
}

console.log("[control-plane-deployed] ok: deployed control plane is protected, static assets load, and startup APIs respond");
process.exit(0);

async function text(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return body;
}

async function json(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return JSON: ${body.slice(0, 200)}`);
  }
}
