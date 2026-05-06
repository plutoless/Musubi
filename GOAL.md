<goal>
Fulfill `docs/musubi_m_1_architecture_implementation_plan.md`.

Musubi Milestone 1 proves that a first-party Hermes app can securely invoke an approved local capability on a user-owned machine through Musubi:

```text
Hermes app
  -> encrypted Musubi message
  -> Musubi relay
  -> Go CLI on user's machine
  -> local policy check
  -> Hermes plugin/runtime
  -> encrypted progress/result events back to app
```
</goal>

<context>
Read these files first:

- `AGENTS.md`
- `README.md`
- `docs/musubi_m_1_architecture_implementation_plan.md`
- `docs/architecture_m1.md`
- `docs/hosted_m1_deployment.md`
- `docs/specs/envelope.md`
- `docs/specs/encryption.md`
- `docs/specs/plugin_protocol.md`
- `docs/specs/local_policy.md`
- `docs/specs/api_contracts.md`

The implementation is intentionally split between:

- Local development relay: `apps/relay-server/src/main.ts`
- Go CLI: `cmd/musubi/main.go`
- Protocol schemas/types: `packages/protocol/`
- Plugins: `plugins/echo/`, `plugins/hermes/`
- Hosted Worker target: `server/workers/`
- Postgres migrations: `migrations/`
- Verifiers: `tools/verify*.ts`
</context>

<constraints>
- Preserve the plan's trust boundaries.
- The server must route and persist ciphertext only; it must not decrypt Hermes instructions, plugin parameters, result content, or artifact content.
- Cloud policy decides who may ask; local policy decides what may run.
- Keep Hermes-specific execution inside the Hermes plugin, not the CLI or relay.
- Do not turn Musubi into remote desktop, VPN, arbitrary shell execution, marketplace, remote plugin installation, or remote machine management.
- Hosted M1 must use Cloudflare Workers, Durable Objects, and Neon Postgres.
- Local success is not enough for completion; the hosted Cloudflare + Neon flow must be proven.
</constraints>

<done_when>
M1 is complete only when all of these are true:

- Architecture/spec documents and JSON schemas exist for envelope, encryption, plugin protocol, local policy, and API contracts.
- Example message envelopes, plugin manifests, and local policies validate against schema.
- The Go CLI can register a device, store local device keys/config, report status, and connect over signed WebSocket.
- The server stores device/app identities, public keys, grants, message status, plugin capabilities, and audit events.
- A first-party Hermes app can be created with an app public key and local dev private key.
- The app can be granted access to a specific device and Hermes channels.
- The app can encrypt a Hermes task to the device public key.
- The relay routes opaque encrypted envelopes without requiring plaintext.
- The CLI decrypts device-bound messages locally and rejects replayed message IDs or payload nonces.
- Local YAML policy is deny-by-default and enforces app/plugin/channel, plugin permissions, workspace hints, task duration, and terminal confirmation when required.
- The CLI dispatches to plugins over JSON-RPC stdio.
- The echo plugin proves protocol correctness.
- The Hermes plugin handles create/cancel/status channels and can run a configured local Hermes runtime command.
- Progress and final result events are encrypted back to the app on app-bound event channels.
- Message status transitions and audit events are persisted without decrypted payload text.
- TTL expiration, cancellation, local policy denial, revoked grants, denied channels, offline queueing, and reconnect behavior are verified.
- The Cloudflare Worker/Durable Object hosted path builds and runs locally through Wrangler.
- Neon migrations apply to a real Neon database.
- A deployed Cloudflare Worker with `NEON_DATABASE_URL` configured passes `bun run verify:slice11:deployed`.
</done_when>

<verification_loop>
Run local checks before the hosted gate:

```bash
bun run verify:m1-contracts
bun run verify:slice1
bun run verify:slice2
bun run verify:slice3
bun run verify:slice4
bun run verify:slice5
bun run verify:slice6
bun run verify:slice7
bun run verify:slice8
bun run verify:slice9
bun run verify:slice10
bun run verify:slice10:hermes
bun run verify:slice11
bun run verify:slice11:build
bun run verify:slice11:local
bun run verify:m1-readiness
GOCACHE="$PWD/.cache/go-build" go test ./...
```

Then prove the deployed gate:

```bash
NEON_DATABASE_URL="<postgres-url>" bun run db:migrate:neon

cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put NEON_DATABASE_URL
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy

cd ../..
MUSUBI_HOSTED_URL="https://<worker-host>" \
NEON_DATABASE_URL="<postgres-url>" \
bun run verify:slice11:deployed
```
</verification_loop>

<current_blocker>
The local M1 implementation and hosted local Worker proof may pass, but the goal must not be marked complete until Cloudflare authentication, Neon configuration, deployment, and `verify:slice11:deployed` all succeed against real hosted infrastructure.
</current_blocker>

<output_contract>
Final response should include:

- A concise implementation summary.
- The exact verification commands run and their results.
- The deployed Worker URL and Neon proof status.
- Any remaining gaps or operational follow-up.
</output_contract>
