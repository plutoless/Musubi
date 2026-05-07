<goal>
Implement the Hermes native companion user-consent refactor described in `docs/hermes_native_companion_user_consent_plan.md`.

The finished system should let a user register and run a Musubi device service with a simple device-focused setup, then let a separate native Hermes Companion app authenticate through Musubi UI with loopback PKCE, ask the user to approve access to their own device, receive short-lived native app session credentials, fetch device public keys, and send encrypted Hermes task messages without using or exposing long-lived app API keys or app private keys.

The refactor must also remove hard-coded control-plane Basic Auth from frontend assets and introduce a simple single-admin username/password admin session model for app management.
</goal>

<context>
Read these files first:

- `AGENTS.md`
- `docs/musubi_prd_v_1.md`
- `docs/hermes_native_companion_user_consent_plan.md`
- `docs/control_plane_m2.md`
- `docs/app_sdk_m3.md`
- `docs/browser_session_keys_m3_5.md`
- `docs/security/app-keys-vs-api-keys.md`
- `docs/security/why-not-browser-private-key.md`
- `docs/guides/send-hermes-task.md`
- `cmd/musubi/main.go`
- `cmd/musubi/main_test.go`
- `apps/relay-server/src/main.ts`
- `server/workers/src/durable_objects/DeviceSession.ts`
- `apps/control-plane/index.html`
- `apps/control-plane/app.js`
- `apps/control-plane/styles.css`
- `sdk/app-js/src/client.ts`
- `sdk/app-js/src/types.ts`
- `apps/hermes-companion/src/main.ts`
- `tools/verify_m2_control_plane.ts`
- `tools/verify_m3_app_sdk.ts`
- `tools/verify_m3_5_browser_session.ts`
- `tools/verify_m4_hosted_local.ts`
- `package.json`

Use these discovery commands where exact call sites are unclear:

```bash
rg "Basic|Authorization|admin|with-hermes|MUSUBI_API_KEY|MUSUBI_APP_PRIVATE_KEY|app key|api key|grant|session token|PKCE|callback|localhost|127.0.0.1|::1" .
rg "/v1/apps|/v1/app|/v1/messages|device register|setup/hermes|Hermes Companion" .
find migrations -maxdepth 2 -type f | sort
```
</context>

<constraints>
- Preserve Musubi's core boundary: the server routes and stores metadata/ciphertext only; it must not decrypt, generate, log, or inspect plaintext Hermes task payloads or results.
- Hermes Companion is a separate native app outside this repository. Repository changes should provide the server, control-plane, CLI, SDK, docs, and verifier support it needs; do not assume the native app is implemented here.
- Native Hermes Companion is a public client. It must not require, embed, paste, or store a long-lived `MUSUBI_API_KEY`.
- Browser/control-plane code must not contain Basic Auth credentials, admin passwords, app API keys, app private keys, or copied local SDK secrets.
- Long-lived app API keys may remain for backend/server-side integrations only. They must not be the recommended Hermes native setup path.
- Device registration should register and start the device service only. `device register --with-hermes` must be hidden, removed from user-facing setup, or clearly marked development-only.
- The first native authorization implementation is loopback PKCE only. Do not implement device authorization in this refactor.
- Do not support custom URL schemes in this refactor.
- Loopback redirect URIs must be restricted to:
  - scheme `http`
  - host `127.0.0.1` or `[::1]`
  - port range `49152-65535`
  - path `/callback`
- Reject `localhost`, external hosts, wildcard domains, LAN IPs, `0.0.0.0`, non-http schemes, arbitrary paths, and ports outside `49152-65535`.
- Native app encryption uses a durable per-install app keypair. The private key stays in native app secure storage where possible. No key export, import, cloud backup, or device migration flow is required in this refactor.
- The native app should register only its public encryption key with Musubi during authorization. Server-side encryption of plaintext task content is out of scope and must not be introduced.
- App session tokens must be scoped to `user_id + app_id + workspace_id + expiry`.
- Runtime authorization must check current active grants for the token's user, app, workspace, device, and channel on every request. Do not snapshot device access into the token in a way that ignores revocation.
- A live session may access newly approved devices in the same workspace after current-grant checks pass.
- Revoking a grant must immediately block further runtime access to that grant's device/channel, even for existing live sessions.
- Keep admin app management separate from individual user device consent. Admins manage app identity and allowed scopes; individual users approve and revoke app access to their own devices.
- The first admin model is intentionally simple: one admin user signs in with username/password, receives a server-issued HttpOnly SameSite admin session cookie, and can create/manage apps. Do not build multi-admin RBAC, SSO, SCIM, delegated administration, or enterprise identity in this refactor.
- App runtime credentials, including native app session tokens and backend app API keys, must not be accepted for admin/control-plane management APIs.
- Short-lived app session tokens and refresh tokens must be stored hashed at rest. Token secrets must be shown only once in responses where applicable and must not be logged.
- Default token lifetime target: access token 1 hour, refresh session 30 days, idle timeout 14 days, refresh token rotation required.
- Keep existing third-party/developer app flows working, but make them non-recommended for the first-party Hermes native setup.
- Do not turn Musubi into remote desktop, SSH, VPN, arbitrary shell execution, or generic remote-control.
- Keep changes aligned with existing repo patterns and avoid broad rewrites unrelated to this refactor.
</constraints>

<done_when>
This goal is complete only when all of these are true:

- `docs/hermes_native_companion_user_consent_plan.md` remains the source plan and any implementation details that changed during execution are reflected in docs or guides.
- `#setup/hermes` presents the user flow as:
  1. register/start this Mac
  2. open Hermes Companion
  3. sign in and approve access in Musubi
- `#setup/hermes` does not ask users to copy `MUSUBI_API_KEY`, `MUSUBI_APP_PRIVATE_KEY`, app key ids, or local SDK config paths.
- The setup page status can detect and show device registered, device online, Hermes plugin capability available, Hermes Companion authorized, and active grant.
- User-facing setup and generated commands do not use `device register --with-hermes`; if the flag remains, it is development-only and covered by tests/docs as non-recommended.
- A user can register a device with one device-focused command and see it online in the control plane or verifier.
- Control-plane frontend assets contain no hard-coded Basic Auth credentials, admin passwords, app API keys, app private keys, or constructed hard-coded Basic Auth headers.
- The relay/control-plane server exposes single-admin login, logout, and current-admin behavior using a server-issued HttpOnly SameSite session cookie.
- Admin management APIs require the admin session cookie and reject unauthenticated requests.
- Admin management APIs reject app runtime credentials, including backend app API keys and native app session tokens.
- The admin UI lets the single admin create or manage a trusted first-party Hermes Companion app with allowed Hermes channels.
- Individual user/device UI lets the user approve Hermes Companion for one of their own devices and revoke that access.
- Existing third-party/developer app flows still have a visible non-default path and their existing verifier coverage continues to pass.
- A native app can create a loopback PKCE authorization request without a client secret.
- Authorization request creation validates redirect URI shape, PKCE challenge method, app/client identity, requested capabilities, app public key, workspace, expiry, and app trust/allowed scopes.
- Redirect URI validation accepts `http://127.0.0.1:<49152-65535>/callback` and `http://[::1]:<49152-65535>/callback`.
- Redirect URI validation rejects `localhost`, external hosts, wildcard domains, LAN IPs, `0.0.0.0`, non-http schemes, arbitrary paths, missing ports, and ports outside `49152-65535`.
- Musubi UI can complete authorization by authenticating the user, selecting an owned registered device, showing requested Hermes channels, creating/updating the grant, and redirecting to the loopback callback with an authorization code.
- Authorization codes expire, are one-time use, and require the matching PKCE verifier at token exchange.
- Token exchange returns a short-lived Bearer app session token and does not return a long-lived app API key or app private key.
- App session tokens are stored hashed at rest and scoped to `user_id + app_id + workspace_id + expiry`.
- Refresh sessions, if implemented, use 30 day max lifetime, 14 day idle timeout, rotation, reuse detection, and hashed token storage.
- Runtime app APIs accept both existing backend app API keys where appropriate and native app session tokens where appropriate.
- Native app session tokens can call runtime APIs needed by Hermes Companion: identify app/session, list granted devices, fetch granted device public keys, send encrypted messages, fetch message status/events, and cancel messages.
- Runtime APIs using native app session tokens enforce current active grants for token user, app, workspace, device, and channel at request time.
- Revoking a grant immediately prevents an existing live native app session token from sending new Hermes tasks, fetching that device public key, cancelling that device's messages, or reading events/status outside allowed scope.
- Newly approved grants in the same workspace become visible to an existing live session after runtime current-grant checks pass.
- Hermes task message creation through the native-session path accepts ciphertext only and does not require server-side plaintext payload encryption.
- Server logs, API responses, database records, and audit events do not expose plaintext Hermes task payloads, app private keys, app API key secrets, native session token secrets, refresh token secrets, or admin passwords.
- Device private key material remains separate from native Hermes app private key material; tests prove they are not reused or derived from each other.
- Local policy and server grants still both apply: server checks cloud grant/current session access and device service still enforces local policy before Hermes execution.
- The app SDK supports native-client usage with public client id, loopback PKCE helper behavior or examples, short-lived session token auth, device public key fetch, local encryption key usage, and no required `MUSUBI_APP_ID` when it can be inferred from authenticated session or key metadata.
- Documentation explains, from a user perspective, what app id, app key id, API key, app private key, native session token, workspace, device grant, and local policy mean, and which ones native Hermes users do not need to handle.
- A focused verifier exists for the native Hermes user-consent flow, for example `bun run verify:hermes-native-consent`, and it covers admin login, no frontend hard-coded Basic Auth, admin app setup, device registration/start, loopback PKCE validation, user consent, token exchange, encrypted message send, current-grant enforcement, and revocation.
- `bun run verify:m2-control-plane` passes and asserts the simplified setup page, current-origin command generation, no required developer/publisher setup for Hermes native users, and no frontend hard-coded Basic Auth.
- `bun run verify:m3-app-sdk` passes with native-session SDK coverage.
- `bun run verify:m3.5-browser-session` passes or is updated to preserve the intended browser/session key boundaries without weakening them.
- `bun run verify:m4-hosted-local` passes or an equivalent hosted-local verifier proves the new auth/session/grant paths work in the Cloudflare Worker target.
- Existing M1/M2/M3/M4 verifiers that cover unaffected core behavior still pass, or any expected verifier changes are documented with a concrete replacement check.
- `GOCACHE="$PWD/.cache/go-build" go test ./...` passes.
- `git diff --check` passes.
</done_when>

<workflow>
1. Inspect the current repo state with `git status --short`. Preserve unrelated user changes.
2. Read the context files and run the discovery commands in parallel where possible.
3. Map existing auth, app, device, grant, message, setup UI, SDK, and verifier flows before editing.
4. Add or update the server data model for native authorization requests and hashed app session tokens. Add migrations or in-memory/local-dev structures consistently with existing storage patterns.
5. Remove hard-coded frontend Basic Auth and implement the simple single-admin login/logout/current-session flow with HttpOnly SameSite cookie enforcement for admin APIs.
6. Separate admin app management from individual user device consent in the control-plane UI and API boundaries.
7. Simplify the Hermes setup page so it shows only device registration/start, opening Hermes Companion, and approving access in Musubi. Hide or demote `--with-hermes`.
8. Implement public/native app metadata and loopback PKCE authorization request creation with strict redirect validation.
9. Implement authorization approval UI/API: authenticate user, choose owned device, show requested Hermes channels, create/update the app-device grant, and redirect to the loopback callback with a one-time code.
10. Implement token exchange with PKCE verifier validation, expiry, one-time code use, hashed token storage, default lifetimes, and no long-lived app API key/private key exposure.
11. Extend runtime app auth so existing backend app API keys and native app session tokens are both supported where appropriate, while admin APIs remain admin-session-only.
12. Enforce current active grants on every native-session runtime request for list devices, public key fetch, send message, status/events, and cancel.
13. Preserve encrypted payload handling and local policy enforcement through the device service and Hermes plugin path.
14. Update the app SDK types/client and examples for native-client PKCE/session-token usage and local encryption key handling.
15. Update docs and guides to explain the simplified user flow, admin flow, token/key concepts, workspace, revocation, and non-goals.
16. Add or update focused tests and verifiers, then run focused checks before broad checks.
17. Review logs, API responses, static frontend assets, and verifier fixtures for leaked secrets or plaintext payloads.
18. Run final verification, inspect `git diff`, and prepare a concise completion report.
</workflow>

<verification_loop>
Run focused checks after each major implementation slice. Prefer adding a dedicated native-consent verifier and package script:

```bash
bun run verify:hermes-native-consent
bun run verify:m2-control-plane
bun run verify:m3-app-sdk
bun run verify:m3.5-browser-session
bun run verify:m4-hosted-local
GOCACHE="$PWD/.cache/go-build" go test ./...
git diff --check
```

Run broader regression checks before completion when feasible:

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
bun run verify:slice11
bun run verify:m4-platform-trust
```

If a verifier cannot run because of missing local services, unavailable Hermes runtime, missing hosted secrets, or sandbox restrictions, record the exact command, the failure reason, and the nearest concrete check that was run instead. Do not mark the goal complete if a required behavior is only assumed.

Manual/security checks that must be backed by command output or code inspection:

- Search built and source frontend assets for Basic Auth, admin credentials, app API keys, private keys, and copied SDK secret names.
- Confirm admin management endpoints reject app API keys and native app session tokens.
- Confirm runtime native-session endpoints reject revoked grants immediately.
- Confirm redirect validation accepts only the approved loopback URI shape.
- Confirm logs and audit records contain metadata and ciphertext only, not plaintext Hermes payloads or token secrets.
</verification_loop>

<execution_rules>
- Check git status before edits.
- Preserve unrelated user changes.
- Prefer `rg` over `grep` when available.
- Use the runtime's patch/edit tool for manual edits when available.
- Read context files before implementation.
- Batch independent file reads in parallel when the runtime supports it.
- Run focused tests before broad tests.
- Do not paper over failures.
- Do not widen scope.
- Keep the final answer concise.
- Follow `AGENTS.md` project guidance.
- Keep server payload-blindness and app/device key boundaries explicit in code, docs, and tests.
- Do not revert dirty worktree changes that are unrelated to this goal.
- When existing files contain user or previous-agent edits, work with them rather than resetting them.
- Use existing repo patterns for API routes, verifier scripts, migrations, SDK types, and control-plane UI.
- Add tests alongside risky behavior changes, especially auth, consent, redirect validation, token storage, revocation, and secret hygiene.
- Before finishing, inspect the final diff for accidental secret exposure, unrelated formatting churn, and user-facing setup language that still recommends long-lived app credentials.
</execution_rules>

<output_contract>
Final response should include:

- A concise implementation summary.
- The exact verification commands run and their pass/fail results.
- Any commands that could not run, with concrete reasons.
- The new or updated verifier names.
- A short note on remaining operational follow-up, if any.

The goal should be marked complete only when the `done_when` contract is satisfied or any remaining gap is explicitly called out as incomplete.
</output_contract>
