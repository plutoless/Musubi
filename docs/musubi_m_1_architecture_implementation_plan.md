# Musubi Milestone 1 Architecture and Implementation Plan

## 0. Document Status

Draft for `docs/architecture_m1.md`.

This document defines the architecture, trust boundaries, API contracts, data model, plugin protocol, local policy format, deployment model, and implementation slices for Musubi Milestone 1.

## 1. Milestone 1 Goal

Milestone 1 proves that a first-party AI app can securely invoke an approved local capability on a user-owned machine through Musubi.

The concrete M1 demo:

```text
Hermes Web / App
  ↓ encrypted Musubi message
Musubi Server
  ↓ opaque relay
Musubi CLI on user's machine
  ↓ local policy check
Hermes Plugin
  ↓ local Hermes executor/runtime
Encrypted progress/result returned to app
```

M1 should demonstrate:

1. A user can register a local machine.
2. A first-party app can be created.
3. The app can be granted access to a specific device and channel.
4. The app can send an encrypted message to the device.
5. The server can route the message without reading the payload.
6. The local CLI can decrypt the message.
7. The CLI can dispatch the message to a plugin.
8. The plugin can execute a real Hermes task.
9. The CLI can return encrypted result/status events.
10. Message status and audit records are persisted.

## 2. Non-goals for M1

M1 explicitly does not include:

- Third-party app marketplace
- Public plugin registry
- Remote plugin installation from the cloud
- Generic unrestricted shell execution
- Full remote desktop
- VPN or network-layer tunnel
- Full metadata hiding
- Enterprise SSO
- Team role management
- Production-grade billing
- Full key rotation automation
- Hardware-backed device keys
- WASM plugin sandbox
- P2P or LAN direct mode
- Multi-region relay
- Long-term offline task scheduling by default

M1 should avoid becoming a generic remote machine management product.

The M1 positioning is:

> Musubi turns a user-owned machine into a permissioned Hermes capability endpoint.

## 3. Stack Decisions

## 3.1 CLI

Decision: **Go**

Rationale:

- Easy cross-platform binaries
- Good daemon/service support
- Mature filesystem, process, crypto, and WebSocket libraries
- Fast iteration
- Simple distribution
- Good fit for local host agent work

## 3.2 Server

Decision:

- **Local Node/Bun server for early protocol development**
- **Cloudflare Workers + Durable Objects as the M1 hosted target**

Rationale:

- Local Node/Bun is faster for early protocol iteration and debugging.
- Cloudflare Durable Objects map naturally to `device_id -> DeviceSession`.
- The protocol and API contracts should be the same across local and hosted modes.

Implementation principle:

```text
Keep local server and Cloudflare server behavior compatible.
Do not let local dev create assumptions that break Durable Objects later.
```

## 3.3 Database

Decision: **Neon Postgres for hosted M1; local Postgres for dev**

Rationale:

- Musubi needs a plain relational database for users, apps, devices, grants, messages, and audit events.
- Avoid coupling core relay semantics to database realtime features.
- Keep schema portable.

## 3.4 Object Storage

Decision: **Not required for initial M1 text flow; Cloudflare R2 later for encrypted artifacts**

M1 can start with small encrypted payloads and results inline.

Introduce R2 once payloads/artifacts exceed practical message size limits.

## 3.5 Plugin Protocol

Decision: **JSON-RPC over stdio**

Rationale:

- Simple
- Language-independent
- Works with subprocess isolation
- Easy to debug
- Supports request/response and streaming events

## 3.6 First Plugins

M1 plugins:

1. `echo` — protocol validation plugin
2. `hermes` — first real plugin

M1.5 plugin:

1. `codex` — external coding-agent adapter

## 4. Repository Layout for M1

Recommended minimal M1 repo layout:

```text
musubi/
  docs/
    architecture_m1.md
    specs/
      envelope.md
      encryption.md
      plugin_protocol.md
      local_policy.md
      api_contracts.md

  cli/
    cmd/
      musubi/
        main.go
    internal/
      auth/
      config/
      crypto/
      device/
      relay/
      plugin/
      policy/
      daemon/
      log/
    pkg/
      musubi/

  server/
    local/
      src/
        index.ts
        routes/
        relay/
        db/
        permissions/
      package.json

    workers/
      src/
        index.ts
        routes/
        durable_objects/
          DeviceSession.ts
        db/
        permissions/
      wrangler.toml

  plugins/
    echo/
      musubi.plugin.json
      src/
      README.md

    hermes/
      musubi.plugin.json
      src/
      README.md

  packages/
    protocol/
      src/
        envelope.ts
        websocket.ts
        status.ts
        channels.ts
      schemas/
        message_envelope.schema.json
        plugin_manifest.schema.json
        local_policy.schema.json

    types/
      src/
        app.ts
        device.ts
        grant.ts
        message.ts
        plugin.ts

    crypto/
      src/
        keys.ts
        envelope.ts
        encrypt.ts
        decrypt.ts

  migrations/
    001_init.sql
    002_keys.sql
    003_messages_audit.sql

  examples/
    encrypted_echo/
    hermes_task/

  scripts/
    dev.sh
    release_cli.sh
```

Future split boundaries:

```text
Open-source core:
- cli/
- plugins/
- packages/protocol/
- packages/types/
- docs/specs/

Private or later-open cloud layer:
- server/workers/
- console/
- billing/
- marketplace/
```

## 5. Core Architecture

## 5.1 Logical Architecture

```text
+------------------------+
| First-party App        |
| Hermes Web / Backend   |
+-----------+------------+
            |
            | HTTPS: encrypted message envelope
            v
+----------------------------------------------+
| Musubi API                                   |
|                                              |
| - Auth                                       |
| - App/device/channel permission check        |
| - Message creation                           |
| - Message status                             |
| - Audit metadata                             |
+---------------------+------------------------+
                      |
                      | route by device_id
                      v
+----------------------------------------------+
| DeviceSession                                |
| Local: in-memory relay                       |
| Hosted: Durable Object                       |
|                                              |
| - Owns one device connection                 |
| - Tracks online/offline                      |
| - Delivers opaque encrypted envelopes        |
| - Receives encrypted results/events          |
+---------------------+------------------------+
                      |
                      | WebSocket
                      v
+----------------------------------------------+
| Musubi CLI                                   |
|                                              |
| - Device identity                            |
| - WebSocket connection                       |
| - Payload decryption                         |
| - Local policy                               |
| - Plugin dispatcher                          |
| - Result encryption                          |
+---------------------+------------------------+
                      |
                      | JSON-RPC over stdio
                      v
+----------------------------------------------+
| Plugins                                      |
|                                              |
| - echo                                       |
| - hermes                                     |
+----------------------------------------------+
```

## 5.2 Control Plane vs Relay Plane

M1 has two logical planes.

### Control Plane

Responsible for:

- User/workspace records
- App records
- Device records
- Device public keys
- App public keys
- Grants
- Message records
- Audit events

### Relay Plane

Responsible for:

- Device WebSocket connection
- Online/offline state
- Opaque message delivery
- Ack/result/event routing

M1 may implement both in one server codebase, but the boundary should remain clear.

## 6. Trust Boundaries

## 6.1 App Boundary

The app is the cloud-side caller.

In M1, the primary app is first-party Hermes.

The app:

- Owns an `app_id`
- Has an app key pair
- Encrypts payloads to device public keys
- Decrypts results from device
- Calls Musubi APIs

The app should not be treated as the same thing as a plugin.

## 6.2 Server Boundary

The server can see:

- `workspace_id`
- `app_id`
- `device_id`
- `channel`
- `message_id`
- `message status`
- timestamps
- payload size
- audit metadata

The server cannot see:

- Hermes task instruction
- plugin-specific parameters
- result content
- artifact content
- local file paths, unless explicitly included in visible metadata

The server must not require payload plaintext to authorize or route a message.

## 6.3 Device CLI Boundary

The CLI can:

- Authenticate as a registered device
- Hold the device private key
- Decrypt device-bound payloads
- Verify local policy
- Dispatch to plugins
- Encrypt app-bound results

The CLI should not contain Hermes-specific business logic.

## 6.4 Plugin Boundary

A plugin can:

- Receive decrypted payloads from CLI
- Execute local capability logic
- Emit events/results

A plugin should only receive messages for channels it declares.

The plugin is trusted only within the permissions granted by local policy.

## 6.5 Local Policy Boundary

Local policy is the final execution gate.

Even if the server authorizes the app/device/channel grant, the local CLI may still reject execution.

Core principle:

```text
Cloud policy decides who may ask.
Local policy decides what may run.
```

## 7. Identity and Key Model

## 7.1 Key Types

### Device Key Pair

Generated by CLI during device registration.

```text
device_private_key:
  stored locally only

device_public_key:
  uploaded to server
```

Used for:

- Device connection challenge signing
- App-to-device payload encryption

### App Key Pair

Generated during app creation.

```text
app_private_key:
  kept by app-side runtime or dev environment

app_public_key:
  uploaded to server
```

Used for:

- Device-to-app result encryption

For local/dev convenience, a dev-only mode may allow server-managed app private keys, but production design should not require the Musubi server to hold app private keys.

## 7.2 Key IDs

All keys must have stable IDs.

Example:

```text
devkey_123
appkey_123
```

Every encrypted envelope references:

- recipient key ID
- sender key ID
- crypto version
- algorithm

## 7.3 Key Storage

### CLI M1 Storage

M1 file-based storage:

```text
~/.musubi/config.yaml
~/.musubi/keys/device_<device_id>.key
```

Future storage:

- macOS Keychain
- Windows Credential Manager
- Linux Secret Service
- hardware-backed keys

### Server Storage

Server stores:

- Device public keys
- App public keys
- Key status
- Created/retired/revoked timestamps

Server must not store production device private keys.

Server should not store production app private keys.

## 7.4 Key Status

Key statuses:

```text
active
retired
revoked
```

M1 behavior:

- New messages use active keys.
- Revoked keys cannot be used for new messages.
- Full automatic key rotation can be deferred.
- Data model must support future rotation.

## 8. Encryption Envelope

## 8.1 Server-visible Envelope

Example:

```json
{
  "message_id": "msg_123",
  "workspace_id": "ws_123",
  "app_id": "app_hermes",
  "device_id": "dev_macbook",
  "channel": "hermes.task.create",
  "created_at": "2026-05-06T10:00:00Z",
  "expires_at": "2026-05-06T10:05:00Z",
  "crypto": {
    "version": "m1",
    "alg": "x25519-xsalsa20-poly1305",
    "sender_key_id": "appkey_123",
    "recipient_key_id": "devkey_456"
  },
  "ciphertext": "base64..."
}
```

## 8.2 Device-bound Decrypted Payload

Example:

```json
{
  "type": "hermes.task.create",
  "nonce": "random_32_bytes",
  "body": {
    "instruction": "Check why the test suite is failing.",
    "workspace_hint": "~/projects/demo",
    "stream": true
  }
}
```

## 8.3 App-bound Result Envelope

Example:

```json
{
  "message_id": "msg_result_456",
  "correlation_id": "msg_123",
  "workspace_id": "ws_123",
  "app_id": "app_hermes",
  "device_id": "dev_macbook",
  "channel": "hermes.task.event",
  "created_at": "2026-05-06T10:00:10Z",
  "crypto": {
    "version": "m1",
    "alg": "x25519-xsalsa20-poly1305",
    "sender_key_id": "devkey_456",
    "recipient_key_id": "appkey_123"
  },
  "ciphertext": "base64..."
}
```

## 8.4 App-bound Decrypted Event Payload

Example:

```json
{
  "type": "hermes.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "task_123",
    "status": "running",
    "event_type": "progress",
    "message": "Reading project structure..."
  }
}
```

## 8.5 Replay Protection

Each decrypted payload should include:

- nonce
- created_at or envelope created_at
- expires_at or envelope expires_at
- message_id

CLI should maintain a short-lived recent nonce/message cache to reject duplicate messages.

M1 can implement an in-memory recent message cache and later persist it.

## 9. Data Model

## 9.1 workspaces

```sql
create table workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
```

## 9.2 users

```sql
create table users (
  id text primary key,
  email text unique,
  name text,
  created_at timestamptz not null default now()
);
```

For M1, auth may be simplified, but user/workspace tables should exist.

## 9.3 devices

```sql
create table devices (
  id text primary key,
  workspace_id text not null references workspaces(id),
  owner_user_id text references users(id),
  name text not null,
  platform text,
  cli_version text,
  status text not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

## 9.4 device_keys

```sql
create table device_keys (
  id text primary key,
  device_id text not null references devices(id),
  public_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz
);
```

## 9.5 apps

```sql
create table apps (
  id text primary key,
  workspace_id text not null references workspaces(id),
  name text not null,
  type text not null default 'first_party',
  status text not null default 'active',
  created_by text references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

M1 app types:

```text
first_party
user_owned
```

Third-party app type can be defined later.

## 9.6 app_keys

```sql
create table app_keys (
  id text primary key,
  app_id text not null references apps(id),
  public_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  revoked_at timestamptz
);
```

## 9.7 app_device_channel_grants

```sql
create table app_device_channel_grants (
  id text primary key,
  workspace_id text not null references workspaces(id),
  app_id text not null references apps(id),
  device_id text not null references devices(id),
  allowed_channels text[] not null,
  queueing_allowed boolean not null default false,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

## 9.8 device_plugin_capabilities

```sql
create table device_plugin_capabilities (
  id text primary key,
  workspace_id text not null references workspaces(id),
  device_id text not null references devices(id),
  plugin_name text not null,
  plugin_version text not null,
  channels text[] not null,
  permissions text[] not null,
  manifest jsonb,
  reported_at timestamptz not null default now()
);
```

## 9.9 messages

```sql
create table messages (
  id text primary key,
  workspace_id text not null references workspaces(id),
  app_id text not null references apps(id),
  device_id text not null references devices(id),
  channel text not null,
  status text not null,
  visible_metadata jsonb,
  ciphertext text,
  artifact_ref text,
  ttl_seconds int not null default 300,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  error_code text,
  error_message text
);
```

## 9.10 audit_events

```sql
create table audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  actor_type text not null,
  actor_id text,
  event_type text not null,
  app_id text references apps(id),
  device_id text references devices(id),
  message_id text,
  channel text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Audit metadata must not contain decrypted payloads.

## 10. API Contracts

## 10.1 Register Device

```http
POST /v1/devices/register
```

Request:

```json
{
  "workspace_id": "ws_123",
  "device_name": "Ethan MacBook Pro",
  "platform": "darwin-arm64",
  "cli_version": "0.1.0",
  "public_key": "base64..."
}
```

Response:

```json
{
  "device_id": "dev_123",
  "device_key_id": "devkey_123",
  "relay_url": "wss://api.musubi.dev/v1/devices/dev_123/connect"
}
```

M1 auth may be simplified in local mode, but hosted mode should require user auth.

## 10.2 Connect Device WebSocket

```http
GET /v1/devices/{device_id}/connect
Upgrade: websocket
Authorization: MusubiDeviceSignature ...
```

Device connection should prove possession of device private key.

M1 simple challenge flow:

1. CLI requests a connection nonce or includes signed timestamp.
2. CLI signs canonical connection string.
3. Server verifies signature against active device public key.
4. Server accepts WebSocket.

## 10.3 Report Plugin Capabilities

```http
POST /v1/devices/{device_id}/capabilities
```

Request:

```json
{
  "plugins": [
    {
      "name": "hermes",
      "version": "0.1.0",
      "channels": [
        "hermes.task.create",
        "hermes.task.cancel",
        "hermes.task.status"
      ],
      "permissions": [
        "process.spawn",
        "fs.read.project",
        "fs.write.project",
        "network.outbound"
      ],
      "manifest": {}
    }
  ]
}
```

## 10.4 Create App

```http
POST /v1/apps
```

Request:

```json
{
  "workspace_id": "ws_123",
  "name": "Hermes Web",
  "type": "first_party",
  "public_key": "base64..."
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

## 10.5 Grant App Access to Device Channels

```http
POST /v1/grants
```

Request:

```json
{
  "workspace_id": "ws_123",
  "app_id": "app_123",
  "device_id": "dev_123",
  "allowed_channels": [
    "hermes.task.create",
    "hermes.task.cancel",
    "hermes.task.status"
  ],
  "queueing_allowed": false
}
```

Response:

```json
{
  "grant_id": "grant_123",
  "status": "active"
}
```

## 10.6 Send Message

```http
POST /v1/messages
```

Request:

```json
{
  "workspace_id": "ws_123",
  "app_id": "app_123",
  "device_id": "dev_123",
  "channel": "hermes.task.create",
  "visible_metadata": {
    "trace_id": "trace_123"
  },
  "crypto": {
    "version": "m1",
    "alg": "x25519-xsalsa20-poly1305",
    "sender_key_id": "appkey_123",
    "recipient_key_id": "devkey_456"
  },
  "ciphertext": "base64...",
  "ttl_seconds": 300
}
```

Response:

```json
{
  "message_id": "msg_123",
  "status": "delivered"
}
```

Possible status values:

```text
created
validated
queued
delivered
received
processing
completed
failed
expired
cancel_requested
cancelled
```

## 10.7 Get Message Status

```http
GET /v1/messages/{message_id}
```

Response:

```json
{
  "message_id": "msg_123",
  "status": "processing",
  "created_at": "2026-05-06T10:00:00Z",
  "updated_at": "2026-05-06T10:00:15Z"
}
```

## 10.8 Cancel Message

```http
POST /v1/messages/{message_id}/cancel
```

Response:

```json
{
  "message_id": "msg_123",
  "status": "cancel_requested"
}
```

The server should route a cancel control envelope to the device if the device is online.

## 11. WebSocket Protocol

## 11.1 Device Connect

Once WebSocket is accepted, the server sends:

```json
{
  "type": "server.hello",
  "connection_id": "conn_123",
  "device_id": "dev_123"
}
```

Device replies:

```json
{
  "type": "device.ready",
  "device_id": "dev_123",
  "cli_version": "0.1.0",
  "plugins": [
    {
      "name": "hermes",
      "version": "0.1.0",
      "channels": ["hermes.task.create"]
    }
  ]
}
```

## 11.2 Deliver Message

Server to device:

```json
{
  "type": "message.deliver",
  "message": {
    "message_id": "msg_123",
    "app_id": "app_123",
    "device_id": "dev_123",
    "channel": "hermes.task.create",
    "crypto": {},
    "ciphertext": "base64..."
  }
}
```

Device ack:

```json
{
  "type": "message.ack",
  "message_id": "msg_123",
  "status": "received"
}
```

## 11.3 Processing Event

Device to server:

```json
{
  "type": "message.event",
  "correlation_id": "msg_123",
  "event": {
    "message_id": "msg_evt_456",
    "app_id": "app_123",
    "device_id": "dev_123",
    "channel": "hermes.task.event",
    "crypto": {},
    "ciphertext": "base64..."
  }
}
```

## 11.4 Final Result

Device to server:

```json
{
  "type": "message.result",
  "correlation_id": "msg_123",
  "status": "completed",
  "result": {
    "message_id": "msg_result_789",
    "app_id": "app_123",
    "device_id": "dev_123",
    "channel": "hermes.task.event",
    "crypto": {},
    "ciphertext": "base64..."
  }
}
```

## 11.5 Error

Device to server:

```json
{
  "type": "message.error",
  "message_id": "msg_123",
  "error_code": "LOCAL_POLICY_DENIED",
  "error_message": "Local policy denied channel hermes.task.create"
}
```

Error message must not include decrypted sensitive payload.

## 12. Local Policy Format

M1 local policy format: YAML.

Default policy: deny by default.

Example:

```yaml
version: m1

defaults:
  require_local_confirm: true
  max_task_duration_seconds: 3600

apps:
  app_hermes:
    name: Hermes Web
    plugins:
      hermes:
        allow:
          - hermes.task.create
          - hermes.task.cancel
          - hermes.task.status
        require_local_confirm: false
        max_task_duration_seconds: 14400
        allowed_workspace_dirs:
          - ~/projects
          - ~/workspace

plugins:
  hermes:
    enabled: true
    permissions:
      - process.spawn
      - fs.read.project
      - fs.write.project
      - network.outbound

  echo:
    enabled: true
    permissions: []
```

M1 local policy checks:

1. App is known or allowed.
2. Plugin exists and is enabled.
3. Channel is allowed for that app/plugin.
4. Plugin permissions do not exceed local policy.
5. Request is within max task duration.
6. Optional workspace path hints are within allowed directories.
7. Local confirmation is not required, or user approved.

M1 may implement terminal-based confirmation before desktop notification.

## 13. Plugin Protocol

## 13.1 Plugin Manifest

Example `musubi.plugin.json`:

```json
{
  "name": "hermes",
  "version": "0.1.0",
  "description": "Run Hermes tasks on the local machine",
  "runtime": "nodejs",
  "entry": "node ./dist/index.js",
  "channels": [
    "hermes.task.create",
    "hermes.task.cancel",
    "hermes.task.status"
  ],
  "permissions": [
    "process.spawn",
    "fs.read.project",
    "fs.write.project",
    "network.outbound"
  ],
  "config_schema": {
    "workspace_dir": {
      "type": "string",
      "required": false
    },
    "hermes_endpoint": {
      "type": "string",
      "required": false
    }
  }
}
```

## 13.2 JSON-RPC Methods

### `musubi.plugin.info`

CLI asks plugin for runtime info.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "musubi.plugin.info",
  "params": {}
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "name": "hermes",
    "version": "0.1.0",
    "channels": ["hermes.task.create"]
  }
}
```

### `musubi.message.handle`

CLI sends decrypted payload to plugin.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "musubi.message.handle",
  "params": {
    "message_id": "msg_123",
    "app_id": "app_123",
    "channel": "hermes.task.create",
    "payload": {
      "type": "hermes.task.create",
      "body": {
        "instruction": "Check why tests are failing.",
        "workspace_hint": "~/projects/demo",
        "stream": true
      }
    }
  }
}
```

Response for immediate completion:

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "status": "completed",
    "body": {
      "summary": "Done"
    }
  }
}
```

Response for async/streaming task:

```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "status": "accepted",
    "task_id": "task_123"
  }
}
```

### Streaming plugin event

Plugin writes event to stdout using JSON-RPC notification:

```json
{
  "jsonrpc": "2.0",
  "method": "musubi.message.event",
  "params": {
    "correlation_id": "msg_123",
    "channel": "hermes.task.event",
    "body": {
      "task_id": "task_123",
      "status": "running",
      "event_type": "progress",
      "message": "Reading project files..."
    }
  }
}
```

### `musubi.message.cancel`

CLI asks plugin to cancel a task.

```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "musubi.message.cancel",
  "params": {
    "correlation_id": "msg_123",
    "task_id": "task_123"
  }
}
```

## 14. Hermes Plugin M1 Design

## 14.1 Channels

M1 Hermes channels:

```text
hermes.task.create
hermes.task.cancel
hermes.task.status
hermes.task.event
```

## 14.2 Hermes Task Create Payload

```json
{
  "type": "hermes.task.create",
  "body": {
    "instruction": "Check why tests are failing.",
    "workspace_hint": "~/projects/demo",
    "mode": "agent",
    "stream": true
  }
}
```

## 14.3 Hermes Event Payload

```json
{
  "type": "hermes.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "task_123",
    "status": "running",
    "event_type": "progress",
    "message": "Reading project files..."
  }
}
```

## 14.4 Hermes Result Payload

```json
{
  "type": "hermes.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "task_123",
    "status": "completed",
    "event_type": "result",
    "summary": "The test suite fails because...",
    "artifacts": []
  }
}
```

## 14.5 Hermes Plugin Implementation Options

### Option A: Spawn Hermes CLI/process

```text
Hermes plugin -> spawn hermes process -> stream stdout/stderr -> return events
```

Pros:

- Simple
- Works without requiring Hermes server mode
- Good for M1

Cons:

- Session management can be rough
- Streaming and cancellation require careful process handling

### Option B: Connect to local Hermes API

```text
Hermes plugin -> local Hermes HTTP/stdio API -> task lifecycle
```

Pros:

- Cleaner task lifecycle
- Better streaming/cancel/status semantics

Cons:

- Requires Hermes local API to exist

M1 recommendation:

```text
Start with whichever Hermes integration already exists.
If no stable local API exists, spawn process first.
Keep plugin boundary stable so implementation can change later.
```

## 15. Message Status Semantics

M1 status transitions:

```text
created
  ↓
validated
  ↓
delivered
  ↓
received
  ↓
processing
  ↓
completed | failed | cancelled | expired
```

Status definitions:

- `created`: message record created
- `validated`: app/device/channel grant passed
- `queued`: device offline but queueing is explicitly allowed
- `delivered`: relay sent message to device WebSocket
- `received`: device acknowledged receipt
- `processing`: plugin accepted message
- `completed`: plugin returned final result
- `failed`: execution or delivery failed
- `expired`: TTL elapsed
- `cancel_requested`: cancel message sent/requested
- `cancelled`: plugin confirmed cancellation

M1 should record every status transition in audit events.

## 16. Audit Requirements

M1 audit events:

```text
device.registered
device.connected
device.disconnected
device.capabilities_reported
app.created
grant.created
grant.revoked
message.created
message.validated
message.delivered
message.received
message.processing
message.completed
message.failed
message.cancel_requested
message.cancelled
```

Audit event example:

```json
{
  "event_type": "message.delivered",
  "workspace_id": "ws_123",
  "app_id": "app_123",
  "device_id": "dev_123",
  "message_id": "msg_123",
  "channel": "hermes.task.create",
  "metadata": {
    "duration_ms": 12
  }
}
```

Audit logs must not include decrypted payloads.

## 17. Deployment Model

## 17.1 Local Development

Local dev services:

```text
Postgres
Local Node/Bun server
Musubi CLI
Echo plugin
Hermes plugin
```

Local flow:

```text
pnpm dev:server
musubi device register --server http://localhost:8787
musubi start --server ws://localhost:8787
node examples/encrypted_echo/send.js
```

## 17.2 Hosted M1

Hosted services:

```text
Cloudflare Worker API
Cloudflare Durable Object DeviceSession
Neon Postgres
Optional R2 later
```

Hosted flow:

```text
musubi login
musubi device register
musubi daemon start
Hermes app sends encrypted message through hosted API
```

## 18. Implementation Plan

## Slice 0: Architecture and Protocol Contracts

Goal:

Define contracts before implementation.

Deliverables:

- `docs/architecture_m1.md`
- `docs/specs/envelope.md`
- `docs/specs/encryption.md`
- `docs/specs/plugin_protocol.md`
- `docs/specs/local_policy.md`
- JSON schemas for:
  - message envelope
  - plugin manifest
  - local policy

Acceptance criteria:

- Example envelopes validate against schema.
- Example plugin manifests validate against schema.
- Example local policy validates against schema.

## Slice 1: Local CLI to Echo Plugin

Goal:

Prove plugin loading and JSON-RPC over stdio before server work.

Deliverables:

- CLI can discover plugin manifests.
- CLI can start plugin subprocess.
- CLI can call `musubi.plugin.info`.
- CLI can call `musubi.message.handle`.
- Echo plugin returns response.

Example command:

```bash
musubi plugin run echo --payload examples/encrypted_echo/plain_payload.json
```

Acceptance criteria:

- Echo plugin works locally without server.
- Plugin errors are surfaced cleanly.
- CLI logs show plugin lifecycle.

## Slice 2: Device Identity and Registration

Goal:

Register a local machine with public-key identity.

Deliverables:

- CLI generates device key pair.
- CLI stores device private key locally.
- Server stores device and active device public key.
- Device registration API exists.
- Device config is written locally.

Commands:

```bash
musubi device register --server http://localhost:8787
musubi status
```

Acceptance criteria:

- Device appears in database.
- Device has active public key.
- CLI can show registered device status.

## Slice 3: App Creation and App Key

Goal:

Create first-party app identity for Hermes.

Deliverables:

- Create app API.
- App key table.
- App public key registration.
- Dev helper to generate app key pair.

Example:

```bash
musubi dev app create "Hermes Web"
```

Acceptance criteria:

- App exists in DB.
- App has active public key.
- App private key is available to dev sender script, not required by server.

## Slice 4: Grants and Permission Checks

Goal:

Authorize app to access device channels.

Deliverables:

- Grant API.
- Permission check function.
- Channel allowlist enforcement.

Example grant:

```json
{
  "app_id": "app_hermes",
  "device_id": "dev_macbook",
  "allowed_channels": [
    "hermes.task.create",
    "hermes.task.cancel",
    "hermes.task.status"
  ]
}
```

Acceptance criteria:

- Allowed channel passes.
- Denied channel fails.
- Revoked grant fails.

## Slice 5: WebSocket Relay

Goal:

Connect device CLI to server and deliver opaque envelopes.

Deliverables:

- Device WebSocket connect endpoint.
- Device authentication by signature or signed timestamp.
- Server tracks online status.
- Server can deliver opaque message to connected device.
- Device sends ack.

Acceptance criteria:

- `musubi start` connects device.
- Server marks device online.
- Test endpoint can deliver an opaque envelope.
- CLI receives envelope and sends ack.

## Slice 6: Public-key Encrypted Echo End-to-End

Goal:

Replace static AES demo keys with app/device public-key encryption.

Deliverables:

- App sender encrypts payload to device public key.
- CLI decrypts with device private key.
- CLI invokes echo plugin.
- CLI encrypts result to app public key.
- App sender decrypts result.

Acceptance criteria:

- Server never receives plaintext.
- Echo roundtrip works end to end.
- Message status reaches `completed`.
- Audit records contain no plaintext.

## Slice 7: Persistent Message Status and Audit

Goal:

Make message lifecycle observable and persisted.

Deliverables:

- `messages` table.
- `audit_events` table.
- Status transition helpers.
- Audit helper.
- Message status API.

Acceptance criteria:

- Every message has persisted status.
- Every major transition creates audit event.
- API can fetch message status.
- Audit event metadata excludes plaintext.

## Slice 8: Local Policy Enforcement

Goal:

Prove local machine retains final control.

Deliverables:

- Local policy YAML parser.
- App/plugin/channel allow checks.
- Plugin permission checks.
- Default deny behavior.
- Terminal confirmation for high-risk or untrusted actions.

Acceptance criteria:

- CLI rejects message if local policy denies app/channel.
- CLI rejects message if plugin disabled.
- CLI returns encrypted/local-safe error event.
- Server audit shows local policy denial without plaintext.

## Slice 9: Hermes Plugin Skeleton

Goal:

Build first real plugin surface without depending on full Hermes runtime integration.

Deliverables:

- Hermes plugin manifest.
- `hermes.task.create` handler.
- `hermes.task.cancel` handler stub.
- Streaming `hermes.task.event` notifications.
- Mock or minimal local execution.

Acceptance criteria:

- Cloud app can send encrypted Hermes task.
- Device dispatches to Hermes plugin.
- Plugin emits running/completed events.
- App decrypts events/results.

## Slice 10: Real Hermes Runtime Integration

Goal:

Connect Hermes plugin to real local Hermes executor/runtime.

Deliverables:

- Hermes plugin can start/connect to Hermes runtime.
- Task lifecycle maps to Musubi events.
- Cancellation works if runtime supports it.
- Errors are sanitized.

Acceptance criteria:

- Web/app sends real task.
- Local Hermes executes task.
- Progress events stream back.
- Final result returns encrypted.
- Task can be cancelled or fails gracefully.

## Slice 11: Hosted Cloudflare Deployment

Goal:

Move from local server to hosted M1 relay.

Deliverables:

- Worker API routes.
- Durable Object `DeviceSession`.
- Neon Postgres integration.
- Deployment scripts.
- Environment configuration.

Acceptance criteria:

- Same echo flow works on hosted environment.
- Same Hermes flow works on hosted environment.
- Device reconnect works after network drop.
- Basic logs and error tracking exist.

## 19. M1 Exit Criteria

M1 is complete when:

1. A user can install and run the Go CLI.
2. The CLI can register a device.
3. The CLI can connect to Musubi relay over WebSocket.
4. A first-party Hermes app can be created.
5. The app can be granted access to the device and Hermes channels.
6. The app can encrypt a Hermes task to the device public key.
7. The server can route the message without plaintext.
8. The CLI can decrypt and validate the message.
9. Local policy can allow or deny the request.
10. The Hermes plugin can receive the task.
11. The Hermes plugin can execute or simulate a task.
12. Progress and result events are encrypted back to the app.
13. Message status is persisted.
14. Audit logs are written without plaintext payloads.
15. The same flow works in local dev and hosted Cloudflare deployment.

## 20. M1 Demo Script

Demo flow:

```text
1. Start local or hosted Musubi server.
2. Install Musubi CLI.
3. Run `musubi login` or local dev auth.
4. Run `musubi device register`.
5. Run `musubi plugin install ./plugins/hermes`.
6. Run `musubi start`.
7. Create Hermes app.
8. Grant Hermes app access to device channels.
9. Open Hermes web/dev sender.
10. Send task: "Summarize this project and identify failing tests."
11. Musubi routes encrypted task to local machine.
12. CLI decrypts and checks local policy.
13. Hermes plugin executes local task.
14. Web shows encrypted/decrypted progress events.
15. Final result appears.
16. Audit page shows message lifecycle without payload contents.
```

## 21. Key Risks

## 21.1 Product Risk

Risk:

Musubi may look like a generic remote access tool.

Mitigation:

M1 demo must focus on Hermes local capability invocation, not shell or remote desktop.

## 21.2 Security Risk

Risk:

Prototype shortcuts may accidentally become production assumptions.

Mitigation:

Remove static AES demo keys early. Use app/device public-key encryption in M1.

## 21.3 Scope Risk

Risk:

Hermes plugin integration may pull in too much Hermes-specific complexity.

Mitigation:

Keep Hermes logic inside plugin. Do not add Hermes-specific code to Musubi CLI or relay.

## 21.4 Architecture Risk

Risk:

Local Node server may diverge from Cloudflare Durable Object model.

Mitigation:

Keep `device_id -> DeviceSession` as the mental model from day one.

## 21.5 Trust Risk

Risk:

Users may not trust a closed local daemon.

Mitigation:

Open-source CLI, plugin protocol, local policy spec, and encryption envelope spec.

## 22. Post-M1 Roadmap

## M1.5: Codex Plugin

Goal:

Prove Musubi can support an external coding-agent adapter without changing core CLI or relay.

Detailed plan:

- `docs/musubi_m_1_5_codex_plugin_plan.md`

Channels:

```text
codex.task.create
codex.task.cancel
codex.task.status
codex.task.event
```

## M2: MCP Plugin

Goal:

Show that Musubi can securely bridge cloud AI apps to local MCP servers.

Channels:

```text
mcp.tool.list
mcp.tool.call
mcp.resource.read
```

## M2.5: Artifact Transport

Goal:

Support encrypted larg
