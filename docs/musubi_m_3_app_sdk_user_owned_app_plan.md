# Musubi M3 App SDK and User-owned App Plan

## 0. Document Status

Draft for `docs/app_sdk_m3.md`.

This document defines the scope, architecture, SDK design, user-owned app self-service flow, API contracts, implementation slices, and acceptance criteria for Musubi M3.

## 1. M3 Goal

M1 proved encrypted app-to-local-Hermes invocation.

M2 made Musubi understandable and controllable through Devices, Apps, Grants, Capabilities, Messages, and Audit UX.

M2.5 proved Musubi can support a real external coding-agent adapter through the Codex plugin.

M3 makes app-side integration easy and safe.

M3 goal:

> Let first-party apps and user-owned apps integrate with Musubi without manually implementing key handling, payload encryption, message envelopes, event streaming, result decryption, status polling, cancellation, and error normalization.

M3 has two primary themes:

1. **App SDK** — make app-side integration simple.
2. **User-owned App Self-service** — let power users create app identities for their own scripts/automation safely.

## 2. Why M3 Matters

Without an App SDK, every Musubi caller has to manually implement:

```text
- app identity configuration
- device public key lookup
- payload encryption
- envelope creation
- /v1/messages calls
- message status polling
- event subscription
- result decryption
- cancellation
- error handling
```

This creates problems:

1. App developers may misuse crypto.
2. Envelope construction may drift across callers.
3. Event/result handling becomes repetitive.
4. Third-party readiness is impossible without a clean SDK.
5. User-owned scripts remain too hard for power users.

M3 should turn Musubi from a working platform into an integratable platform.

## 3. M3 Non-goals

M3 does not include:

- Third-party public marketplace
- Public OAuth app review
- Billing
- Enterprise RBAC
- SCIM
- Plugin marketplace
- Remote plugin install
- Full browser-only key management
- Full key rotation automation
- Complex artifact SDK
- Rich typed SDKs for every plugin
- Replacing Plugin SDK
- Replacing CLI

M3 should stay focused on app-side integration and user-owned app creation.

## 4. Target Users

## 4.1 First-party App Developer

Example:

- Hermes Companion backend
- newbro backend
- Musubi Demo App

Needs:

- Send encrypted task to device/plugin/channel
- Receive and decrypt streaming events
- Cancel tasks
- Read status
- Handle errors consistently
- Avoid manual crypto/envelope code

## 4.2 Power User / User-owned App Developer

Example:

- A user writing a local automation script
- A user running a personal server that talks to their own Musubi devices
- A user testing custom workflows

Needs:

- Self-service create app identity
- Generate/store app private key
- Create API key
- Grant app to device/channels
- Use SDK with minimal setup

## 4.3 Future Third-party Developer

Not fully supported in M3, but M3 should prepare for them.

Needs later:

- Developer app registration
- OAuth-style consent
- permission declarations
- app review
- SDK docs

M3 should not expose public third-party onboarding yet, but the SDK should not block it.

## 5. Product Scope

M3 includes:

1. TypeScript App SDK v0
2. Optional Python App SDK v0.1 or later
3. User-owned app creation flow
4. API key creation and management UX
5. App private key generation/export flow
6. SDK docs and quickstarts
7. App-side event streaming abstraction
8. App-side cancellation abstraction
9. Error normalization
10. Internal migration of Hermes/demo sender to SDK

M3 does not need to include deep typed helpers for every plugin, but should include generic invocation and optional thin helpers for Hermes/Codex examples.

## 6. M3 Product Positioning

M3 positioning:

> Musubi App SDK lets apps ask local capabilities safely without implementing relay, crypto, or message lifecycle logic.

Developer-facing one-liner:

> Send encrypted tasks to user-approved local plugins with a few lines of code.

Power-user one-liner:

> Create a personal Musubi app and securely call your own machines from scripts.

## 7. App SDK Concepts

## 7.1 Musubi App

A Musubi App is the app-side identity that sends messages.

It has:

```text
app_id
api_key
app public key
app private key
workspace_id
status
```

## 7.2 App SDK Client

The SDK client represents an app caller.

Example:

```ts
const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL,
  appId: process.env.MUSUBI_APP_ID,
  apiKey: process.env.MUSUBI_API_KEY,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY,
});
```

## 7.3 Invocation

An invocation is one app-to-device/plugin/channel request.

It includes:

```text
device_id
channel
payload
message_id
status
events
result
cancel
```

## 7.4 Event Stream

An event stream is the app-side representation of device/plugin events.

SDK should support:

```ts
for await (const event of invocation.events()) {
  console.log(event);
}
```

## 7.5 Result

For request/response or final task result:

```ts
const result = await invocation.result();
```

## 7.6 Cancellation

```ts
await invocation.cancel({ reason: "User clicked stop" });
```

## 8. SDK Design Principles

## 8.1 Safe by default

The SDK should not expose raw crypto as the default path.

Developers should not need to manually construct:

```text
crypto header
envelope key ids
ciphertext
nonce
expires_at
```

## 8.2 Generic first, typed helpers second

M3 SDK should prioritize a generic API:

```ts
musubi.invoke({ deviceId, channel, payload })
```

Then provide optional helpers:

```ts
musubi.hermes.createTask(...)
musubi.codex.createTask(...)
```

Typed helpers should be thin wrappers over generic invoke.

## 8.3 Server-blind by construction

SDK should make it hard to accidentally send plaintext payloads to the server.

The send path should always encrypt payload before calling Musubi API.

## 8.4 Keep browser support explicit

M3 primary SDK target:

```text
Node.js / backend runtime
```

Browser support should be experimental or not supported in M3.

Reason:

- App private keys in browsers are risky.
- WebCrypto non-exportable key flows need careful design.
- M3 should not block on browser key management.

## 8.5 Stable protocol surface

M3 SDK should be based on M1/M2/M2.5 validated contracts:

```text
envelope
crypto model
message statuses
event semantics
cancel semantics
error codes
```

## 9. TypeScript SDK Package

Package name:

```text
@musubi/app-sdk
```

Directory:

```text
sdk/app-js/
  package.json
  src/
    client.ts
    crypto.ts
    invocation.ts
    events.ts
    errors.ts
    devices.ts
    messages.ts
    helpers/
      hermes.ts
      codex.ts
  examples/
    encrypted-echo.ts
    hermes-task.ts
    codex-task.ts
  tests/
```

## 10. SDK API Draft

## 10.1 Client Initialization

```ts
import { MusubiApp } from "@musubi/app-sdk";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL!,
  appId: process.env.MUSUBI_APP_ID!,
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
});
```

Optional advanced initialization:

```ts
const musubi = new MusubiApp({
  apiBaseUrl,
  appId,
  apiKey,
  keyProvider: new EnvKeyProvider(),
  eventTransport: "sse",
});
```

## 10.2 List Granted Devices

```ts
const devices = await musubi.devices.listGranted();
```

Return:

```ts
type GrantedDevice = {
  id: string;
  name: string;
  status: "online" | "offline" | "revoked";
  platform?: string;
  plugins: Array<{
    name: string;
    version: string;
    channels: string[];
  }>;
};
```

## 10.3 Generic Invoke

```ts
const invocation = await musubi.invoke({
  deviceId: "dev_123",
  channel: "hermes.task.create",
  payload: {
    type: "hermes.task.create",
    body: {
      instruction: "Summarize this repo",
      workspace_hint: "~/projects/demo",
      stream: true,
    },
  },
});
```

The SDK handles:

```text
- fetch device public key
- generate nonce
- encrypt payload
- construct envelope
- send message
- return invocation object
```

## 10.4 Events

```ts
for await (const event of invocation.events()) {
  console.log(event.type, event.body);
}
```

SDK handles:

```text
- subscribe to app-visible events
- receive encrypted event envelopes
- decrypt with app private key
- correlate events to invocation
- normalize event payload
```

## 10.5 Result

```ts
const result = await invocation.result({ timeoutMs: 10 * 60 * 1000 });
```

## 10.6 Cancel

```ts
await invocation.cancel({ reason: "User clicked stop" });
```

SDK behavior:

- Determine cancel channel from invocation/channel mapping if possible.
- Or require explicit cancel channel:

```ts
await invocation.cancel({
  channel: "hermes.task.cancel",
  payload: {
    type: "hermes.task.cancel",
    body: { task_id: "task_123" },
  },
});
```

M3 recommendation:

Keep generic cancel explicit first. Add convenience mapping later.

## 10.7 Hermes Helper

```ts
const task = await musubi.hermes.createTask({
  deviceId: "dev_123",
  instruction: "Check why tests are failing",
  workspaceHint: "~/projects/demo",
  stream: true,
});

for await (const event of task.events()) {
  console.log(event.body.message);
}

const result = await task.result();
```

## 10.8 Codex Helper

```ts
const task = await musubi.codex.createTask({
  deviceId: "dev_123",
  instruction: "Inspect this repo and suggest a fix",
  workspaceHint: "~/projects/demo",
});

for await (const event of task.events()) {
  console.log(event.body.message);
}
```

Codex helper should be optional and thin.

## 11. SDK Error Model

SDK should normalize server, crypto, transport, and plugin errors.

Error classes:

```ts
MusubiError
MusubiAuthError
MusubiGrantDeniedError
MusubiDeviceOfflineError
MusubiLocalPolicyDeniedError
MusubiPluginNotFoundError
MusubiMessageTimeoutError
MusubiDecryptError
MusubiCancelledError
MusubiServerError
```

Error shape:

```ts
type MusubiErrorInfo = {
  code: string;
  message: string;
  stage?: "auth" | "permission" | "delivery" | "device" | "plugin" | "crypto" | "timeout";
  messageId?: string;
  deviceId?: string;
  channel?: string;
};
```

Example:

```ts
try {
  await musubi.invoke(...);
} catch (err) {
  if (err instanceof MusubiGrantDeniedError) {
    // show connect/authorize UI
  }
}
```

## 12. Event Transport Options

M3 should support at least one event transport.

Options:

## 12.1 Polling

Simplest and reliable.

```text
SDK polls /v1/messages/:id/events
```

Pros:

- Easy
- Works everywhere
- Good enough for early M3

Cons:

- Less real-time
- More request overhead

## 12.2 Server-Sent Events

Good for one-way app event streams.

```text
GET /v1/messages/:id/events/stream
```

Pros:

- Simple browser/backend support
- Good for streaming task events

Cons:

- Need connection handling

## 12.3 WebSocket

Useful later for rich app sessions.

Pros:

- Bi-directional
- Better long-lived apps

Cons:

- More complex

M3 recommendation:

```text
Start with polling + optional SSE.
Do not require app-side WebSocket in M3.
```

## 13. User-owned App Self-service

## 13.1 Goal

Allow a user to create an app identity for personal scripts and automation.

Example use case:

```text
I want my personal automation server to send encrypted tasks to my own Mac's Hermes/Codex plugin.
```

## 13.2 User-owned App Creation UX

Route:

```text
/apps/new
```

Flow:

```text
Choose app type
  ↓
Name app
  ↓
Generate app key pair
  ↓
Download/copy env vars
  ↓
Create API key
  ↓
Grant app to device/channels
```

## 13.3 App Type Selection

Options in M3:

```text
First-party app: hidden/admin only
User-owned app: available to users
Third-party app: coming later
```

User-facing copy:

> User-owned apps are for your own scripts, services, and automations. They can only access devices and channels you explicitly grant.

## 13.4 Key Generation Options

M3 should support local/browser-assisted key generation carefully.

Recommended for web UI:

- Generate key pair in browser using WebCrypto if feasible.
- Upload public key only.
- Show/download private key once.
- Warn user Musubi cannot recover it.

Alternative simpler M3:

- Generate keys server-side only for local/dev user-owned apps but show strong warning.

Preferred M3 design:

```text
Browser generates app key pair.
Public key is sent to Musubi server.
Private key is downloaded/copied by user.
Server never stores private key.
```

## 13.5 Output Env Vars

After creation, show once:

```env
MUSUBI_APP_ID=app_user_xxx
MUSUBI_API_KEY=musubi_app_sk_xxx
MUSUBI_APP_PRIVATE_KEY=base64_xxx
MUSUBI_API_BASE_URL=https://api.musubi.dev
```

Copy:

> Store these securely. Musubi cannot show the app private key again. If lost, rotate the app key.

## 13.6 CLI App Creation

Power user CLI flow:

```bash
musubi app create "My Automation" \
  --type user_owned \
  --generate-key-local \
  --env
```

Output:

```env
MUSUBI_APP_ID=app_user_xxx
MUSUBI_API_KEY=musubi_app_sk_xxx
MUSUBI_APP_PRIVATE_KEY=base64_xxx
MUSUBI_API_BASE_URL=https://api.musubi.dev
```

## 14. App API Key Management

M3 should add API key management for apps.

## 14.1 API Key Table

```sql
create table app_api_keys (
  id text primary key,
  app_id text not null references apps(id),
  workspace_id text not null references workspaces(id),
  name text,
  key_hash text not null,
  key_prefix text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text
);
```

## 14.2 API Key UX

In App Detail → API Keys:

- List keys by prefix/name
- Show created/last used
- Create new key
- Revoke key

Never show full key again after creation.

## 14.3 API Key Scope

For M3, app API keys are scoped to:

```text
workspace_id + app_id
```

Allowed operations:

```text
- send message as this app
- list devices granted to this app
- get public keys for granted devices
- read own message statuses/events
- cancel own messages
```

Not allowed:

```text
- create grants
- revoke devices
- manage other apps
- read all workspace messages
```

## 15. App Key Management

M3 should distinguish:

```text
API key: server authentication
App encryption key: payload privacy
```

## 15.1 App Keys Table

M1/M2 already have `app_keys`.

M3 adds UX and SDK use.

Fields:

```text
key_id
public_key
fingerprint
status
created_at
retired_at
revoked_at
```

## 15.2 Rotation UX

Full rotation automation can be deferred.

M3 minimal rotation:

1. Generate new app key pair.
2. Upload new public key.
3. Mark new key active.
4. User updates app private key env var.
5. Retire old key.

UI warning:

> Rotating the app key requires updating the private key in your app runtime.

## 16. Backend API Contracts for M3

## 16.1 Create User-owned App

```http
POST /v1/apps
Authorization: Bearer user_session
```

Request:

```json
{
  "workspace_id": "ws_123",
  "name": "My Automation",
  "type": "user_owned",
  "public_key": "base64_app_public_key"
}
```

Response:

```json
{
  "app_id": "app_123",
  "app_key_id": "appkey_123",
  "status": "active"
}
```

## 16.2 Create App API Key

```http
POST /v1/apps/{app_id}/api-keys
Authorization: Bearer user_session
```

Request:

```json
{
  "name": "Local automation key"
}
```

Response:

```json
{
  "api_key_id": "appapikey_123",
  "api_key": "musubi_app_sk_xxx",
  "key_prefix": "musubi_app_sk_abc123"
}
```

Server stores only hash.

## 16.3 List App API Keys

```http
GET /v1/apps/{app_id}/api-keys
```

Response:

```json
{
  "api_keys": [
    {
      "id": "appapikey_123",
      "name": "Local automation key",
      "key_prefix": "musubi_app_sk_abc123",
      "status": "active",
      "created_at": "...",
      "last_used_at": "..."
    }
  ]
}
```

## 16.4 Revoke App API Key

```http
POST /v1/apps/{app_id}/api-keys/{api_key_id}/revoke
```

## 16.5 List Granted Devices for App API Key

```http
GET /v1/app/devices
Authorization: Bearer MUSUBI_API_KEY
```

Response:

```json
{
  "devices": [
    {
      "id": "dev_123",
      "name": "Ethan MacBook Pro",
      "status": "online",
      "active_key": {
        "id": "devkey_123",
        "public_key": "base64..."
      },
      "granted_channels": [
        "hermes.task.create",
        "codex.task.create"
      ],
      "plugins": []
    }
  ]
}
```

## 16.6 Get Device Public Key for App

```http
GET /v1/app/devices/{device_id}/public-key
Authorization: Bearer MUSUBI_API_KEY
```

Server should only return this if app has active grant to device.

## 16.7 Send Message as App

Existing API:

```http
POST /v1/messages
Authorization: Bearer MUSUBI_API_KEY
```

M3 SDK consumes this.

## 16.8 List Message Events

Polling version:

```http
GET /v1/messages/{message_id}/events
Authorization: Bearer MUSUBI_API_KEY
```

SSE version:

```http
GET /v1/messages/{message_id}/events/stream
Authorization: Bearer MUSUBI_API_KEY
Accept: text/event-stream
```

Response events contain encrypted event envelopes.

## 17. SDK Internal Flow

## 17.1 Invoke Flow

```text
SDK invoke()
  ↓
authenticate with MUSUBI_API_KEY
  ↓
fetch granted device + active public key
  ↓
validate channel is granted if info available
  ↓
construct plaintext payload with nonce
  ↓
encrypt to device public key
  ↓
POST /v1/messages
  ↓
return Invocation object
```

## 17.2 Event Flow

```text
Invocation.events()
  ↓
connect SSE or poll events endpoint
  ↓
receive encrypted app-bound event envelope
  ↓
decrypt with MUSUBI_APP_PRIVATE_KEY
  ↓
yield plaintext event to app
```

## 17.3 Result Flow

```text
Invocation.result()
  ↓
consume events until terminal status/result
  ↓
return decrypted final result
```

## 17.4 Cancel Flow

```text
Invocation.cancel()
  ↓
create encrypted cancel payload
  ↓
POST /v1/messages or /v1/messages/:id/cancel with encrypted cancel payload
  ↓
return cancellation status
```

## 18. M3 UI Scope

M3 UI additions build on M2 Control Plane.

## 18.1 New App Flow

Route:

```text
/apps/new
```

Flow:

```text
Choose app type: User-owned App
Name app
Generate encryption key pair
Create API key
Show env vars
Next: Create grant
```

## 18.2 App Detail API Keys Section

Add section:

```text
API Keys
- key prefix
- name
- created at
- last used
- status
- revoke
```

## 18.3 App Detail App Keys Section

Add section:

```text
Encryption Keys
- active app key id
- public key fingerprint
- status
- created at
- rotate key placeholder
```

## 18.4 SDK Quickstart Panel

On App Detail page, show code sample:

```ts
import { MusubiApp } from "@musubi/app-sdk";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL!,
  appId: process.env.MUSUBI_APP_ID!,
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
});

const invocation = await musubi.invoke({
  deviceId: "dev_123",
  channel: "hermes.task.create",
  payload: {
    type: "hermes.task.create",
    body: { instruction: "Summarize this repo" },
  },
});
```

## 19. Documentation Scope

M3 docs:

```text
docs/sdk/app-sdk-js.md
docs/guides/create-user-owned-app.md
docs/guides/send-hermes-task.md
docs/guides/send-codex-task.md
docs/security/app-keys-vs-api-keys.md
```

Key doc topics:

1. API key vs app private key
2. Where to store keys
3. Backend vs browser usage
4. Creating a user-owned app
5. Granting app access to device channels
6. Sending first encrypted message
7. Handling streaming events
8. Cancelling a task
9. Error handling

## 20. Implementation Slices

## Slice 0: M3 Product and SDK Contract

Deliverables:

- `docs/app_sdk_m3.md`
- SDK API draft
- Error model draft
- User-owned app flow draft

Acceptance criteria:

- M3 scope agreed.
- SDK surface agreed enough to implement v0.

## Slice 1: App API Key Backend

Goal:

Add proper app-scoped API keys.

Deliverables:

- `app_api_keys` table
- Create/list/revoke API key endpoints
- API key hashing
- API key prefix display
- Last used tracking
- App-scoped auth middleware

Acceptance criteria:

- App API key can authenticate `/v1/messages`.
- App API key cannot manage grants/devices/apps.
- Revoked API key fails.

## Slice 2: App-side Public Key APIs

Goal:

Expose safe app-scoped device public key lookup.

Deliverables:

- `GET /v1/app/devices`
- `GET /v1/app/devices/:id/public-key`
- Grant enforcement for key lookup

Acceptance criteria:

- API key can only see granted devices.
- API key can only fetch public keys for granted devices.

## Slice 3: TypeScript SDK Crypto Core

Goal:

Implement SDK-side key and encryption utilities.

Deliverables:

- key parsing
- payload encryption to device public key
- event/result decryption with app private key
- nonce generation
- envelope construction
- schema validation

Acceptance criteria:

- SDK can encrypt/decrypt compatible with CLI.
- Test vectors pass.
- No raw plaintext is sent to message API.

## Slice 4: TypeScript SDK Client Core

Goal:

Implement generic MusubiApp client.

Deliverables:

- client initialization
- request wrapper
- `devices.listGranted()`
- `invoke()`
- message status fetch
- basic polling events
- `result()` helper

Acceptance criteria:

- SDK can run encrypted echo end-to-end.
- SDK can run Hermes task end-to-end.

## Slice 5: SDK Event Streaming

Goal:

Support better event consumption.

Deliverables:

- polling event iterator
- optional SSE event iterator
- event correlation
- terminal result detection
- timeout handling

Acceptance criteria:

- `for await` event loop works for Hermes and Codex events.
- Timeout produces normalized error.

## Slice 6: SDK Cancellation

Goal:

Support task cancellation.

Deliverables:

- generic cancel helper
- explicit cancel channel mode
- status handling
- cancellation error/result normalization

Acceptance criteria:

- SDK can cancel Hermes or Codex task if channel/grant exists.

## Slice 7: SDK Error Normalization

Goal:

Make errors easy to handle.

Deliverables:

- error classes
- error code mapping
- auth/grant/device/plugin/crypto/timeout errors
- docs and examples

Acceptance criteria:

- Common errors map to stable SDK classes.

## Slice 8: User-owned App Creation UI

Goal:

Let users create their own app identities.

Deliverables:

- `/apps/new` user-owned app flow
- browser/local key generation if feasible
- public key upload
- API key creation
- env var output screen
- next step to create grant

Acceptance criteria:

- User can create app and copy env vars.
- Server does not store app private key in preferred flow.
- User can proceed to grant flow.

## Slice 9: App Detail Key Management UI

Goal:

Show API keys and encryption keys clearly.

Deliverables:

- API keys list/create/revoke
- app encryption key metadata
- key fingerprint display
- security copy
- dev warning if private key is server-generated

Acceptance criteria:

- User understands API key vs app private key.
- User can revoke API key.

## Slice 10: SDK Examples and Docs

Goal:

Make first integration easy.

Deliverables:

- `examples/app-sdk-encrypted-echo`
- `examples/app-sdk-hermes-task`
- `examples/app-sdk-codex-task`
- quickstart docs
- troubleshooting docs

Acceptance criteria:

- New developer can send first encrypted echo in under 10 minutes.
- Hermes and Codex examples work against local dev server.

## Slice 11: Migrate Hermes Demo to SDK

Goal:

Dogfood the SDK.

Deliverables:

- Hermes Companion demo sender uses `@musubi/app-sdk`
- Remove duplicated crypto/envelope code from demo app
- Document migration lessons

Acceptance criteria:

- Hermes M1/M2 flow still works using SDK.

## 21. M3 Acceptance Criteria

M3 is complete when:

1. A user can create a user-owned Musubi app from UI or CLI.
2. The app has an app public/private key pair and an app API key.
3. The server stores only app public key and API key hash.
4. User can copy env vars for app integration.
5. User can grant the app access to device/plugin/channels.
6. TypeScript App SDK can send encrypted echo message.
7. TypeScript App SDK can send encrypted Hermes task.
8. TypeScript App SDK can send encrypted Codex task if M2.5 exists.
9. SDK can receive/decrypt streaming events.
10. SDK can return final result.
11. SDK can cancel a task with explicit cancel channel.
12. SDK normalizes common errors.
13. Revoked API keys fail.
14. App API keys cannot manage grants/devices/apps.
15. Hermes demo app uses SDK instead of custom integration code.

## 22. M3 Demo Script

```text
1. Open Musubi Control Plane.
2. Go to Apps → New App.
3. Choose User-owned App.
4. Name it "My Automation".
5. Generate app encryption key pair.
6. Create API key.
7. Copy env vars:
   - MUSUBI_APP_ID
   - MUSUBI_API_KEY
   - MUSUBI_APP_PRIVATE_KEY
   - MUSUBI_API_BASE_URL
8. Create grant:
   - App: My Automation
   - Device: Ethan MacBook Pro
   - Plugin: hermes
   - Channels: hermes.task.create, hermes.task.cancel, hermes.task.status
9. Clone SDK example.
10. Paste env vars.
11. Run encrypted echo example.
12. Run Hermes task example.
13. Watch events stream in terminal.
14. Revoke API key.
15. Run example again and see auth failure.
```

## 23. Security Risks and Mitigations

## 23.1 Risk: App private key leakage

Risk:

Users may paste app private keys into unsafe places.

Mitigation:

- Clear docs
- One-time display
- Env var examples
- Warn against browser/localStorage usage
- Encourage backend/server-side usage

## 23.2 Risk: API key over-permission

Risk:

App API key can manage too much.

Mitigation:

- App-scoped API key middleware
- Deny management APIs by default
- Only allow own message/device-public-key/status/event operations

## 23.3 Risk: SDK sends plaintext by mistake

Risk:

SDK bug or API misuse sends plaintext payload to server.

Mitigation:

- `invoke()` only accepts plaintext locally and always encrypts before send.
- Low-level raw send API marked internal/advanced.
- Tests verify server receives ciphertext only.

## 23.4 Risk: Browser key management

Risk:

Developers use SDK in browser with long-lived private keys.

Mitigation:

- M3 docs state Node/backend is primary target.
- Browser usage marked experimental/not recommended.
- Future browser mode should use short-lived/session keys.

## 23.5 Risk: SDK locks unstable protocol

Risk:

SDK API becomes hard to change.

Mitigation:

- Version SDK as `0.x`.
- Mark experimental helpers.
- Keep generic invoke stable.
- Maintain protocol version field.

## 24. Product Risks

## 24.1 Too much SDK before platform maturity

Risk:

SDK polish consumes time before core use cases stabilize.

Mitigation:

- M3 SDK v0 focuses on generic invoke/events/cancel only.
- Typed helpers stay thin.

## 24.2 User-owned app confusion

Risk:

Users confuse Musubi user login, app API key, and app private key.

Mitigation:

- Explicit UI copy:
  - User login manages resources.
  - API key calls Musubi server.
  - App private key decrypts returned results.

## 24.3 Third-party expectations too early

Risk:

External developers assume public marketplace support.

Mitigation:

- Clearly label M3 as user-owned app support.
- Third-party app support remains future work.

## 25. Post-M3 Roadmap

## M3.5 Browser/session key model

If browser-based apps become important, design:

- short-lived session keys
- WebCrypto non-exportable keys
- backend-assisted key exchange
- ephemeral app sessions

## M4 Third-party App Platform

Includes:

- developer registration
- OAuth-style consent
- permission declarations
- app review/trust status
- abuse reporting
- public docs

## M4.5 Plugin Registry

Includes:

- plugin publishing
- plugin signing
- plugin trust levels
- workspace plugin allowlist

## M5 Enterprise Controls

Includes:

- workspace roles
- SSO
- SCIM
- audit export
- policy templates
- compliance controls

## 26. M3 Decision Summary

```text
M3 Theme:
  Make app-side integration easy and safe.

Primary deliverable:
  TypeScript App SDK v0.

Secondary deliverable:
  User-owned app self-service creation.

Main SDK API:
  musubi.invoke({ deviceId, channel, payload })
  invocation.events()
  invocation.result()
  invocation.cancel()

Primary runtime target:
  Node.js/backend.

Not primary target:
  browser-only apps with long-lived private keys.

Security model:
  API key authenticates app to server.
  App private key decrypts device results.
  Server stores public keys and API key hashes only.

Exit demo:
  User creates a personal app, copies env vars, runs SDK example, sends encrypted Hermes/Codex task,