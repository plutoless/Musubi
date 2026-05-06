# Browser Session Keys and Backend Event Bridge

M3.5 defines the safe browser architecture for Musubi-backed web apps.

The default model is an app backend event bridge:

```text
Browser UI -> app backend -> Musubi relay -> local device -> plugin
                         <- encrypted events/results <-
Browser UI <- authenticated SSE stream <- app backend decrypts with app key
```

The browser never receives long-lived Musubi credentials:

- no `MUSUBI_API_KEY`
- no long-lived `MUSUBI_APP_PRIVATE_KEY`
- no device private keys

The app backend owns those credentials, uses `@musubi/app-sdk`, decrypts device events/results, maps them to browser-safe task events, and streams them to the browser over the app's authenticated session.

## Reference Implementation

The reference implementation is `apps/hermes-companion`.

It provides:

- `GET /api/devices`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/events`
- `POST /api/tasks/:id/cancel`
- static Hermes Companion browser UI

Task sessions use app-level IDs such as `ats_...`; browser APIs do not expose Musubi message IDs.

## Event Transport

M3.5 uses SSE as the default browser event transport. Task events are one-way from backend to browser, while cancellation remains a normal HTTP `POST`.

SSE event names:

- `task.status`
- `task.progress`
- `task.result`
- `task.error`

The reference app supports reconnect by replaying in-memory task events with `?after=<event_id>`.

## Security Requirements

- Authenticate every task start, task read, event stream, and cancel request.
- Scope every task session to the authenticated user.
- Map low-level SDK errors to browser-safe messages.
- Do not log raw decrypted task events by default.
- Do not persist raw event streams by default; keep only task status and optional final summary.

## Optional Session Key Mode

Option B from the plan remains experimental: the browser can generate an ephemeral session key, the backend can re-encrypt decrypted Musubi events to that key, and the browser can decrypt SSE payloads locally.

This is not required for M3.5 completion because the backend still sees plaintext while bridging. The required security boundary is that long-lived Musubi app credentials stay backend-only.
