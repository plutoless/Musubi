# Hosted M1 Deployment

This runbook describes the hosted target for Musubi M1: Cloudflare Workers, a Durable Object `DeviceSession`, and Neon Postgres.

## Prerequisites

- Cloudflare account with Workers and Durable Objects enabled.
- `wrangler` authenticated for the target account.
- Separate staging and production Neon Postgres databases.
- `NEON_DATABASE_URL` stored as a Wrangler secret for each Worker environment:
  - production/default Worker: `musubi-m1`
  - staging Worker: `musubi-m1-staging`
- `CONTROL_PLANE_BASIC_AUTH` stored as a Wrangler secret for staging if the hosted control-plane UI is enabled. The value is a `username:password` string used for HTTP Basic Auth.

Local tooling check:

```bash
TMPDIR="$PWD/.cache/tmp" BUN_INSTALL_CACHE_DIR="$PWD/.cache/bun" bunx wrangler --version
TMPDIR="$PWD/.cache/tmp" BUN_INSTALL_CACHE_DIR="$PWD/.cache/bun" bunx wrangler whoami
```

If `whoami` says you are not authenticated:

```bash
TMPDIR="$PWD/.cache/tmp" BUN_INSTALL_CACHE_DIR="$PWD/.cache/bun" bunx wrangler login
```

If `wrangler deploy` fails with Cloudflare API code `10063` and says a `workers.dev` subdomain is required, open the Cloudflare dashboard for the target account and visit Workers and Pages once. Cloudflare initializes the account's `workers.dev` subdomain from that dashboard flow; after that, rerun `wrangler deploy`.

## Worker

Worker source:

```text
server/workers/src/index.ts
server/workers/src/durable_objects/DeviceSession.ts
server/workers/wrangler.toml
```

The Worker currently uses a Cloudflare Placement Hint to run closer to the Singapore Neon database:

```toml
[placement]
region = "azure:southeastasia"
```

If the database region changes, update the placement hint to match the new database region. Cloudflare Placement runs the Worker in the Cloudflare data center with the lowest latency to the specified cloud region, not literally inside that cloud provider region.

The Worker routes:

- `GET /v1/health`
- `GET /v1/devices/{device_id}/connect`
- `POST /v1/devices/register`
- `GET /v1/devices/{device_id}`
- `POST /v1/apps`
- `GET /v1/apps/{app_id}`
- `POST /v1/grants`
- `POST /v1/grants/{grant_id}/revoke`
- `POST /v1/permissions/check`
- `POST /v1/messages`
- `GET /v1/messages/{message_id}`
- `GET /v1/audit-events`

`/v1/devices/{device_id}/connect` maps `device_id` to a Durable Object name so hosted relay semantics preserve the M1 `device_id -> DeviceSession` model.

Hosted API runtime state is stored in Durable Object storage so the Worker can route by `device_id -> DeviceSession`. When `NEON_DATABASE_URL` is configured, hosted message status rows and audit events are also written to Neon through `@neondatabase/serverless`.

## Database

Apply migrations in order:

```text
migrations/001_init.sql
migrations/002_keys.sql
migrations/003_messages_audit.sql
migrations/004_device_plugin_capabilities.sql
migrations/005_control_plane_m2.sql
migrations/006_third_party_app_platform_m4.sql
```

The hosted Worker uses `NEON_DATABASE_URL` for message and audit persistence. Apply the schema for the target Neon database before sending hosted messages.

Apply migrations:

```bash
NEON_DATABASE_URL="<postgres-url>" bun run db:migrate:neon
```

## Deploy

Production deploys the default Worker `musubi-m1`:

```bash
cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put NEON_DATABASE_URL
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy --env=""
```

Staging deploys the Wrangler environment Worker `musubi-m1-staging`:

```bash
cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put NEON_DATABASE_URL --env staging
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put CONTROL_PLANE_BASIC_AUTH --env staging
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy --env staging
```

Health check:

```bash
curl https://<worker-host>/v1/health
```

Expected:

```json
{
  "ok": true,
  "service": "musubi-worker",
  "env": "production",
  "neon_configured": true
}
```

Staging should report `"env": "staging"`.

The hosted control-plane UI is enabled only for staging by default:

```bash
curl -i https://<staging-worker-host>/control-plane
curl -u '<username>:<password>' https://<staging-worker-host>/control-plane
```

The anonymous request should return `401`. The authenticated request should return the Musubi Control Plane HTML shell.

Build check without deploying:

```bash
cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy --env="" --dry-run --outdir ../../.cache/worker-build
```

Equivalent repo-root script:

```bash
bun run verify:slice11:build
```

Local hosted-runtime proof:

```bash
bun run verify:slice11:local
```

This starts `wrangler dev`, registers a Go CLI device through the Worker, creates a Hermes app/grant, connects the device over the Worker Durable Object WebSocket, sends an encrypted `hermes.task.create`, runs the Hermes plugin through the local CLI, and verifies the decrypted app result plus audit lifecycle.

After a deployed hosted flow, verify Neon persistence with:

```bash
MUSUBI_HOSTED_URL="https://<worker-host>" \
NEON_DATABASE_URL="<postgres-url>" \
bun run verify:slice11:deployed
```

The deployed verifier registers a local Go CLI device against the deployed Worker, creates a Hermes app/grant, sends an encrypted `hermes.task.create`, verifies the decrypted result, and queries Neon for the message and audit rows.

Staging should run the full deployed verifier suite against the staging Worker and database:

```bash
MUSUBI_HOSTED_URL="https://<staging-worker-host>" \
NEON_DATABASE_URL="<staging-postgres-url>" \
bun run verify:slice11:deployed

MUSUBI_HOSTED_URL="https://<staging-worker-host>" \
NEON_DATABASE_URL="<staging-postgres-url>" \
bun run verify:slice12:deployed

MUSUBI_HOSTED_URL="https://<staging-worker-host>" \
NEON_DATABASE_URL="<staging-postgres-url>" \
bun run verify:slice13:deployed

MUSUBI_HOSTED_URL="https://<staging-worker-host>" \
NEON_DATABASE_URL="<staging-postgres-url>" \
bun run verify:m4-hosted-deployed

MUSUBI_HOSTED_URL="https://<staging-worker-host>" \
CONTROL_PLANE_BASIC_AUTH="<username>:<password>" \
bun run verify:control-plane:deployed
```

Production should use only the smoke verifier because the full deployed suite creates apps, grants, consent requests, reports, suspensions, messages, and audit rows:

```bash
MUSUBI_HOSTED_URL="https://<production-worker-host>" bun run verify:production-smoke
```

## GitHub Actions

Pull requests and branch pushes run local verification plus a Worker dry-run build. Pushes to `main` then deploy staging, run the full deployed staging verifier suite, wait for GitHub Environment approval named `production`, deploy the default production Worker, and run the production smoke verifier.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STAGING_NEON_DATABASE_URL`
- `STAGING_MUSUBI_HOSTED_URL`
- `STAGING_CONTROL_PLANE_BASIC_AUTH`
- `PROD_NEON_DATABASE_URL`
- `PROD_MUSUBI_HOSTED_URL`

CI does not run `wrangler secret put`; configure each Worker's `NEON_DATABASE_URL` secret in Cloudflare before deployment. Configure the staging Worker's `CONTROL_PLANE_BASIC_AUTH` secret before enabling the protected control-plane verifier.

Manual Neon checks:

```sql
select id, status, channel, length(ciphertext) as ciphertext_chars
from messages
order by updated_at desc
limit 5;

select event_type, message_id, channel, metadata
from audit_events
order by created_at desc
limit 20;
```

The `ciphertext` column should contain encrypted payload text only; `audit_events.metadata` should contain routing/status metadata, not decrypted Hermes instructions or results.

## Hosted M1 Completion Gate

The hosted M1 exit criterion is not satisfied by scaffold alone. Completion requires proof that:

1. The Worker is deployed to a real Cloudflare account.
2. `NEON_DATABASE_URL` is configured.
3. The device WebSocket connects to the hosted Worker.
4. The same encrypted echo or Hermes flow completes through hosted routing.
5. Hosted status and audit writes land in Neon without plaintext payloads.

Until those checks pass against real hosted infrastructure, the hosted deployment remains scaffolded but not complete.
