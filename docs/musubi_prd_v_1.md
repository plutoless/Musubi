# Musubi PRD v1

## 1. Product Name

**Musubi / 結び**

Musubi means “connection,” “knot,” or “binding” in Japanese.

In this product, Musubi represents a secure, user-controlled binding between cloud apps and user-owned local machines.

## 2. One-line Positioning

**Musubi is a secure app-to-device messaging layer for invoking local capabilities on user-owned machines.**

Alternative positioning:

> Securely bind apps to your local machines.

> Server-blind messaging for local capabilities.

> A local host gateway for encrypted remote tasks.

## 3. Background

Many modern AI and developer workflows need access to capabilities that exist on a user’s own machine:

- Local coding agents
- Local repositories
- Local shell environment
- Local MCP servers
- Local browser sessions
- Local files and artifacts
- Local desktop automation
- Personal or company development machines

Today, each product tends to solve this separately by building its own device registration, tunnel, WebSocket relay, daemon, authentication, permission, and plugin logic.

This creates duplicated engineering work and unclear security boundaries.

Musubi provides a common foundation:

1. A user installs a universal CLI on their machine.
2. The CLI registers the machine as a trusted local host.
3. Cloud apps can send encrypted messages to authorized devices.
4. The local CLI dispatches messages to plugins.
5. Plugins execute local capabilities.
6. Results are encrypted and returned.
7. The server only handles identity, authorization, routing, status, and audit metadata.
8. The server does not interpret business payloads.

## 4. Problem Statement

Developers and AI products need a safe way to invoke local capabilities, but existing options are either too low-level or too broad.

### 4.1 Existing approaches

#### VPN / mesh networking

Tools such as Tailscale solve device connectivity well, but they operate at the network layer. They do not provide app-level authorization, plugin-level permissions, encrypted task envelopes, or local capability dispatch.

#### Tunnel services

Tools such as Cloudflare Tunnel expose local services safely, but they are still primarily about forwarding network traffic. They do not define a generic app-to-device task protocol.

#### Remote desktop

Remote desktop tools allow full control of a machine, but Musubi is not trying to expose a screen or mouse. Musubi is designed for structured, permissioned, plugin-mediated local capability invocation.

#### App-specific daemons

Some products create their own local daemon for one use case, such as AI coding or remote shell. These are useful, but not reusable across apps and plugins.

### 4.2 Core problem

There is no simple, general-purpose, secure, plugin-based layer for cloud apps to communicate with user-owned local machines while keeping payloads opaque to the server.

## 5. Product Goals

### 5.1 Primary goals

Musubi should allow users and apps to:

1. Register a local machine through a universal CLI.
2. See registered devices in a cloud control plane.
3. Authorize specific apps to access specific devices.
4. Authorize specific apps to call specific local plugins or channels.
5. Send encrypted messages from apps to devices.
6. Dispatch messages to local plugins.
7. Return encrypted results or streaming events.
8. Revoke access at any time.
9. Maintain a server-blind payload model.

### 5.2 Secondary goals

Musubi should also support:

- Local policy files
- Local confirmation for high-risk actions
- Plugin permissions
- Message status tracking
- Task cancellation
- Audit logs without payload leakage
- Encrypted artifact transfer
- Smooth expansion from personal use to team use

## 6. Non-goals

Musubi v1 is not:

- A VPN
- A full remote desktop product
- A generic SSH replacement
- A remote monitoring and management platform
- A mobile device management system
- A cloud agent runtime
- A service that executes user payloads on the server
- A system where the server reads task contents
- A default arbitrary shell execution platform

Musubi should not be positioned as “remote control your machine.”

The better framing is:

> Invoke approved local capabilities on your own machines through encrypted app-to-device messages.

## 7. Target Users

### 7.1 Individual developer

A developer wants to connect their own Mac, Linux server, or workstation to a cloud app so that the app can invoke local tools such as Codex, Claude Code, Git, MCP servers, or project-specific scripts.

### 7.2 AI app developer

An AI product wants to safely send tasks to a user’s local machine without building a custom daemon and relay infrastructure.

### 7.3 Team workspace admin

A team wants to register shared development machines, control which apps can access them, and audit high-level events without exposing sensitive task content.

### 7.4 Plugin developer

A developer wants to expose a local capability through a Musubi plugin.

## 8. Core Product Concepts

## 8.1 Workspace

A workspace is the top-level organizational boundary.

It contains:

- Users
- Apps
- Devices
- Device grants
- Plugin policies
- Audit logs
- Billing and usage

## 8.2 App

An app is a cloud-side identity that sends messages to devices.

Examples:

- Hermes
- Remote Coding UI
- Browser Agent
- Internal DevOps tool
- Personal automation app

Each app has:

- `app_id`
- Name
- Workspace
- Public key
- Secret or token credentials
- Authorized devices
- Authorized channels
- Status

An app cannot send messages to a device unless explicitly granted.

## 8.3 Device

A device is a registered user-owned machine running the Musubi CLI.

Each device has:

- `device_id`
- Name
- Owner
- Workspace
- Platform
- CLI version
- Device public key
- Online status
- Last seen timestamp
- Installed plugin capabilities
- Local policy state

## 8.4 CLI

The Musubi CLI is the local host agent.

It is responsible for:

- User login
- Device registration
- Device key generation
- WebSocket connection to relay
- Receiving encrypted messages
- Decrypting payloads locally
- Dispatching messages to plugins
- Enforcing local policy
- Returning encrypted results
- Managing plugins
- Running as a daemon

The CLI is universal. It should not contain product-specific business logic.

## 8.5 Plugin

A plugin is a local capability handler.

Examples:

- `echo`
- `codex`
- `hermes`
- `mcp`
- `shell-safe`
- `browser`
- `file-artifact`

Each plugin declares:

- Name
- Version
- Channels
- Runtime
- Entry point
- Required permissions
- Config schema
- Trust level

## 8.6 Channel

A channel is a logical message route to a plugin capability.

Examples:

- `echo.ping`
- `codex.task.create`
- `codex.task.cancel`
- `codex.task.status`
- `mcp.tool.call`
- `hermes.task.create`
- `shell-safe.command.run`

Channels are used by the server for authorization and routing, but channel-specific payload content remains encrypted.

## 8.7 Message

A message is the smallest app-to-device communication unit.

A message has two layers:

### Server-visible envelope

The server can see only routing and authorization metadata.

Example:

```json
{
  "message_id": "msg_123",
  "workspace_id": "ws_123",
  "app_id": "app_123",
  "device_id": "dev_123",
  "channel": "codex.task.create",
  "metadata": {
    "trace_id": "trace_123",
    "ttl_seconds": 300,
    "created_at": "2026-05-06T10:00:00Z"
  },
  "encryption": {
    "alg": "x25519-xsalsa20-poly1305",
    "key_id": "device_key_123"
  },
  "ciphertext": "base64..."
}
```

### End-to-end encrypted payload

Only the sending app and receiving device can read this.

Example:

```json
{
  "type": "task.create",
  "body": {
    "prompt": "Check why tests are failing",
    "repo_path": "~/workspace/demo"
  }
}
```

## 9. Design Principles

## 9.1 Server can route, but cannot read

The server should be able to answer:

- Which app sent the message?
- Which device should receive it?
- Which channel is being requested?
- Is the app authorized?
- Was the message delivered?
- Did the task complete, fail, or expire?

The server should not know:

- Prompt content
- Shell command content
- File path content, unless explicitly placed in visible metadata
- Task result content
- Artifact content
- Plugin-specific business parameters

## 9.2 Cloud policy decides who may ask

The server controls cloud-side authorization:

- Which app can access which device
- Which app can send to which channel
- Whether the app is active
- Whether the device is revoked
- Whether the workspace policy permits this action

## 9.3 Local policy decides what may run

The local CLI controls the final execution decision:

- Which plugins are installed
- Which plugins are enabled
- Which local permissions are granted
- Whether local confirmation is required
- Which directories are accessible
- Which commands are allowed
- Whether the request should be rejected

## 9.4 Plugins are capabilities, not arbitrary remote execution

Musubi should encourage safe, structured plugin capabilities rather than default unrestricted shell execution.

A high-level plugin such as `codex.task.create` is safer and clearer than an unrestricted `shell.run` channel.

## 9.5 Easy first run, strict security defaults

The first-run experience should be simple, but the security posture should be conservative.

Default rules:

- No app can access a device without grant.
- No app can invoke a channel without grant.
- No plugin can use dangerous local permissions without user approval.
- High-risk plugins require local confirmation by default.
- Offline queued execution is opt-in.

## 10. MVP Scope

## 10.1 MVP name

**Musubi Personal Host Gateway**

## 10.2 MVP objective

Allow a user to register one or more personal machines, install one or more local plugins, and let an authorized app send encrypted tasks to those plugins through a server-blind relay.

## 10.3 MVP user journey

1. User installs Musubi CLI.
2. User logs in.
3. User registers current machine.
4. User starts Musubi daemon.
5. User installs a plugin.
6. Cloud console shows device online.
7. User creates or selects an app.
8. User grants the app access to the device and plugin channel.
9. App sends encrypted message.
10. Device receives and decrypts the message.
11. CLI dispatches to plugin.
12. Plugin executes.
13. CLI returns encrypted result.
14. App receives result.
15. User can revoke access.

## 10.4 MVP included features

### CLI

- Install CLI
- Login
- Register device
- Start foreground process
- Install daemon
- Start daemon
- Stop daemon
- Show status
- Generate device key pair
- Connect to relay through WebSocket
- Receive encrypted messages
- Dispatch messages to plugin
- Send encrypted results
- Basic plugin management
- Basic local policy file

### Server

- Workspace model
- User auth
- App creation
- Device registration
- Device status
- App-device grant
- Channel-level grant
- WebSocket relay
- Message create API
- Message status API
- Cancel API
- Audit events
- Payload-blind storage

### Console

- Installation instructions
- Device list
- Device detail
- App list
- App detail
- Grant management
- Message/event timeline
- Revoke device
- Revoke app access

### Plugins

MVP should include:

1. `echo` plugin
2. `codex` or `hermes` plugin

The `echo` plugin validates the full message path.

The `codex` or `hermes` plugin validates the real target use case: remote task invocation on a local machine.

## 10.5 MVP excluded features

- Third-party plugin marketplace
- Remote plugin installation from server
- Enterprise SSO
- Organization-level SCIM
- WASM sandbox
- P2P mode
- Full encrypted metadata
- Remote desktop
- Screen sharing
- Arbitrary shell by default
- Cross-device task scheduling
- Multi-region relay control plane

## 11. Recommended Technical Architecture

## 11.1 Architecture summary

Musubi should use a Cloudflare-first architecture for simplicity and scalable WebSocket handling.

Recommended MVP stack:

- Cloudflare Workers for HTTP APIs
- Cloudflare Durable Objects for per-device WebSocket sessions
- Supabase Postgres or Neon Postgres for business metadata
- Cloudflare R2 for encrypted large payloads and artifacts
- Cloudflare Queues later for async/offline delivery
- Go or Rust for CLI
- JSON-RPC over stdio for plugin protocol
- libsodium or age-style public key encryption for payload encryption

## 11.2 Logical architecture

```text
+---------------------+
| Web Console / App   |
+----------+----------+
           |
           | HTTPS
           v
+--------------------------------------------------+
| Cloudflare Worker API                            |
|                                                  |
| - Auth middleware                                |
| - Workspace / app / device APIs                  |
| - Permission checks                              |
| - Message API                                    |
| - Audit API                                      |
+---------------------+----------------------------+
                      |
                      | Durable Object stub
                      v
+--------------------------------------------------+
| Durable Object: DeviceSession(device_id)         |
|                                                  |
| - Holds device WebSocket                         |
| - Tracks online/offline                          |
| - Routes encrypted envelopes                     |
| - Handles ack / timeout                          |
| - Does not decrypt payload                       |
+---------------------+----------------------------+
                      |
                      | WebSocket
                      v
+--------------------------------------------------+
| Musubi CLI                                       |
|                                                  |
| - Device identity                                |
| - E2E decrypt                                    |
| - Local policy                                   |
| - Plugin dispatch                                |
+---------------------+----------------------------+
                      |
                      | JSON-RPC over stdio
                      v
+--------------------------------------------------+
| Plugins                                          |
|                                                  |
| - echo                                           |
| - codex                                          |
| - hermes                                         |
| - mcp                                            |
| - shell-safe                                     |
+--------------------------------------------------+
```

## 11.3 One device, one Durable Object

Each registered device maps to a single Durable Object instance:

```text
device_id -> DeviceSession Durable Object
```

The Durable Object handles the live WebSocket connection for that device.

This avoids building and operating a custom WebSocket gateway cluster with sticky sessions, Redis pub/sub, gateway discovery, and manual socket routing.

## 11.4 Message flow

### App to device

```text
App
  ↓
POST /v1/messages
  ↓
Worker validates app auth
  ↓
Worker checks app -> device -> channel grant
  ↓
Worker writes message metadata
  ↓
Worker routes envelope to DeviceSession(device_id)
  ↓
DeviceSession forwards ciphertext to CLI
  ↓
CLI decrypts payload
  ↓
CLI dispatches to plugin
  ↓
Plugin executes
  ↓
CLI encrypts result
  ↓
DeviceSession receives result
  ↓
Worker updates message status
  ↓
App receives result or fetches status
```

### Device connection

```text
CLI start
  ↓
Load device private key
  ↓
Open WebSocket to /v1/devices/{device_id}/connect
  ↓
Worker verifies device signature
  ↓
Worker routes to DeviceSession(device_id)
  ↓
DeviceSession accepts WebSocket
  ↓
Device status becomes online
```

## 12. Authentication and Identity

## 12.1 User login

MVP should support browser-based login from CLI:

```bash
musubi login
```

Recommended flow:

1. CLI opens browser.
2. User logs in.
3. Server returns an authorization code.
4. CLI exchanges code for local credentials.
5. CLI stores credentials securely.

## 12.2 Device identity

Each device should generate a key pair during registration.

```bash
musubi device register
```

Registration flow:

1. CLI generates device key pair.
2. CLI sends device public key to server.
3. Server creates device record.
4. Server returns device ID and relay endpoint.
5. CLI stores private key locally.
6. Future device connections require signing a challenge.

The server should not rely only on long-lived bearer tokens for device authentication.

## 12.3 App identity

Each app has:

- `app_id`
- App secret or token
- Public key
- Allowed devices
- Allowed channels

App tokens are used to authenticate API calls.

App public keys are used for encrypting responses from devices.

## 13. Authorization Model

Musubi has two layers of authorization.

## 13.1 Cloud authorization

Cloud-side authorization answers:

> Is this app allowed to ask this device to use this channel?

Cloud policy checks:

- App is active
- Device is active
- App and device belong to same workspace
- App has grant for device
- App has grant for channel
- Workspace policy allows channel
- Rate limits are not exceeded

## 13.2 Local authorization

Local-side authorization answers:

> Even if the cloud allowed the request, should this machine actually run it?

Local policy checks:

- Plugin is installed
- Plugin is enabled
- Plugin supports the requested channel
- Plugin has required local permissions
- App is locally trusted
- Request does not violate local policy
- Local confirmation is not required, or user approved it

## 14. Local Policy

Musubi should support a local policy file.

Example:

```yaml
apps:
  app_hermes:
    plugins:
      codex:
        allow:
          - codex.task.create
          - codex.task.cancel
          - codex.task.status
        require_local_confirm: false
        max_task_duration_seconds: 3600
        allowed_workspace_dirs:
          - ~/projects

plugins:
  shell-safe:
    require_local_confirm: true
    allowed_commands:
      - git
      - npm
      - python
      - ls
      - pwd
    blocked_commands:
      - sudo
      - rm
      - curl
      - ssh
```

## 15. Plugin System

## 15.1 Plugin protocol

MVP should use:

```text
JSON-RPC over stdio
```

Reasons:

- Simple
- Language independent
- Easy to debug
- Works with subprocess isolation
- Good enough for request, response, and streaming events

## 15.2 Plugin manifest

Each plugin must include a manifest.

Example:

```json
{
  "name": "codex",
  "version": "0.1.0",
  "description": "Run Codex tasks on the local machine",
  "runtime": "nodejs",
  "entry": "node ./dist/index.js",
  "channels": [
    "codex.task.create",
    "codex.task.cancel",
    "codex.task.status"
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
      "required": true
    }
  }
}
```

## 15.3 Plugin permissions

Suggested permission categories:

### Low risk

- `system.notification`
- `plugin.config.read`
- `status.report`

### Medium risk

- `fs.read.project`
- `fs.write.project`
- `network.outbound`
- `process.spawn.approved`

### High risk

- `fs.read.any`
- `fs.write.any`
- `process.spawn.any`
- `screen.capture`
- `clipboard.read`
- `secret.read`
- `browser.control`

High-risk permissions should require explicit local approval.

## 15.4 Plugin lifecycle

MVP commands:

```bash
musubi plugin list
musubi plugin install ./plugins/codex
musubi plugin remove codex
musubi plugin config codex
musubi plugin enable codex
musubi plugin disable codex
```

MVP should support local path installation first.

Remote plugin registry should be P1.

## 16. CLI Command Design

## 16.1 Install

```bash
curl -fsSL https://musubi.dev/install.sh | sh
```

or:

```bash
brew install musubi
```

## 16.2 Login

```bash
musubi login
```

## 16.3 Register device

```bash
musubi device register
```

Expected output:

```text
Register this machine?

Device name: Ethan MacBook Pro
Platform: macOS arm64
Workspace: Personal

Confirm? [Y/n]
```

## 16.4 Start

```bash
musubi start
```

## 16.5 Daemon

```bash
musubi daemon install
musubi daemon start
musubi daemon stop
musubi daemon status
```

## 16.6 Status

```bash
musubi status
```

Expected output:

```text
Device: Ethan MacBook Pro
Status: online
Workspace: Personal
Relay: connected
CLI version: 0.1.0

Plugins:
- echo 0.1.0
- codex 0.1.0
```

## 16.7 App authorization

```bash
musubi app list
musubi app authorize app_123 --plugin codex
musubi app revoke app_123
```

## 16.8 Policy

```bash
musubi policy show
musubi policy edit
musubi policy validate
```

## 17. Console Requirements

## 17.1 Home

Home should show:

- Quick install command
- Connected devices
- Online devices
- Recent events
- Security warnings
- Create app shortcut

## 17.2 Devices page

Device list columns:

- Device name
- Status
- Platform
- Owner
- Plugins
- Last seen
- Actions

Device detail sections:

- Overview
- Connection status
- Installed plugins
- Authorized apps
- Local policy summary
- Recent audit events
- Revoke device

## 17.3 Apps page

App list columns:

- App name
- App ID
- Authorized devices
- Allowed channels
- Status
- Created at

App detail sections:

- App credentials
- Public key
- Authorized devices
- Allowed channels
- Message usage
- Recent audit events
- Revoke app

## 17.4 Grants page

Users should be able to configure:

- App can access device
- App can access plugin
- App can send channel
- Whether local confirmation is recommended
- Whether offline queueing is allowed

## 18. Message Semantics

## 18.1 Message types

Musubi should support:

- Request/response
- Fire-and-forget
- Streaming events
- Cancel request
- Status update

## 18.2 Message states

Suggested states:

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

## 18.3 Offline behavior

Default behavior:

```text
If device offline, fail fast.
```

Optional behavior:

```text
If message is marked queueable and TTL is valid, queue until device reconnects.
```

Queued remote execution must be opt-in.

## 18.4 Large payloads and artifacts

Small payloads can be sent directly as ciphertext.

Large payloads should use R2:

1. App encrypts payload locally.
2. App uploads encrypted blob to R2 through signed URL.
3. Message envelope includes encrypted artifact reference.
4. Device downloads blob.
5. Device decrypts locally.
6. Device uploads encrypted result artifact if needed.

Server should not see artifact contents.

## 19. Encryption Requirements

## 19.1 MVP encryption model

MVP should use public-key encryption between app and device.

Device registration:

- Device generates key pair.
- Device public key is stored on server.
- Device private key remains local.

App creation:

- App has key pair.
- App public key is stored on server or associated with app identity.
- App private key remains with app owner or app runtime.

App sends message:

- App fetches device public key.
- App encrypts payload for device.
- Server routes ciphertext.
- Device decrypts locally.

Device returns result:

- Device encrypts result for app public key.
- Server routes ciphertext.
- App decrypts result.

## 19.2 Server-visible fields

Server may see:

- workspace_id
- app_id
- device_id
- channel
- message_id
- TTL
- message size
- status
- timestamps

## 19.3 Server-hidden fields

Server should not see:

- Prompt
- Command
- File content
- Task parameters
- Plugin-specific payload
- Result content
- Artifact content

## 19.4 Future encryption improvements

P1/P2 may include:

- Per-session ephemeral keys
- Key rotation
- Forward secrecy
- Encrypted business metadata
- Hardware-backed device keys
- Local keychain integration

## 20. Audit Requirements

## 20.1 Audit events

Server should record:

- Device registered
- Device connected
- Device disconnected
- App created
- App revoked
- Grant created
- Grant revoked
- Message created
- Message delivered
- Message completed
- Message failed
- Plugin capability reported

## 20.2 Audit event example

```json
{
  "event": "message.delivered",
  "workspace_id": "ws_123",
  "app_id": "app_123",
  "device_id": "dev_123",
  "channel": "codex.task.create",
  "message_id": "msg_123",
  "created_at": "2026-05-06T10:00:00Z"
}
```

## 20.3 Audit privacy

Audit logs should not include decrypted payloads.

By default, audit logs should also avoid storing user-provided business metadata unless explicitly marked as server-visible.

## 21. Data Model Draft

## 21.1 devices

```sql
create table devices (
  id text primary key,
  workspace_id text not null,
  owner_user_id text not null,
  name text not null,
  platform text,
  public_key text not null,
  status text not null default 'offline',
  last_seen_at timestamptz,
  cli_version text,
  created_at timestamptz default now(),
  revoked_at timestamptz
);
```

## 21.2 apps

```sql
create table apps (
  id text primary key,
  workspace_id text not null,
  name text not null,
  public_key text not null,
  status text not null default 'active',
  created_by text not null,
  created_at timestamptz default now(),
  revoked_at timestamptz
);
```

## 21.3 app_device_grants

```sql
create table app_device_grants (
  id text primary key,
  workspace_id text not null,
  app_id text not null,
  device_id text not null,
  allowed_channels text[] not null,
  queueing_allowed boolean not null default false,
  created_by text not null,
  created_at timestamptz default now(),
  revoked_at timestamptz
);
```

## 21.4 device_plugin_capabilities

```sql
create table device_plugin_capabilities (
  id text primary key,
  workspace_id text not null,
  device_id text not null,
  plugin_name text not null,
  plugin_version text not null,
  channels text[] not null,
  permissions text[] not null,
  reported_at timestamptz default now()
);
```

## 21.5 messages

```sql
create table messages (
  id text primary key,
  workspace_id text not null,
  app_id text not null,
  device_id text not null,
  channel text not null,
  status text not null,
  visible_metadata jsonb,
  ciphertext text,
  artifact_ref text,
  ttl_seconds int default 300,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz
);
```

## 21.6 audit_events

```sql
create table audit_events (
  id text primary key,
  workspace_id text not null,
  actor_type text not null,
  actor_id text,
  event_type text not null,
  app_id text,
  device_id text,
  message_id text,
  channel text,
  metadata jsonb,
  created_at timestamptz default now()
);
```

## 22. API Draft

## 22.1 Register device

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
  "relay_url": "wss://relay.musubi.dev/v1/devices/dev_123/connect"
}
```

## 22.2 Connect device WebSocket

```http
GET /v1/devices/{device_id}/connect
Upgrade: websocket
Authorization: DeviceSignature ...
```

## 22.3 Report plugin capabilities

```http
POST /v1/devices/{device_id}/capabilities
```

Request:

```json
{
  "plugins": [
    {
      "name": "codex",
      "version": "0.1.0",
      "channels": [
        "codex.task.create",
        "codex.task.cancel",
        "codex.task.status"
      ],
      "permissions": [
        "process.spawn",
        "fs.read.project",
        "fs.write.project"
      ]
    }
  ]
}
```

## 22.4 Create app

```http
POST /v1/apps
```

Request:

```json
{
  "name": "Hermes",
  "public_key": "base64..."
}
```

## 22.5 Grant app access to device

```http
POST /v1/grants
```

Request:

```json
{
  "app_id": "app_123",
  "device_id": "dev_123",
  "allowed_channels": [
    "codex.task.create",
    "codex.task.cancel",
    "codex.task.status"
  ],
  "queueing_allowed": false
}
```

## 22.6 Send message

```http
POST /v1/messages
```

Request:

```json
{
  "app_id": "app_123",
  "device_id": "dev_123",
  "channel": "codex.task.create",
  "visible_metadata": {
    "trace_id": "trace_123",
    "ttl_seconds": 300
  },
  "ciphertext": "base64..."
}
```

Response:

```json
{
  "message_id": "msg_123",
  "status": "delivered"
}
```

## 22.7 Get message status

```http
GET /v1/messages/{message_id}
```

Response:

```json
{
  "message_id": "msg_123",
  "status": "processing",
  "created_at": "...",
  "updated_at": "..."
}
```

## 22.8 Cancel message

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

## 23. Security Risks and Mitigations

## 23.1 Risk: App credential leak

If an app credential leaks, an attacker may attempt to send messages to devices.

Mitigations:

- App-device-channel grants
- Short-lived app tokens
- Token rotation
- App revocation
- Local policy enforcement
- Local confirmation for high-risk actions

## 23.2 Risk: Device credential leak

If a device credential leaks, an attacker may impersonate a device.

Mitigations:

- Device key pair instead of static bearer-only auth
- Challenge-response device authentication
- Device revocation
- Keychain storage
- Optional hardware-backed keys

## 23.3 Risk: Server compromise

If the server is compromised, attackers may attempt to inspect or inject messages.

Mitigations:

- Payloads are encrypted end-to-end
- Device verifies app identity
- Local policy remains final gate
- Message nonce and expiry
- Audit anomaly detection

## 23.4 Risk: Plugin supply chain

A malicious plugin could abuse local permissions.

Mitigations:

- Local plugin install first for MVP
- Explicit permission manifest
- Plugin signing in P1
- Workspace plugin allowlist in P1
- High-risk permission warnings
- Sandboxing in P2

## 23.5 Risk: Replay attack

An attacker could replay a previously valid message.

Mitigations:

- Message ID
- Nonce
- Expiry
- Device-side recent nonce cache
- Idempotency keys

## 24. Success Metrics

## 24.1 Activation metrics

- CLI installs
- Successful logins
- Devices registered
- Devices online
- Plugins installed
- First successful encrypted message
- First successful plugin execution

## 24.2 Usage metrics

- Messages sent
- Messages delivered
- Plugin executions
- Task completion rate
- Average delivery latency
- Average execution latency
- Device online duration

## 24.3 Reliability metrics

- WebSocket reconnect rate
- Message delivery failure rate
- Message timeout rate
- Plugin failure rate
- Durable Object error rate
- API error rate

## 24.4 Security metrics

- Revoked devices
- Revoked apps
- Denied policy checks
- Local confirmation prompts
- Local confirmation denials
- Expired/replayed message attempts

## 25. Product Milestones

## 25.1 Milestone 0: Prototype

Goal: prove app-to-device encrypted message relay.

Scope:

- Hardcoded user/device/app
- CLI connects via WebSocket
- Server sends opaque message
- CLI decrypts message
- Echo plugin returns encrypted result

## 25.2 Milestone 1: MVP

Goal: usable personal host gateway.

Scope:

- User login
- Device registration
- Device list
- App creation
- App-device-channel grant
- WebSocket relay
- Echo plugin
- Codex or Hermes plugin
- Message status
- Basic audit
- Basic local policy

## 25.3 Milestone 2: Private beta

Goal: support real users and multiple devices.

Scope:

- Daemon install
- Reconnect robustness
- Plugin config UX
- R2 encrypted artifacts
- Streaming events
- Cancel tasks
- Better console
- Basic rate limits
- Observability

## 25.4 Milestone 3: Team beta

Goal: support team workspaces.

Scope:

- Workspace roles
- Shared devices
- Plugin allowlist
- App token rotation
- Stronger audit
- Queued messages with explicit TTL
- Local approval UX

## 26. Open Questions

1. Is the first real plugin `codex`, `hermes`, or `mcp`?
2. Should Musubi support third-party apps in v1, or only first-party apps?
3. Should app private keys live in browser, backend, or developer environment?
4. How much metadata should be server-visible in MVP?
5. Should message results be pushed through callback, WebSocket to app, polling, or all three?
6. Should local confirmation be terminal-based first, desktop notification first, or both?
7. Should plugins be installed manually only in MVP?
8. Should queued offline tasks be supported at all in MVP?
9. Should the CLI be written in Go or Rust?
10. What is the first “wow moment” demo?

## 27. Recommended First Demo

The first demo should not be a generic remote control demo.

Recommended demo:

```text
1. Install Musubi CLI on a Mac.
2. Register the Mac as a local host.
3. Install the Codex or Hermes plugin.
4. Open Musubi Console.
5. See the Mac online.
6. Create a task in the web UI.
7. Task is encrypted and routed to the Mac.
8. Local plugin runs the task.
9. Streaming progress appears in the web UI.
10. Result is returned encrypted.
```

This demonstrates the core promise:

> A cloud app can safely invoke an approved local capability without the server reading the task content.

## 28. Product Narrative

Musubi is not another tunnel or remote desktop tool.

It is a secure binding layer between apps and user-owned machines.

A user keeps their private environment local. Apps can only request approved capabilities. The server only routes encrypted messages. The local machine remains the final authority.

The simplest mental model:

```text
Cloud policy decides who may ask.
Local policy decides what may run.
Encryption ensures the server cannot read.
Plugins define what the machine can do.
```

## 29. Tagline Options

1. Securely bind apps to your local machines.
2. Server-blind messaging for local capabilities.
3. Encrypted app-to-device messaging for user-owned machines.
4. Your local machine, safely reachable.
5. A secure host gateway for AI agents.
6. Private paths to local capabilities.
7. Let apps ask. Let your machine decide.

## 30. MVP Decision Summary

Recommended decisions for v1:

```text
Name: Musubi
Category: Secure app-to-device messaging layer
First use case: Remote local agent task execution
Server: Cloudflare Workers
Realtime layer: Durable Objects, one per device
Database: Supabase or Neon Postgres
Artifacts: R2
CLI: Go or Rust
Plugin protocol: JSON-RPC over stdio
Encryption: public-key payload encryption
Offline queue: opt-in only
Plugin install: local path first
Shell: not default, high-risk plugin only
```

