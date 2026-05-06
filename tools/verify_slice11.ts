import { readFileSync } from "node:fs";

const wrangler = readFileSync("server/workers/wrangler.toml", "utf8");
const worker = readFileSync("server/workers/src/index.ts", "utf8");
const durableObject = readFileSync("server/workers/src/durable_objects/DeviceSession.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");

const checks = [
  ["wrangler durable object binding", wrangler.includes("DEVICE_SESSION")],
  ["wrangler DeviceSession migration", wrangler.includes("DeviceSession")],
  ["worker exports DeviceSession", worker.includes("export { DeviceSession }")],
  ["worker routes device connect to durable object", worker.includes("/v1\\/devices") || worker.includes("/^\\/v1\\/devices")],
  ["worker exposes hosted health route", worker.includes("/v1/health")],
  ["worker references Neon config", worker.includes("NEON_DATABASE_URL")],
  ["worker forwards hosted API routes to control durable object", worker.includes('idFromName("__control")')],
  ["package includes Neon serverless driver", packageJson.includes("@neondatabase/serverless")],
  ["package includes hosted local runtime verifier", packageJson.includes("verify:slice11:local")],
  ["package includes deployed hosted verifier", packageJson.includes("verify:slice11:deployed")],
  ["durable object accepts websocket", durableObject.includes("WebSocketPair") && durableObject.includes("server.accept()")],
  ["durable object tracks online status", durableObject.includes('"online"') && durableObject.includes('"offline"')],
  ["durable object imports Neon driver", durableObject.includes('from "@neondatabase/serverless"')],
  ["durable object implements device registration route", durableObject.includes("/v1/devices/register")],
  ["durable object implements capability report route", durableObject.includes("/capabilities") && durableObject.includes("device.capabilities_reported")],
  ["durable object implements app creation route", durableObject.includes("/v1/apps")],
  ["durable object implements grant route", durableObject.includes("/v1/grants")],
  ["durable object implements message route", durableObject.includes("/v1/messages")],
  ["durable object implements cancel route", durableObject.includes("/cancel") && durableObject.includes("handleCancelMessage")],
  ["durable object implements audit route", durableObject.includes("/v1/audit-events")],
  ["durable object routes opaque envelopes to device sessions", durableObject.includes("/internal/device/deliver")],
  ["durable object queues offline allowed messages", durableObject.includes('"queued"') && durableObject.includes("/internal/control/queued")],
  ["durable object records status transitions", durableObject.includes("message.${status}")],
  ["durable object records cancellation statuses", durableObject.includes('"cancel_requested"') && durableObject.includes('"cancelled"')],
  ["durable object expires stale messages", durableObject.includes("isExpired") && durableObject.includes("message expired")],
  ["durable object persists device online status", durableObject.includes("/internal/control/device-status") && durableObject.includes("last_seen_at")],
  ["durable object persists message status to Neon", durableObject.includes("persistMessage") && durableObject.includes("insert into messages")],
  ["durable object persists audit events to Neon", durableObject.includes("persistAuditEvent") && durableObject.includes("insert into audit_events")],
  ["durable object persists capabilities to Neon", durableObject.includes("persistCapability") && durableObject.includes("insert into device_plugin_capabilities")],
  ["durable object persists control-plane rows to Neon", durableObject.includes("persistDevice") && durableObject.includes("insert into devices") && durableObject.includes("persistApp") && durableObject.includes("insert into apps") && durableObject.includes("persistGrant") && durableObject.includes("insert into app_device_channel_grants")],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`Slice 11 check failed: ${name}`);
  console.log(`[slice11] ${name}`);
}

console.log("[slice11] ok: hosted Cloudflare Worker/Durable Object scaffold is present");
