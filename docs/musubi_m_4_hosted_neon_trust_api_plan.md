# Musubi M4 Hosted Neon Trust API Plan

## Summary

Move hosted M4 trust behavior from Durable Object/local cache semantics toward Neon-backed source-of-truth behavior. The hosted Worker should use Neon for long-lived M4 trust objects, while Durable Objects remain responsible for device WebSocket sessions, online status, active delivery, queued message drain, and short-lived relay coordination.

Current state:

- The local relay proves M4 third-party trust flows and can persist local state through `MUSUBI_RELAY_STATE_PATH`.
- The hosted Worker supports M1-style device, app, grant, message, capability, and audit routes, with partial Neon writes.
- `migrations/006_third_party_app_platform_m4.sql` already defines the hosted M4 trust schema.
- Hosted Worker trust decisions still rely too much on Durable Object storage and do not expose the full local M4 API surface.

## Key Changes

### Hosted Neon Data Access

Add hosted Worker data-access helpers for Neon-backed reads and writes of:

- `developer_accounts`
- `publisher_profiles`
- `apps`
- `app_keys`
- `app_api_keys`
- `app_permission_declarations`
- `consent_requests`
- `app_device_channel_grants`
- `app_abuse_reports`
- `audit_events`

`NEON_DATABASE_URL` is required for hosted M4 trust APIs. If it is missing, M4 trust endpoints should return `503` with `error: "neon required for hosted trust state"`. `GET /v1/health` should continue to expose `neon_configured`.

### Hosted API Parity

Bring hosted Worker routes to local M4 API parity:

- `POST /v1/developers`
- `GET /v1/developers`
- `PATCH /v1/developers/{developer_id}`
- `POST /v1/publishers`
- `GET /v1/publishers`
- `PATCH /v1/publishers/{publisher_id}`
- `POST /v1/developer/apps`
- `POST /v1/developer/apps/{app_id}/api-keys`
- `POST /v1/developer/apps/{app_id}/permission-declarations`
- `POST /v1/consent-requests`
- `GET /v1/consent-requests/{consent_id}`
- `POST /v1/consent-requests/{consent_id}/approve`
- `POST /v1/consent-requests/{consent_id}/deny`
- `GET /v1/authorized-apps`
- `POST /v1/apps/{app_id}/report`
- `POST /v1/apps/{app_id}/suspend`
- `POST /v1/apps/{app_id}/revoke`
- `POST /v1/grants/{grant_id}/revoke`
- `POST /v1/messages`

Hosted responses should match the local relay closely enough that the existing control plane and app SDK callers work unchanged.

### Authorization Behavior

Hosted message authorization should read durable trust state from Neon:

- app exists, belongs to workspace, and is `active`
- app trust status is not blocked
- app publisher is not suspended
- third-party app declared the requested channel
- device exists, belongs to workspace, and is not revoked
- active app key exists
- active device key exists
- active grant exists for `workspace_id + app_id + device_id`
- grant includes the requested channel

Revoke, report, app suspension, and publisher suspension must affect future hosted authorization decisions immediately.

### Durable Object Boundary

Keep Durable Objects responsible for:

- `device_id -> DeviceSession` WebSocket routing
- current device online/offline connection state
- active WebSocket delivery
- queued message drain
- internal device/control coordination

Do not use Durable Object storage as the source of truth for developer accounts, publisher profiles, third-party app identity, API keys, permission declarations, consent requests, grants, app reports, app status, trust state, review state, or audit.

### Privacy And Audit

Preserve the existing payload privacy boundary:

- Worker and Neon may store ciphertext and routing/status metadata.
- Audit events must not include plaintext task instructions, decrypted results, app private keys, API key secrets, or device private keys.
- App API key secrets are returned only at creation; Neon stores only prefix, hash, status, timestamps, and revocation metadata.

Consent approval should atomically create the grant, attach `created_from_consent_request_id`, update consent status/grant id/completed timestamp, and write audit events.

## Test Plan

Add `verify:m4-hosted-local` using `wrangler dev`:

1. Apply migrations through `db:migrate:neon` in a disposable Neon database.
2. Start hosted Worker locally with `NEON_DATABASE_URL`.
3. Register a device and report plugin capabilities.
4. Create developer, publisher, third-party app, app API key, and permission declaration.
5. Create consent request, fetch consent detail, approve grant, and verify grant row in Neon.
6. Send an encrypted Codex or Hermes message through the app SDK.
7. Revoke the grant and verify future sends fail.
8. Create a second consent/grant, report the app, suspend the app, and verify future sends fail.
9. Query Neon for developer, publisher, app, app key, API key hash, permission declaration, consent, grant, report, message, and audit rows.
10. Restart `wrangler dev` and verify trust objects remain readable and authorization decisions still hold.

Add `verify:m4-hosted-deployed`, gated by:

- `MUSUBI_HOSTED_URL`
- `NEON_DATABASE_URL`

The deployed verifier should run the same M4 hosted trust flow against a real Cloudflare Worker and prove Neon persistence without plaintext payload leakage.

Run the existing regression set:

```bash
bun run verify:slice11:build
bun run verify:m4-platform-trust
bun run verify:m2-control-plane
bun run verify:m3-app-sdk
GOCACHE="$PWD/.cache/go-build" go test ./...
git diff --check
```

## Assumptions

- This milestone adds hosted Worker M4 parity; it does not remove the local relay JSON durability proof.
- No new dependencies are required beyond the existing `@neondatabase/serverless`.
- Authentication remains the current local/dev placeholder model unless a separate auth milestone changes user identity.
- Existing route names, control-plane copy, SDK contracts, and encrypted payload behavior remain backward compatible.
- Hosted Worker may keep Durable Object storage for non-trust runtime state during this milestone.
