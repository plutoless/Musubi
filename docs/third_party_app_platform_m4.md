# M4 Third-party App Platform

M4 adds a local proof of the third-party app path without changing Musubi's trust boundary: apps can request approved local capabilities, but payloads remain encrypted end-to-end and device policy still decides execution.

The local relay can persist M4 platform state by setting `MUSUBI_RELAY_STATE_PATH` to a JSON state file. Hosted schema support is captured in `migrations/006_third_party_app_platform_m4.sql`; `tools/apply_neon_migrations.ts` applies the M4 schema after the existing M1-M3 tables.

## Flow

1. Create a developer profile with `POST /v1/developers`.
2. Create or inspect developer profiles with `GET /v1/developers`; update status with `PATCH /v1/developers/{developer_id}`.
3. Create a publisher profile with `POST /v1/publishers`.
4. Inspect publishers with `GET /v1/publishers`; update verification status and metadata with `PATCH /v1/publishers/{publisher_id}`.
5. Register a third-party app with `POST /v1/developer/apps`.
6. Create additional app API keys with `POST /v1/developer/apps/{app_id}/api-keys`.
7. Declare plugin channels with `POST /v1/developer/apps/{app_id}/permission-declarations`.
8. Create a consent request with `POST /v1/consent-requests`.
9. Send the user to `/control-plane#consent/{consent_id}`.
10. The user inspects `GET /v1/consent-requests/{consent_id}`, including app, publisher, permission declarations, eligible devices, and reported capabilities.
11. The user selects a device and channels, then approves a scoped grant with `POST /v1/consent-requests/{consent_id}/approve`.
12. The user can deny the request with `POST /v1/consent-requests/{consent_id}/deny`.
13. The app sends encrypted messages only through authorized device/channel grants.
14. The user can revoke grants or the app from Authorized Apps.
15. Users can report suspicious apps with `POST /v1/apps/{app_id}/report`; operators can suspend apps with `POST /v1/apps/{app_id}/suspend`.
16. Restart the relay with the same `MUSUBI_RELAY_STATE_PATH`; developer, publisher, app, permission, consent, grant, API key hash, report, and audit state remains available.

## Consent Copy Requirements

The consent surface must show the app name, app id, publisher name, publisher trust status, requested plugin channels, reason text, and the selected device. It must state that payloads are encrypted end-to-end, Musubi cannot read task contents, local policy remains authoritative, and grants can be revoked.

## Audit Events

M4 records `developer.created`, `developer.updated`, `developer.suspended`, `publisher.created`, `publisher.verified`, `publisher.suspended`, `third_party_app.created`, `permission_declaration.created`, `consent_request.created`, `consent_request.approved`, `consent_request.denied`, `grant.created`, `grant.revoked`, `third_party_app.reported`, `third_party_app.suspended`, message auth/lifecycle events, and compatibility aliases used by existing control-plane views.

## Durability

For local verification, `MUSUBI_RELAY_STATE_PATH=.musubi/m4/relay-state.json bun run server` makes relay memory a cache of durable state instead of the source of truth. Online WebSocket connection state is not persisted; devices restart as offline and reconnect normally.

The M4 verifier restarts the relay after consent approval and asserts that developer, publisher, app, consent, grant, and audit state can be resumed.
