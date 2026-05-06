# Hosted M1 Deployment

This runbook describes the hosted target for Musubi M1: Cloudflare Workers, a Durable Object `DeviceSession`, and Neon Postgres.

## Prerequisites

- Cloudflare account with Workers and Durable Objects enabled.
- `wrangler` authenticated for the target account.
- Neon Postgres database.
- `NEON_DATABASE_URL` stored as a Wrangler secret.

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
```

The hosted Worker uses `NEON_DATABASE_URL` for message and audit persistence. Apply the schema before sending hosted messages.

Apply migrations:

```bash
NEON_DATABASE_URL="<postgres-url>" bun run db:migrate:neon
```

## Deploy

From the repo root:

```bash
cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put NEON_DATABASE_URL
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy
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
  "env": "m1",
  "neon_configured": true
}
```

Build check without deploying:

```bash
cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy --dry-run --outdir ../../.cache/worker-build
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
