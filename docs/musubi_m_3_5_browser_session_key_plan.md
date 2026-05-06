# Musubi M3.5 Browser and Session Key Plan

## 0. Document Status

Draft for `docs/browser_session_keys_m3_5.md`.

This document defines the product scope, security model, architecture, API contracts, SDK additions, implementation slices, and acceptance criteria for Musubi M3.5: Browser / Session Key Model.

## 1. M3.5 Goal

M3 introduced the App SDK and user-owned app self-service.

M3.5 solves the next practical problem:

> How can a browser-based companion app provide a great real-time Musubi experience without storing the long-lived `MUSUBI_APP_PRIVATE_KEY` in the browser?

M3.5 goal:

> Allow browser-based apps such as Hermes Companion Web to send tasks, receive streaming events, decrypt/display results, and cancel tasks through short-lived app sessions, while keeping long-lived app credentials on the backend.

The concrete M3.5 demo:

```text
Hermes Web Browser UI
  ↓ authenticated user session
Hermes Backend
  ↓ owns MUSUBI_API_KEY + MUSUBI_APP_PRIVATE_KEY
Musubi API / Relay
  ↓ encrypted task/event routing
User Device CLI
  ↓ Hermes/Codex plugin
Encrypted events/results returned
  ↓
Hermes Backend decrypts or bridges session-encrypted events
  ↓
Browser UI displays progress in real time
```

## 2. Problem Statement

M3 App SDK is primarily safe for backend/Node usage:

```text
Hermes Backend stores:
- MUSUBI_API_KEY
- MUSUBI_APP_PRIVATE_KEY
```

This is good for security, but browser-based apps still need:

- low-latency streaming events
- cancellation
- reconnect behavior
- user-specific task views
- minimal backend glue
- no long-lived private key in browser

Naively putting `MUSUBI_APP_PRIVATE_KEY` into browser local storage is not acceptable for production.

M3.5 defines a session-based model for browser use.

## 3. Non-goals

M3.5 does not include:

- Full third-party app platform
- Public OAuth consent for external apps
- Plugin marketplace
- Enterprise SSO
- Hardware-backed browser keys
- Fully decentralized browser-to-device encryption
- Browser storing long-lived app private keys
- Replacing backend SDK
- End-user-managed E2E keys across devices
- Full collaborative multi-user task sessions
- Complete offline browser replay

M3.5 is about safe browser participation in an app-owned Musubi flow.

## 4. Target Users

## 4.1 First-party Web App Developer

Example:

- Hermes Companion Web
- newbro web console
- Musubi demo web app

Needs:

- display live Musubi task events in browser
- cancel task from browser
- avoid exposing app private key
- avoid rewriting crypto/event logic repeatedly

## 4.2 End User

The user does not care about keys.

They want:

- open web UI
- pick device/workspace
- start task
- see progress streaming
- stop task
- reconnect without losing task state
- trust that browser is not holding dangerous long-lived secrets

## 4.3 Musubi Platform Developer

Needs:

- a secure reference architecture for browser apps
- clear boundaries between Musubi server, app backend, and browser
- reusable SDK patterns

## 5. M3.5 Core Principle

Long-lived app credentials stay on the app backend.

```text
MUSUBI_API_KEY: backend only
MUSUBI_APP_PRIVATE_KEY: backend only
```

Browser receives either:

1. decrypted task events from the app backend over the app's own authenticated channel; or
2. events re-encrypted to a short-lived browser session key.

M3.5 should not require browser to hold the long-lived app private key.

## 6. Architecture Options

There are three viable models.

## 6.1 Option A: Backend Decrypts, Browser Receives Plain App Events

Flow:

```text
Browser → Hermes Backend → Musubi
Device → Musubi → Hermes Backend
Hermes Backend decrypts event
Hermes Backend sends plaintext app event to browser over user-authenticated SSE/WebSocket
```

Pros:

- Simplest
- Best M3.5 starting point
- Browser has no Musubi private key
- Works with standard web auth
- Easy to debug

Cons:

- Hermes backend sees plaintext event content
- Not fully end-to-end from device to browser
- Backend must be trusted by the app/user

Best for:

- First-party apps like Hermes Companion
- M3.5 initial implementation

## 6.2 Option B: Backend Decrypts and Re-encrypts to Browser Session Key

Flow:

```text
Browser generates ephemeral session key pair
Browser sends public session key to Hermes Backend
Hermes Backend receives/decrypts Musubi event
Hermes Backend re-encrypts event to browser session public key
Browser decrypts with ephemeral session private key
```

Pros:

- Browser receives encrypted stream over app backend
- Reduces accidental exposure in frontend transport/logging
- Good stepping stone to more privacy-conscious UI
- Long-lived app private key remains backend-only

Cons:

- Backend still sees plaintext while bridging
- More implementation complexity
- Need session key lifecycle

Best for:

- M3.5 advanced mode
- Apps that want cleaner browser crypto hygiene

## 6.3 Option C: Device Encrypts Directly to Browser Session Key

Flow:

```text
Browser creates ephemeral session public key
App payload includes browser session public key
Device encrypts events/results directly to browser session key
Browser decrypts events
Backend cannot read returned event contents
```

Pros:

- Stronger privacy between device and browser session
- Backend can avoid seeing event plaintext

Cons:

- Much more complex
- Requires device/plugin/CLI to understand session recipient keys
- Harder to support replay/reconnect
- More key routing complexity
- May bypass app backend's ability to moderate/store task state

Best for:

- Future privacy mode
- Not M3.5 default

## 6.4 M3.5 Decision

M3.5 should implement:

```text
Default: Option A
Optional/experimental: Option B
Future: Option C
```

Default M3.5 architecture:

> The app backend owns long-lived Musubi credentials, uses App SDK to send tasks and decrypt results, then streams user-scoped events to the browser over the app's authenticated session.

This is the fastest and safest practical model for Hermes Companion Web.

## 7. Trust Boundaries

## 7.1 Browser

Browser can:

- authenticate as an end user to Hermes app
- request that Hermes backend starts a task
- receive task events for tasks the user is allowed to see
- request cancellation

Browser must not hold:

- `MUSUBI_API_KEY`
- long-lived `MUSUBI_APP_PRIVATE_KEY`
- device private keys

Browser may hold:

- app session token/cookie
- optional ephemeral session private key
- task session ID

## 7.2 Hermes Backend / App Backend

Backend can:

- hold `MUSUBI_API_KEY`
- hold `MUSUBI_APP_PRIVATE_KEY`
- call Musubi API
- decrypt device events/results
- enforce user/app authorization
- stream events to browser
- persist app-level task summaries if desired

Backend is trusted as part of the first-party app.

## 7.3 Musubi Server

Musubi server can:

- authenticate Hermes app API key
- validate grants
- route encrypted messages
- persist message status/audit

Musubi server cannot:

- decrypt Musubi payloads
- read task instructions/results
- access browser session plaintext unless app sends it separately

## 7.4 Device CLI

Device CLI can:

- decrypt app-to-device payloads
- enforce local policy
- invoke plugin
- encrypt results to app public key

Device CLI does not need to know browser session details in M3.5 Option A.

## 8. Recommended M3.5 Architecture

## 8.1 Default Architecture: App Backend Event Bridge

```text
+----------------------------+
| Browser UI                 |
| Hermes Companion Web       |
|                            |
| - user session cookie      |
| - no Musubi app private key|
+-------------+--------------+
              |
              | HTTPS/SSE/WebSocket
              v
+----------------------------+
| Hermes Backend             |
|                            |
| - user auth                |
| - owns MUSUBI_API_KEY      |
| - owns APP_PRIVATE_KEY     |
| - uses @musubi/app-sdk     |
| - decrypts events          |
| - streams to browser       |
+-------------+--------------+
              |
              | Musubi API
              v
+----------------------------+
| Musubi Server              |
|                            |
| - validates grant          |
| - routes ciphertext        |
| - status/audit             |
| - cannot decrypt payload   |
+-------------+--------------+
              |
              | WebSocket
              v
+----------------------------+
| User Device CLI            |
|                            |
| - decrypts task            |
| - local policy             |
| - plugin dispatch          |
+-------------+--------------+
              |
              v
+----------------------------+
| Hermes/Codex Plugin        |
+----------------------------+
```

## 8.2 Browser Event Channel

Hermes Backend exposes an app-level event endpoint:

```http
GET /api/tasks/{task_session_id}/events
Accept: text/event-stream
```

or:

```text
WebSocket /api/tasks/stream
```

M3.5 recommendation:

```text
Use SSE first.
Add WebSocket later if bidirectional browser sessions become necessary.
```

Reason:

- Task events are mostly one-way server-to-browser.
- Cancellation can be normal HTTP POST.
- SSE is simpler.

## 9. App Session Model

M3.5 introduces an app-level task session.

This is separate from Musubi message ID.

```text
App task session:
  controlled by Hermes backend and browser UX

Musubi message:
  relay-level delivery/execution unit
```

## 9.1 Task Session Fields

```ts
type AppTaskSession = {
  id: string;
  userId: string;
  appId: string;
  deviceId: string;
  pluginName: "hermes" | "codex" | string;
  channel: string;
  musubiMessageId?: string;
  status: "created" | "starting" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};
```

## 9.2 Why Have App Task Session IDs?

Because browser UI should not depend directly on Musubi message IDs.

Benefits:

- app can manage user authorization
- app can reconnect browser to task stream
- app can map multiple Musubi messages to one UX task
- app can hide internal relay details
- app can support retries/cancel/follow-ups

## 10. API Design: App Backend Layer

These APIs belong to Hermes Companion Backend, not Musubi Server.

## 10.1 Start Task

```http
POST /api/tasks
Authorization: user session cookie/token
```

Request:

```json
{
  "device_id": "dev_123",
  "plugin": "hermes",
  "channel": "hermes.task.create",
  "body": {
    "instruction": "Check why tests are failing.",
    "workspace_hint": "~/projects/demo",
    "stream": true
  }
}
```

Backend behavior:

1. Authenticate user.
2. Verify user can use this app/device grant.
3. Create app task session.
4. Use Musubi App SDK to invoke channel.
5. Store Musubi message ID on task session.
6. Start event bridge worker/stream.
7. Return task session ID.

Response:

```json
{
  "task_session_id": "ats_123",
  "status": "starting"
}
```

## 10.2 Stream Task Events

```http
GET /api/tasks/{task_session_id}/events
Accept: text/event-stream
```

SSE events:

```text
event: task.status
data: {"status":"running"}

event: task.progress
data: {"message":"Reading project files..."}

event: task.result
data: {"summary":"Tests fail because..."}

event: task.error
data: {"code":"LOCAL_POLICY_DENIED","message":"Local policy denied request."}
```

## 10.3 Get Task Session

```http
GET /api/tasks/{task_session_id}
```

Response:

```json
{
  "id": "ats_123",
  "device_id": "dev_123",
  "channel": "hermes.task.create",
  "status": "running",
  "created_at": "...",
  "updated_at": "..."
}
```

## 10.4 Cancel Task

```http
POST /api/tasks/{task_session_id}/cancel
```

Backend behavior:

1. Authenticate user.
2. Verify user owns/can access task session.
3. Use Musubi invocation cancel or send explicit cancel channel.
4. Update task session status.
5. Emit task cancellation event.

Response:

```json
{
  "task_session_id": "ats_123",
  "status": "cancel_requested"
}
```

## 11. Musubi SDK Additions for M3.5

M3 App SDK remains backend-oriented.

M3.5 adds helper utilities for backend event bridging.

## 11.1 Event Bridge Helper

```ts
const invocation = await musubi.hermes.createTask({
  deviceId,
  instruction,
  workspaceHint,
});

const bridge = createMusubiEventBridge({
  invocation,
  onEvent: async (event) => {
    await taskEventBus.publish(taskSessionId, event);
  },
  onResult: async (result) => {
    await taskSessions.markCompleted(taskSessionId, result);
  },
  onError: async (error) => {
    await taskSessions.markFailed(taskSessionId, error);
  },
});

bridge.start();
```

## 11.2 Task Session Adapter

Optional helper:

```ts
const task = await musubi.sessions.createBrowserTask({
  deviceId,
  channel: "hermes.task.create",
  payload,
  userId,
  onEvent,
});
```

M3.5 recommendation:

Keep this helper in examples first. Do not over-bake framework-specific task session abstractions into core SDK.

## 11.3 Browser Client Package

Optional package:

```text
@musubi/browser-client
```

But M3.5 should be careful: this package should not call Musubi API directly with long-lived app credentials.

It can help with app backend task streams:

```ts
const client = new MusubiBrowserTaskClient({
  baseUrl: "/api",
});

const task = await client.startTask({
  deviceId,
  channel: "hermes.task.create",
  body,
});

for await (const event of task.events()) {
  render(event);
}
```

This browser client talks to the app backend, not directly to Musubi.

## 12. Optional Session Key Mode

M3.5 may include experimental session key mode.

## 12.1 Browser Session Key Creation

Browser generates ephemeral key pair:

```ts
const sessionKeyPair = await createEphemeralSessionKey();
```

Browser sends public key when starting task:

```json
{
  "device_id": "dev_123",
  "channel": "hermes.task.create",
  "browser_session_public_key": "base64...",
  "body": {}
}
```

Backend stores session public key on app task session.

## 12.2 Backend Re-encryption

Backend receives decrypted Musubi event, then re-encrypts to browser session public key:

```text
Musubi event plaintext
  ↓
backend encrypts to browser session public key
  ↓
SSE data contains encrypted event
  ↓
browser decrypts with session private key
```

SSE event:

```text
event: task.encrypted_event
data: {"ciphertext":"base64...","key_id":"browser_session_123"}
```

## 12.3 Session Key Expiry

Session key should expire when:

- browser tab closes or session ends
- task completes
- max session TTL reached
- user logs out

Suggested TTL:

```text
1-4 hours
```

## 12.4 M3.5 Recommendation

Treat this as experimental.

Implement Option A first. Implement Option B only if browser crypto hygiene becomes important immediately.

## 13. Data Model Additions

These can live in Hermes/backend app database, not necessarily Musubi core.

## 13.1 app_task_sessions

```sql
create table app_task_sessions (
  id text primary key,
  user_id text not null,
  app_id text not null,
  device_id text not null,
  plugin_name text,
  channel text not null,
  musubi_message_id text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text
);
```

## 13.2 app_task_events

Optional persistence:

```sql
create table app_task_events (
  id text primary key,
  task_session_id text not null references app_task_sessions(id),
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
```

Privacy note:

If app backend persists decrypted events, that is app-level storage, not Musubi server storage. The app must decide retention policy.

For Hermes Companion M3.5, default can be:

```text
Persist minimal status/result summary.
Do not persist full raw event stream unless explicitly enabled.
```

## 14. Security Requirements

## 14.1 Browser Must Not Receive Long-lived Musubi Secrets

Never expose to browser:

```text
MUSUBI_API_KEY
MUSUBI_APP_PRIVATE_KEY
```

Browser receives only:

```text
user session token/cookie
task session id
optional ephemeral session private key
```

## 14.2 Backend User Authorization

Before starting or streaming a task, backend must check:

- user is authenticated
- user can access the selected device in this app context
- selected device/plugin/channel is granted to Hermes app
- task session belongs to this user

## 14.3 Event Authorization

Browser event stream must be scoped to task session and user.

Do not allow:

```text
GET /api/tasks/other_user_task/events
```

## 14.4 Backend Log Hygiene

If backend decrypts events, logs must avoid raw event payload by default.

Log only:

```text
task_session_id
message_id
status
event_type
error_code
```

## 14.5 App-level Retention Policy

Because Option A backend sees plaintext events, app must define retention.

Recommended default:

```text
Do not persist raw task instructions/events by default.
Persist only task status and final summary if user expects history.
```

## 14.6 CSRF and Auth

If using cookie-based browser auth:

- protect POST endpoints with CSRF token or same-site strict cookies
- verify origin
- do not allow anonymous task start/cancel

## 15. UX Requirements

## 15.1 Browser Task UX

Hermes Companion UI should show:

```text
Device selector
Workspace hint
Instruction input
Run button
Streaming progress area
Cancel button
Status badge
Connection/reconnect state
```

## 15.2 Security Copy

Recommended copy near run action:

> Hermes will ask your local Musubi device to run the Hermes plugin. Musubi routes encrypted messages and cannot read task contents. Your local policy can still deny the request.

## 15.3 Reconnect UX

If browser refreshes:

- user can reload task session by ID
- backend can show current known status
- if event stream is still active, reconnect
- if task completed, show final result/summary if retained

## 15.4 Error UX

Show user-friendly errors:

```text
Device is offline.
Hermes is not authorized for this device.
Local policy denied the request.
Hermes plugin is not installed.
Task timed out.
Task was cancelled.
```

Avoid exposing low-level crypto errors unless in debug mode.

## 16. Implementation Slices

## Slice 0: M3.5 Architecture Contract

Deliverables:

- `docs/browser_session_keys_m3_5.md`
- decide Option A default
- define app backend task session model
- define browser event API

Acceptance criteria:

- Team agrees browser will not hold long-lived Musubi credentials.
- App backend bridge architecture is accepted.

## Slice 1: Backend Task Session API

Goal:

Create app-level task session abstraction.

Deliverables:

- `POST /api/tasks`
- `GET /api/tasks/:id`
- app task session table
- user authorization checks

Acceptance criteria:

- Browser can start task through backend.
- Backend creates task session and invokes Musubi SDK.

## Slice 2: Backend Event Bridge

Goal:

Bridge decrypted Musubi events to browser.

Deliverables:

- backend consumes `invocation.events()`
- maps Musubi events to app task events
- publishes to in-memory/event bus
- updates task session status

Acceptance criteria:

- Musubi Hermes task events appear as backend task events.
- Backend does not log raw payloads by default.

## Slice 3: Browser SSE Stream

Goal:

Stream task events to browser.

Deliverables:

- `GET /api/tasks/:id/events` SSE endpoint
- browser event consumer
- reconnect handling
- auth checks

Acceptance criteria:

- Browser sees streaming progress.
- Browser reconnects after refresh or network blip.
- Other users cannot subscribe to task events.

## Slice 4: Browser Task UI

Goal:

Build usable Hermes Companion task UI.

Deliverables:

- device selector
- instruction input
- workspace hint input
- run button
- progress stream
- status badge
- final result view

Acceptance criteria:

- User can run a Hermes task from browser and see live progress.

## Slice 5: Cancel Flow

Goal:

Allow browser to cancel task safely.

Deliverables:

- `POST /api/tasks/:id/cancel`
- backend calls Musubi invocation cancel or explicit cancel channel
- browser cancel button
- cancellation event/status

Acceptance criteria:

- Browser cancel stops or best-effort cancels local task.
- UI shows cancelled state.

## Slice 6: Error Mapping and UX

Goal:

Normalize app-facing errors.

Deliverables:

- map SDK errors to browser-safe errors
- local policy denied UX
- device offline UX
- grant denied UX
- plugin missing UX

Acceptance criteria:

- Common failures show clear user-facing messages.

## Slice 7: Minimal Persistence and Reconnect

Goal:

Support refresh/reconnect behavior.

Deliverables:

- persist task session status
- optionally persist key task events or final summary
- reload task session page
- reconnect event stream

Acceptance criteria:

- User can refresh page and recover task status.

## Slice 8: Optional Experimental Session Key Mode

Goal:

Prototype backend re-encryption to browser session key.

Deliverables:

- browser ephemeral key generation
- backend stores session public key
- backend re-encrypts events
- browser decrypts encrypted SSE events

Acceptance criteria:

- Works in experimental flag mode.
- Long-lived app private key still backend-only.

This slice is optional for M3.5 completion.

## Slice 9: Docs and Example

Goal:

Document safe browser architecture.

Deliverables:

- guide: `Using Musubi from a browser app safely`
- guide: `Why not put MUSUBI_APP_PRIVATE_KEY in the browser`
- example Hermes web integration
- example backend event bridge

Acceptance criteria:

- New developer understands backend bridge model.

## 17. M3.5 Acceptance Criteria

M3.5 is complete when:

1. Hermes Companion Web can start a Musubi-backed task from the browser.
2. Browser does not receive `MUSUBI_API_KEY`.
3. Browser does not receive long-lived `MUSUBI_APP_PRIVATE_KEY`.
4. Hermes backend uses App SDK to invoke Musubi.
5. Hermes backend decrypts device events/results.
6. Browser receives live task events via authenticated SSE or equivalent.
7. Browser can cancel a task.
8. Browser can refresh and recover task status.
9. Common errors are mapped to user-friendly states.
10. Backend logs do not include raw decrypted events by default.
11. Documentation explains the trust boundary.

Optional acceptance:

12. Experimental browser session key mode can re-encrypt events to browser ephemeral key.

## 18. M3.5 Demo Script

```text
1. Open Hermes Companion Web.
2. User is logged in.
3. Select device: Ethan MacBook Pro.
4. Select workspace: ~/projects/demo.
5. Enter task: "Check why tests are failing."
6. Click Run.
7. Browser calls Hermes Backend /api/tasks.
8. Hermes Backend uses Musubi App SDK.
9. Musubi routes encrypted task to local device.
10. Local Hermes plugin runs task.
11. Device returns encrypted events to Musubi.
12. Hermes Backend decrypts events.
13. Browser receives SSE events:
    - Reading project files
    - Running tests
    - Found failing test
    - Final result ready
14. Click Cancel on a second long-running task.
15. Browser shows cancelled.
16. Refresh page and recover task status.
17. Show that browser never had MUSUBI_APP_PRIVATE_KEY.
```

## 19. Key Risks and Mitigations

## 19.1 Risk: Backend Sees Plaintext

Option A means app backend decrypts and sees task results.

Mitigation:

- This is acceptable for first-party app architecture.
- Make it explicit in docs.
- Avoid raw event logging.
- Add optional session re-encryption mode if needed.

## 19.2 Risk: Developers Put Private Key in Browser Anyway

Mitigation:

- SDK docs clearly state backend-only default.
- Browser client package must not accept long-lived `MUSUBI_APP_PRIVATE_KEY` by default.
- Provide safe backend bridge example.

## 19.3 Risk: App Backend Bypasses Musubi Trust UX

Mitigation:

- Backend should still rely on Musubi grants.
- Control plane remains source of truth for app/device/channel authorization.
- Backend should not create hidden direct access paths.

## 19.4 Risk: Event Stream Leaks Across Users

Mitigation:

- Task session ownership check on every stream.
- Use unguessable task session IDs.
- Require user auth.
- Avoid global event channels without authorization filters.

## 19.5 Risk: Too Much Framework-specific Code

Mitigation:

- Keep Musubi SDK framework-agnostic.
- Put Next/Vite/Express examples in examples, not core.

## 20. Post-M3.5 Roadmap

## M4: Third-party App Platform

M3.5 browser model prepares for web-based third-party apps, but M4 must add:

- developer registration
- app permission declarations
- OAuth-style user consent
- third-party trust status
- abuse/reporting
- app review basics

## M4.5: Plugin Registry and Trust

Adds:

- plugin signing
- plugin publisher identity
- official/verified/community labels
- plugin install UX
- workspace plugin allowlist

## M5: Enterprise Controls

Adds:

- SSO
- SCIM
- RBAC
- device groups
- grant approval workflow
- audit export
- admin-enforced policies

## 21. M3.5 Decision Summary

```text
M3.5 Theme:
  Safe browser participation in Musubi app flows.

Default architecture:
  App backend owns long-lived Musubi credentials.
  Browser talks to app backend.
  Backend uses Musubi App SDK.
  Backend streams task events to browser.

Primary target:
  Hermes Companion Web.

Browser must not hold:
  MUSUBI_API_KEY
  MUSUBI_APP_PRIVATE_KEY

Default event transport:
  SSE from app backend to browser.

Optional experimental mode:
  Backend re-encrypts decrypted events to browser ephemeral session key.

Exit demo:
  Browser starts Hermes task, sees live progress, cancels task, reconnects after refresh, without ever receiving long-lived Musubi app secrets.
```

