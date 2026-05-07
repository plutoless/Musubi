import { runHostedFlow } from "./verify_m4_hosted_local.ts";
import { loadEnvFiles } from "./env.ts";

loadEnvFiles();
const hostedUrl = process.env.MUSUBI_HOSTED_URL;
if (!hostedUrl) {
  throw new Error("MUSUBI_HOSTED_URL is required for verify:m4-hosted-deployed. Set it in the shell or in .env.local; see .env.example.");
}
if (!process.env.NEON_DATABASE_URL) {
  throw new Error("NEON_DATABASE_URL is required for verify:m4-hosted-deployed. Set it in the shell or in .env.local; see .env.example.");
}

const serverUrl = hostedUrl.replace(/\/$/, "");
const workspaceId = process.env.MUSUBI_HOSTED_WORKSPACE ?? `ws_m4_hosted_deployed_${Date.now()}`;

const health = await fetch(`${serverUrl}/v1/health`).then((response) => response.json() as Promise<{ ok?: boolean; neon_configured?: boolean }>);
if (!health.ok) throw new Error(`hosted health check failed: ${JSON.stringify(health)}`);
if (!health.neon_configured) throw new Error("hosted Worker reports neon_configured=false");

await runHostedFlow(serverUrl, workspaceId);

console.log("[m4-hosted-deployed] ok: deployed hosted M4 trust APIs use Neon-backed state");
process.exit(0);
