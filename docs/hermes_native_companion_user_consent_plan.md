# Hermes Native Companion User Consent Refactor Plan

## 0. Document Status

Draft plan.

This document captures the refactoring direction for Hermes Companion as a separate native client app. It replaces the current local-CLI-created app-secret setup path with a user-consent model based on Musubi UI, loopback PKCE, short-lived app sessions, and user-owned device grants.

This is not yet a `/goal` contract. Before execution, the success criteria should be confirmed and compiled into `GOAL.md`.

## 1. Summary

Hermes Companion should not require users to copy long-lived app credentials from the Musubi CLI or run a companion app from this repository.

Musubi should support two user roles:

- Admin users manage app identities, trust, review, allowed scopes, and workspace-level policy.
- Individual users register their own devices, approve app access to those devices, and revoke grants.

Hermes Companion is a separate native app. It should authenticate through Musubi UI, request access to the user's device, and receive a short-lived scoped app session token. The native app should encrypt task payloads locally and send ciphertext through Musubi, without embedding a long-lived `MUSUBI_API_KEY`.

## 2. Problem Statement

The current local Hermes setup direction is too CLI- and secret-oriented for a native client app:

- `device register --with-hermes` creates a user-owned Hermes app and app API key locally.
- CLI output exposes `MUSUBI_API_KEY` and `MUSUBI_APP_PRIVATE_KEY`.
- The setup page still implies the companion app reads generated local SDK config.
- This model is acceptable for a local backend or developer demo, but not for a distributed native app.

A native app is a public client. Anything embedded in the binary or stored long-term in app storage should be treated as recoverable by the user or an attacker with local access.

Therefore:

- Hermes Companion must not ship with a static app API key.
- Hermes Companion should not require the user to paste long-lived app secrets.
- Musubi should let the user approve access through a first-class UI.
- Musubi should issue scoped, short-lived credentials for native-app runtime calls.

## 3. Target User Model

## 3.0 Workspace

A workspace is the top-level Musubi resource boundary. It groups users, apps, devices, grants, policy, app trust settings, and audit logs.

In this plan:

- Admin users manage apps and policy inside a workspace.
- Individual users register devices and approve app access inside a workspace.
- App session tokens are scoped to a workspace.
- Apps and session tokens from one workspace must not access devices or grants in another workspace.

For local development, `ws_local` is the default demo workspace.

## 3.1 Admin User

Admin users manage the app side of the ecosystem.

For the first implementation, keep this simple:

- There is one admin user.
- The admin signs in to the admin UI with username and password.
- The admin can create and manage apps.
- No multi-admin RBAC, SSO, SCIM, delegated administration, or enterprise role model is required.

Responsibilities:

- Register or approve Hermes Companion as an app identity.
- Configure app trust status, publisher metadata, and review state.
- Define allowed requested scopes such as `hermes.task.create`, `hermes.task.cancel`, and `hermes.task.status`.
- Manage workspace policy and app-level restrictions.
- Suspend, block, or revoke app identities.

Admin users do not manage each individual user's local device grants by default.

## 3.2 Individual User

Individual users manage their own devices and access grants.

Responsibilities:

- Register their Mac or local machine as a Musubi device.
- See which apps have access to that device.
- Approve Hermes Companion access to specific device channels.
- Revoke Hermes Companion access at any time.
- Start or stop the local Musubi device service.

Individual users should not need to understand app API keys, X25519 key ids, grant records, or policy file syntax.

## 4. Target Product Flow

## 4.1 Device Registration

The user registers their device with Musubi:

```bash
go run ./cmd/musubi device register \
  --server <musubi-server> \
  --home ~/.musubi/hermes-device \
  --workspace <workspace-id> \
  --name "My Mac" \
  --start
```

This command should:

- Create a device keypair locally.
- Register only the device public key and auth public key with Musubi.
- Write device config locally.
- Report installed plugin capabilities.
- Connect the long-running local device service.

It should not create a Hermes Companion app API key.

## 4.2 Native Hermes Companion Authorization

The native Hermes Companion app should:

1. Start a localhost loopback callback server on `127.0.0.1:<ephemeral_port>`.
2. Generate a PKCE verifier and challenge.
3. Open the Musubi authorization URL in the user's browser.
4. Send a public app/client id, requested scopes, code challenge, and loopback redirect URI.
5. Ask the user to sign in through Musubi UI.
6. Let the user select a registered device.
7. Show the requested channels:
   - `hermes.task.create`
   - `hermes.task.cancel`
   - `hermes.task.status`
8. Create or update an app-device grant after user approval.
9. Redirect the browser to the localhost callback with an authorization code.
10. Exchange the authorization code plus PKCE verifier for a short-lived app session token.
11. Let the native app fetch granted devices and device public keys.
12. Let the native app encrypt task payloads locally and send ciphertext.

The browser/control-plane UI should be the user's source of truth for consent and revocation.

Device authorization is deferred. The first implementation should support only loopback PKCE.

## 4.3 Runtime Messaging

At runtime:

```text
Hermes Native App
  uses short-lived app session token
  fetches granted device public key
  encrypts task payload locally
  sends ciphertext to Musubi

Musubi Server
  validates token
  checks app/device/channel grant
  routes ciphertext only

Musubi Device Service
  decrypts payload locally
  enforces local policy
  dispatches Hermes plugin
  encrypts result back to app public key

Hermes Native App
  decrypts result locally
```

## 5. Refactoring Goals

## 5.0 Remove Hard-Coded Control-Plane Credentials

Goal:

- Control-plane frontend code must not contain Basic Auth credentials, admin passwords, app API keys, or other long-lived secrets.

Refactor:

- Remove any hard-coded Basic Auth from browser-side control-plane requests.
- Add a username/password admin login flow for the single admin user.
- Store admin password verification material server-side, either as a password hash or a clearly marked local-dev-only password environment variable.
- Issue a server-side admin session after login.
- Store the admin session in an HttpOnly, SameSite cookie.
- Require the admin session for admin/control-plane management APIs.
- Add logout and current-admin endpoints.
- Keep admin sessions separate from app runtime credentials and native app session tokens.
- Ensure app API keys and app session tokens cannot call admin management APIs.

Draft endpoints:

```http
POST /v1/admin/login
POST /v1/admin/logout
GET /v1/admin/me
```

Non-negotiable constraints:

- No admin credential in static HTML, `app.js`, localStorage, or copied frontend config.
- No Basic Auth header constructed by the browser from hard-coded values.
- No app runtime token accepted for admin app/device/grant management.

## 5.1 Remove Long-Lived App API Key From Native Companion Setup

Goal:

- Hermes native app should never require `MUSUBI_API_KEY`.

Refactor:

- Keep app API keys for backend/server-side app integrations.
- Introduce a native-app/session credential path for public clients.
- Mark long-lived app API keys as backend-only in docs and UI copy.

## 5.2 Split Admin App Management From User Device Consent

Goal:

- Admin users manage app identity and allowed scopes.
- Individual users manage device grants for their own devices.

Refactor:

- Control plane navigation should distinguish:
  - Admin app management.
  - My devices.
  - Authorized apps for my devices.
  - Consent approval pages.
- Existing third-party/developer app flows remain available but should not be the default Hermes setup path.

## 5.3 Replace `--with-hermes` Local App Provisioning

Goal:

- Device registration should register the device only.
- Hermes app authorization should happen through user consent UI.

Refactor:

- Deprecate or hide `device register --with-hermes` from user-facing setup.
- Keep it temporarily only as a development shortcut if needed.
- Update `#setup/hermes` to show:
  - register/start device command
  - open Hermes Companion
  - approve access in Musubi UI

## 5.4 Add Native App Authorization Protocol

Goal:

- Native Hermes Companion can request access without a client secret.

Refactor:

- Add public app/client registration metadata.
- Add loopback PKCE authorization start endpoint.
- Add authorization confirmation UI.
- Add token exchange endpoint.
- Issue short-lived app session tokens.
- Bind tokens to app id, user id, workspace id, and expiry.
- Resolve allowed devices/channels from current active grants at request time.

## 5.5 Add App Session Token Authorization To App APIs

Goal:

- Existing app runtime APIs should accept short-lived app session tokens where appropriate.
- App session tokens are bound to `user_id + app_id + workspace_id + expiry`.
- Runtime access is not fixed to a single device or grant snapshot. Instead, every request checks the user's current active grants for that app, device, and channel.

Refactor:

- Extend app authentication to support:
  - existing backend app API keys
  - short-lived native app session tokens
- Apply both to:
  - list granted devices
  - fetch device public key
  - send encrypted message
  - fetch message status/events
  - cancel message
- Session tokens should only expose devices currently granted to that user and app in the token workspace.
- Revoking a grant should immediately block further runtime access through existing session tokens.
- Newly approved grants can become available to a live session without issuing a new token, because runtime APIs check current grants.
- Preserve control-plane restrictions: app runtime credentials cannot manage apps, devices, or grants directly.

Token lifetime defaults:

- Access token lifetime: 1 hour.
- Refresh session lifetime: 30 days.
- Idle timeout: 14 days.
- Refresh token rotation is required.
- Reauthentication is required after refresh expiry, explicit sign-out, grant revocation where the app has no remaining usable grants, or suspicious token reuse.

## 5.6 Preserve Server-Blind Payload Model

Goal:

- Musubi server must not receive plaintext Hermes task content.

Refactor:

- Native app encrypts payload locally before POSTing messages.
- Server only sees metadata, grants, status, and ciphertext.
- Consent UI must not ask for task content.

## 5.7 Keep Private Key Handling Native-App Appropriate

Goal:

- The native app can hold per-install cryptographic key material, but not global long-lived server credentials.

Refactor:

- Native app uses a durable per-install encryption keypair.
- Generate the keypair once during first successful Musubi connection for that local install.
- Store private key in OS secure storage where possible.
- Register the public key during loopback PKCE authorization.
- Reuse the same local private key across app sessions for that install.
- Use no key migration for the first implementation: if the private key is missing after reinstall, restore, or migration, Hermes Companion must reconnect through loopback PKCE and register a new public key.
- Preserve revocation and rotation paths for future hardening, but do not build export/import or cloud key backup in the first refactor.

## 6. Proposed API Shape

Names are draft.

## 6.1 Recommended Flow: Loopback PKCE

Hermes Companion should use authorization code with PKCE and a localhost loopback redirect. This avoids custom URL schemes while still giving a smooth native-app login flow.

Allowed loopback redirect shape for the first implementation:

- Scheme: `http`
- Host: `127.0.0.1` or `[::1]`
- Port range: `49152-65535`
- Path: `/callback`

Do not allow `localhost`, external hosts, wildcard domains, LAN IPs, `0.0.0.0`, `file://`, or arbitrary callback paths.

```text
Hermes Companion
  starts http://127.0.0.1:<ephemeral_port>/callback
  generates code_verifier + code_challenge
  opens Musubi authorize URL in browser

Musubi UI
  authenticates user
  shows requested device access
  creates grant after approval
  redirects to localhost callback with code

Hermes Companion
  receives code on localhost
  exchanges code + verifier for short-lived token
```

## 6.2 Start Authorization

```http
POST /v1/oauth/native/authorize
Content-Type: application/json

{
  "client_id": "app_hermes_companion",
  "workspace_id": "ws_local",
  "redirect_uri": "http://127.0.0.1:49152/callback",
  "code_challenge": "<pkce_challenge>",
  "code_challenge_method": "S256",
  "requested_capabilities": [
    {
      "plugin": "hermes",
      "channels": [
        "hermes.task.create",
        "hermes.task.cancel",
        "hermes.task.status"
      ]
    }
  ],
  "app_public_key": "<base64_x25519_public_key>"
}
```

Response:

```json
{
  "authorization_id": "authz_123",
  "authorization_url": "https://musubi.example/authorize/authz_123",
  "expires_in": 600
}
```

## 6.3 User Approval

User opens the Musubi UI and approves:

```text
Hermes Companion wants access to:
- Device: My Mac
- Channels: hermes.task.create, hermes.task.cancel, hermes.task.status

Payloads are encrypted end to end.
Musubi cannot read task contents.
Local policy on the device still decides what may run.
```

Approval creates or updates a grant, then redirects to the registered loopback redirect URI:

```text
http://127.0.0.1:49152/callback?code=code_123&state=...
```

## 6.4 Token Exchange

```http
POST /v1/oauth/native/token
Content-Type: application/json

{
  "code": "code_123",
  "redirect_uri": "http://127.0.0.1:49152/callback",
  "code_verifier": "<pkce_verifier>"
}
```

Response:

```json
{
  "access_token": "musubi_session_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "app_id": "app_hermes_companion",
  "workspace_id": "ws_local",
  "granted_device_ids": ["dev_123"]
}
```

## 6.5 Deferred: Device Authorization Fallback

Device authorization is out of scope for the first refactor. It can be added later as a fallback:

```text
Hermes Companion
  shows verification_uri + user_code
  polls token endpoint

User
  opens Musubi UI
  enters or confirms code
  approves device access
```

When implemented later, it should share the same authorization request, consent screen, grant creation, token issuance, and runtime token model. Do not build this in the first implementation slice.

## 6.6 Runtime App APIs

The native app calls existing runtime APIs with the short-lived access token:

```http
GET /v1/app/me
GET /v1/app/devices
GET /v1/app/devices/:device_id/public-key
POST /v1/messages
GET /v1/messages/:message_id
GET /v1/messages/:message_id/events
POST /v1/messages/:message_id/cancel
```

## 7. UI Refactoring Goals

## 7.1 Hermes Setup Page

Replace secret-oriented setup with user-oriented setup:

```text
1. Register this Mac
2. Open Hermes Companion
3. Sign in and approve access in Musubi
```

The page should show status:

- Device registered
- Device online
- Hermes plugin capability reported
- Hermes Companion authorized
- Grant active

It should not show:

- `MUSUBI_API_KEY`
- `MUSUBI_APP_PRIVATE_KEY`
- app key ids
- local SDK config paths for user copy/paste

## 7.2 Individual User Pages

Add or clarify:

- My Devices
- Authorized Apps
- Device grants
- Revoke app access

## 7.3 Admin Pages

Add or clarify:

- App registry
- Create app
- Edit app name, public client metadata, allowed scopes, and status
- App trust/review state
- Allowed requested scopes
- Publisher/developer metadata
- Suspensions and blocks

For the first implementation, admin pre-approval for Hermes Companion is just normal app creation by the single admin:

```text
Admin logs in
  -> creates Hermes Companion app
  -> marks it first-party/trusted
  -> configures allowed requested Hermes channels
  -> users can approve this app for their own devices
```

The individual user still decides whether Hermes Companion can access their device.

## 8. Data Model Changes

Draft entities:

- `native_authorization_requests`
  - id
  - client_id/app_id
  - workspace_id
  - user_id
  - code_challenge
  - requested_capabilities
  - app_public_key
  - selected_device_id
  - status
  - expires_at
  - approved_at

- `app_session_tokens`
  - id
  - token_hash
  - app_id
  - user_id
  - workspace_id
  - expires_at
  - revoked_at
  - last_used_at

- Optional `app_session_keys`
  - id
  - app_session_token_id
  - public_key
  - status
  - created_at

Existing grants remain the durable authorization record.

## 9. Security Requirements

- Native app must not ship a long-lived app API key.
- Browser UI must never receive app private keys or app API keys.
- Short-lived tokens must be hashed at rest.
- Authorization requests must expire.
- PKCE verifier must be required for token exchange.
- Token scope must be restricted to one user, app, and workspace.
- Runtime access must be restricted by current active grants for the token user, app, workspace, device, and channel.
- Revoking a grant should make existing session tokens unusable for that grant's device/channel.
- App runtime credentials must not call control-plane management APIs.
- Server must not log plaintext payloads, API keys, token secrets, or private keys.

## 10. Non-goals

- Do not replace the local Musubi device service.
- Do not make Musubi a remote desktop, SSH, VPN, or generic remote-control system.
- Do not let the server encrypt plaintext task payloads.
- Do not require users to paste secrets into Hermes Companion.
- Do not require admins to approve every individual device grant by default.
- Do not solve full enterprise RBAC in this refactor.
- Do not implement device authorization in the first refactor.
- Do not implement native app key export/import or key migration in the first refactor.
- Do not implement multiple admin users, admin role management, SSO, SCIM, or enterprise identity management in the first refactor.
- Do not ship or embed admin Basic Auth credentials in frontend assets.

## 11. Implementation Slices

## Slice 1: Product/UI Cleanup

- Update Hermes setup page to remove app secret copy.
- Make device registration the only CLI setup step.
- Add clear user/admin separation in navigation and copy.
- Mark existing `--with-hermes` as development-only or remove it from visible setup.
- Remove hard-coded Basic Auth from the control-plane frontend.
- Add single-admin login/logout/session handling.

## Slice 2: App Identity And Consent Model

- Add public/native client app metadata.
- Add loopback PKCE authorization request creation.
- Add Musubi UI approval screen.
- Create grant on approval.

## Slice 3: Token Exchange And Runtime Auth

- Add authorization code plus PKCE token exchange.
- Add short-lived app session token storage and hashing.
- Extend app runtime auth to accept session tokens.
- Ensure runtime APIs enforce token device/channel scope.

## Slice 4: SDK Native Client Mode

- Add SDK support for session tokens.
- Let SDK infer `app_id`, workspace, and key metadata.
- Provide native-client examples that use:
  - public client id
  - PKCE
  - localhost loopback callback
  - short-lived session token
  - local encryption key

## Slice 5: Revocation And Expiry

- Expire authorization requests.
- Expire session tokens.
- Revoke session tokens when grants are revoked.
- Add UI affordances for individual users to revoke Hermes Companion access.

## Slice 6: Verification And Security Hardening

- Add tests for PKCE failure paths.
- Add tests for redirect URI validation and localhost callback handling.
- Add tests that native app cannot use app runtime token for management APIs.
- Add tests that revoked grants block session tokens.
- Add tests that control-plane frontend assets do not contain admin credentials.
- Add tests that admin APIs require an admin session cookie.
- Add log hygiene checks.
- Extend control-plane verifier for the new user consent flow.

## 12. Acceptance Criteria Draft

These should be reviewed before compiling into `GOAL.md`.

- A user can register a device with one command and see it online in Musubi UI.
- A native Hermes Companion flow can create a loopback PKCE authorization request without a client secret.
- Musubi redirects approved authorization to a localhost callback with an authorization code.
- Musubi UI lets an individual user approve Hermes Companion access to one of their own devices.
- Approval creates an active grant for Hermes channels.
- Hermes Companion receives a short-lived session token, not a long-lived app API key.
- Hermes Companion can fetch device public key and send encrypted Hermes task messages with that token.
- While the session is live, Hermes Companion can access the user's currently approved Hermes devices in that workspace.
- Revoking a grant immediately prevents the live session from using that device/channel.
- Server logs and API responses do not expose plaintext task payloads, app private keys, app API keys, or session token secrets.
- Revoking the grant prevents the native app from sending new Hermes tasks.
- Admin app management remains separate from individual user device grant management.
- Control-plane frontend assets do not contain Basic Auth credentials or admin secrets.
- Admin management APIs require a server-issued admin session and reject app runtime credentials.

## 13. Open Decisions

No open product decisions remain in this draft. The next step is to tighten acceptance criteria and compile this into `GOAL.md` when ready.
