import { readFileSync } from "node:fs";

const checks = [
  ["M1 architecture doc", "docs/architecture_m1.md", ["Exit Criteria", "Trust Boundaries"]],
  ["Hosted deployment runbook", "docs/hosted_m1_deployment.md", ["Hosted M1 Completion Gate", "NEON_DATABASE_URL", "wrangler deploy"]],
  ["README hosted verification commands", "README.md", ["db:migrate:neon", "verify:slice11:local", "verify:slice11:deployed"]],
  ["Hermes runtime contract", "plugins/hermes/README.md", ["HERMES_COMMAND", "Runtime contract", "Hermes runtime failed", "verify:slice10:hermes"]],
  ["Hosted local runtime verifier", "package.json", ["verify:slice11:local", "verify_slice11_hosted_local.ts"]],
  ["Hosted deployed verifier", "package.json", ["verify:slice11:deployed", "verify_slice11_deployed.ts"]],
  ["Hosted Neon migration command", "package.json", ["db:migrate:neon", "apply_neon_migrations.ts"]],
  ["CLI YAML local policy parser", "cmd/musubi/main.go", ["gopkg.in/yaml.v3", "yaml.Unmarshal", "yaml:\"require_local_confirm\""]],
  ["CLI terminal confirmation gate", "cmd/musubi/main.go", ["confirmLocalExecution", "Type yes to approve", "LOCAL_POLICY_DENIED: local confirmation rejected"]],
  ["CLI replay protection", "cmd/musubi/main.go", ["replayCache", "REPLAY_REJECTED: duplicate message_id", "REPLAY_REJECTED: duplicate payload nonce"]],
  ["CLI app-bound event channels", "cmd/musubi/main.go", ["resultChannelFor", "hermes.task.event", "echo.event"]],
  ["CLI capability reporting", "cmd/musubi/main.go", ["reportPluginCapabilities", "/capabilities", "reported plugin capabilities"]],
  ["CLI encrypted progress event", "cmd/musubi/main.go", ["registeredProgressEnvelope", "task.progress", "plugin accepted message"]],
  ["Relay TTL expiration", "apps/relay-server/src/main.ts", ["isExpired", "message expired", "expired"]],
  ["Relay offline queueing", "apps/relay-server/src/main.ts", ["queueing_allowed", "queued", "device connected"]],
  ["Worker config", "server/workers/wrangler.toml", ["DEVICE_SESSION", "DeviceSession"]],
  ["Hosted Worker API routes", "server/workers/src/durable_objects/DeviceSession.ts", ["/v1/devices/register", "/capabilities", "/v1/apps", "/v1/grants", "/v1/messages", "/cancel", "/v1/audit-events"]],
  ["Hosted Neon persistence hooks", "server/workers/src/durable_objects/DeviceSession.ts", ["@neondatabase/serverless", "/internal/control/device-status", "insert into devices", "insert into apps", "insert into app_device_channel_grants", "insert into messages", "insert into audit_events"]],
  ["Message/audit migrations", "migrations/003_messages_audit.sql", ["create table if not exists messages", "create table if not exists audit_events"]],
  ["Capability migration", "migrations/004_device_plugin_capabilities.sql", ["create table if not exists device_plugin_capabilities", "manifest jsonb"]],
] as const;

for (const [name, path, required] of checks) {
  const content = readFileSync(path, "utf8");
  for (const expected of required) {
    if (!content.includes(expected)) {
      throw new Error(`${name} is missing ${expected}`);
    }
  }
  console.log(`[m1-readiness] ${name}`);
}

console.log("[m1-readiness] ok: M1 docs and deployment/runtime readiness artifacts are present");
