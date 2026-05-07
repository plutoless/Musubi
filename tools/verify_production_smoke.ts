import { loadEnvFiles } from "./env.ts";

loadEnvFiles();

const hostedUrl = process.env.MUSUBI_HOSTED_URL;
if (!hostedUrl) {
  throw new Error("MUSUBI_HOSTED_URL is required for verify:production-smoke. Set PROD_MUSUBI_HOSTED_URL in GitHub Actions or MUSUBI_HOSTED_URL locally.");
}

const serverUrl = hostedUrl.replace(/\/$/, "");
const response = await fetch(`${serverUrl}/v1/health`);
const body = await response.text();
const health = parseHealth(body);

if (!response.ok) {
  throw new Error(`production health request failed with HTTP ${response.status}: ${JSON.stringify(health)}`);
}
if (health.ok !== true) {
  throw new Error(`production health check returned ok=${JSON.stringify(health.ok)}: ${JSON.stringify(health)}`);
}
if (health.neon_configured !== true) {
  throw new Error("production Worker reports neon_configured=false; set the NEON_DATABASE_URL Wrangler secret for production and redeploy");
}
if (health.env !== "production") {
  throw new Error(`production Worker reports env=${JSON.stringify(health.env)}, expected "production"`);
}

console.log("[production-smoke] ok: production health reports ok=true, neon_configured=true, env=production");
process.exit(0);

function parseHealth(body: string): {
  ok?: boolean;
  env?: string;
  neon_configured?: boolean;
} {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`production health response was not JSON: ${body.slice(0, 200)}`);
  }
}
