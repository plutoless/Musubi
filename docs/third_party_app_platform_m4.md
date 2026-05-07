# M4 Third-party App Platform

M4 adds a local proof of the third-party app path without changing Musubi's trust boundary: apps can request approved local capabilities, but payloads remain encrypted end-to-end and device policy still decides execution.

## Flow

1. Create a developer profile with `POST /v1/developers`.
2. Create a publisher profile with `POST /v1/publishers`.
3. Register a third-party app with `POST /v1/developer/apps`.
4. Declare plugin channels with `POST /v1/developer/apps/{app_id}/permission-declarations`.
5. Create a consent request with `POST /v1/consent-requests`.
6. Send the user to `/control-plane#consent/{consent_id}`.
7. The user selects a device and channels, then approves a scoped grant.
8. The app sends encrypted messages only through authorized device/channel grants.
9. The user can revoke grants or the app from Authorized Apps.

## Consent Copy Requirements

The consent surface must show the app name, app id, publisher name, publisher trust status, requested plugin channels, reason text, and the selected device. It must state that payloads are encrypted end-to-end, Musubi cannot read task contents, local policy remains authoritative, and grants can be revoked.

## Audit Events

M4 records `developer.created`, `publisher.created`, `app.created`, `app.permission_declared`, `consent.requested`, `consent.approved`, `grant.created`, `grant.revoked`, `app.reported`, `app.suspended`, and message lifecycle events.
