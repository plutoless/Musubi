# Musubi M2 Control Plane Plan

## 0. Document Status

Implementation source plan. The product contract, route map, low-fidelity wireframes, security copy, and verifier notes are captured in `docs/control_plane_m2.md`.

This document defines the product scope, UX structure, data model extensions, API contracts, implementation slices, and acceptance criteria for Musubi M2 Control Plane.

## 1. M2 Goal

M1 proves the encrypted app-to-local-capability execution path.

M2 makes that path understandable, controllable, and trustworthy through a minimal control plane.

M2 goal:

> Let users clearly see and control which apps can access which devices, which plugins/channels are exposed, what was requested, what happened, and how to revoke access.

M2 is not about building a beautiful enterprise dashboard. It is about turning Musubi's trust model into visible product behavior.

## 2. M2 Product Thesis

Musubi's core promise is:

```text
Cloud policy decides who may ask.
Local policy decides what may run.
Encryption ensures the server cannot read.
Plugins define what the machine can do.
```

M2 should make this promise visible in the UI.

Users should be able to answer these questions without reading logs or SQL tables:

1. Which of my machines are connected?
2. What plugins/capabilities does each machine expose?
3. Which apps can ask this machine to do something?
4. Which channels are each app allowed to use?
5. What happened when a task was sent?
6. Was it delivered, received, processed, completed, failed, denied, or cancelled?
7. Did the server read the task content?
8. How do I revoke an app, grant, or device?
9. What is controlled by cloud grants versus local policy?

## 3. M2 Non-goals

M2 does not include:

- Third-party app marketplace
- Public OAuth consent for external developers
- Billing
- Enterprise RBAC
- SCIM
- Team approval workflow
- Plugin marketplace
- Remote plugin install
- Full key rotation automation
- Advanced security posture scoring
- Payload inspection
- Remote shell UX
- Remote desktop UX
- Full observability platform

M2 should stay focused on core trust and control UX.

## 4. Target Users for M2

## 4.1 Individual Developer

Wants to connect their local machine and understand what Musubi exposes.

Needs:

- See device online/offline
- See installed plugins
- See app grants
- Revoke access quickly
- Confirm payload privacy

## 4.2 First-party App Developer

In M2, this is likely the Hermes app developer.

Needs:

- Create app identity
- Register app public key
- Grant app access to device channels
- Send test messages
- Debug message delivery/status

## 4.3 Power User / Early Adopter

Wants to test user-owned apps or scripts.

Needs:

- Create app token/key
- Grant app access
- Understand local policy behavior
- Inspect audit trail

## 5. Product Scope

M2 includes five primary areas:

1. Devices
2. Apps
3. Grants
4. Capabilities
5. Message & Audit Timeline

Secondary areas:

6. Keys
7. Local Policy Visibility
8. Revoke & Safety Actions
9. Setup / Onboarding

## 6. Information Architecture

Recommended navigation:

```text
Home
Devices
Apps
Messages
Audit
Settings
```

Alternative nested structure:

```text
Home
Devices
  Device Detail
Apps
  App Detail
Messages
Audit
Settings
```

For M2, keep Grants and Capabilities inside Device/App detail pages rather than making them top-level navigation.

## 7. M2 Pages

## 7.1 Home

Purpose:

Give the user a simple overview of their Musubi environment and the next best action.

Sections:

1. Quick status
2. Install CLI / connect a device
3. Online devices
4. Recent messages
5. Security reminders

Suggested UI copy:

> Musubi lets apps ask approved local plugins to run tasks. The server routes encrypted messages but cannot read task contents.

Key cards:

```text
Connected devices: 2
Online now: 1
Apps with access: 1
Messages today: 12
```

Primary actions:

- Install CLI
- Register device
- Create app
- View messages

Acceptance criteria:

- User can tell whether any device is online.
- User can copy install/register commands.
- User can navigate to device/app setup.

## 7.2 Devices List

Route:

```text
/devices
```

Purpose:

Show registered machines and their connection/capability state.

Columns:

```text
Device
Status
Platform
CLI Version
Plugins
Authorized Apps
Last Seen
Actions
```

Status values:

```text
online
offline
revoked
unknown
```

Actions:

- View detail
- Rename
- Revoke

Empty state:

```text
No devices connected yet.
Install the Musubi CLI to register your first local machine.
```

Acceptance criteria:

- User can see all registered devices.
- User can distinguish online/offline/revoked devices.
- User can navigate to device detail.

## 7.3 Device Detail

Route:

```text
/devices/:device_id
```

Purpose:

Show everything the user needs to understand and control one local machine.

Tabs or sections:

1. Overview
2. Capabilities
3. Authorized Apps
4. Local Policy
5. Recent Messages
6. Audit
7. Danger Zone

### 7.3.1 Overview

Fields:

```text
Device name
Device ID
Status
Platform
CLI version
Owner
Workspace
Registered at
Last seen
Active device key ID
```

Security copy:

> This device keeps its private key locally. Musubi stores only its public key.

### 7.3.2 Capabilities

Shows reported plugin capabilities.

For each plugin:

```text
Plugin: hermes
Version: 0.1.0
Status: enabled/reported
Channels:
- hermes.task.create
- hermes.task.cancel
- hermes.task.status
- hermes.task.event
Requested permissions:
- process.spawn
- fs.read.project
- fs.write.project
- network.outbound
Last reported: timestamp
```

Important copy:

> Apps do not access the whole machine. They can only request channels that are granted and allowed by local policy.

### 7.3.3 Authorized Apps

Shows apps that have grants to this device.

For each grant:

```text
App: Hermes Web
Type: first-party
Allowed channels:
- hermes.task.create
- hermes.task.cancel
- hermes.task.status
Queueing: disabled
Created by: user
Created at: timestamp
Actions: edit, revoke
```

### 7.3.4 Local Policy

M2 should not require full remote editing of local policy.

It should show a read-only summary from last reported device policy, if available.

Fields:

```text
Default behavior: deny by default
Known apps
Enabled plugins
Allowed workspace dirs
Require local confirmation: yes/no
Last policy report timestamp
```

Copy:

> Cloud grants allow an app to ask. Local policy on this machine still decides whether the request can run.

M2 implementation can start with:

- No policy report
- Show explanatory placeholder

M2.1 can add local policy reporting.

### 7.3.5 Recent Messages

Shows recent messages involving this device.

Columns:

```text
Time
App
Channel
Status
Duration
Message ID
```

No plaintext payload is shown.

### 7.3.6 Audit

Shows device-related audit events:

```text
device.registered
device.connected
device.disconnected
device.capabilities_reported
grant.created
grant.revoked
message.delivered
message.failed
```

### 7.3.7 Danger Zone

Actions:

- Revoke device
- Delete device record if safe

Revoke behavior:

- Device cannot connect anymore.
- Existing app grants to this device become unusable.
- Historical messages/audit remain.

Acceptance criteria:

- User can understand what this machine exposes.
- User can see which apps can ask it to do things.
- User can revoke access.

## 7.4 Apps List

Route:

```text
/apps
```

Purpose:

Show Musubi app identities that can request local capabilities.

Columns:

```text
App
Type
Status
Authorized Devices
Allowed Channels
Created At
Actions
```

App types for M2:

```text
first_party
user_owned
```

Third-party should be hidden or disabled in M2.

Actions:

- View detail
- Revoke

Acceptance criteria:

- User can see which apps exist.
- User can distinguish first-party and user-owned apps.
- User can navigate to app detail.

## 7.5 App Detail

Route:

```text
/apps/:app_id
```

Purpose:

Show identity, keys, grants, messages, and safety actions for one app.

Sections:

1. Overview
2. Keys
3. Authorized Devices
4. Messages
5. Audit
6. Danger Zone

### 7.5.1 Overview

Fields:

```text
App name
App ID
Type
Status
Workspace
Created by
Created at
```

### 7.5.2 Keys

Fields:

```text
Active app key ID
Public key fingerprint
Created at
Status
```

M2 does not need full key rotation, but should display key metadata.

Copy:

> Musubi stores app public keys for encryption. Production app private keys should stay with the app runtime, not the Musubi server.

For local/dev mode, if server-managed app private key is enabled, show warning:

> Dev mode: app private key is server-managed. Do not use this mode for production payload privacy.

### 7.5.3 Authorized Devices

Shows grants from this app to devices.

For each grant:

```text
Device: Ethan MacBook Pro
Status: online
Allowed channels:
- hermes.task.create
- hermes.task.cancel
Queueing: disabled
Actions: edit, revoke
```

### 7.5.4 Messages

Shows recent messages sent by this app.

### 7.5.5 Audit

Shows app-related audit events.

### 7.5.6 Danger Zone

Actions:

- Revoke app
- Revoke all grants
- Disable app

Acceptance criteria:

- User can see where an app can send messages.
- User can revoke app access.
- User can understand key visibility.

## 7.6 Grant Create/Edit UX

M2 grant UX is critical.

Route options:

```text
/apps/:app_id/grants/new
/devices/:device_id/grants/new
```

Recommended flow:

```text
Select app
  ↓
Select device
  ↓
Select plugin
  ↓
Select channels
  ↓
Review security summary
  ↓
Create grant
```

### 7.6.1 Select App

Show:

```text
App name
App type
Status
```

### 7.6.2 Select Device

Show:

```text
Device name
Status
Platform
Plugins
```

### 7.6.3 Select Plugin

Show reported plugins from device capabilities.

For each plugin:

```text
hermes
Available channels: 4
Requested permissions: process.spawn, fs.read.project, fs.write.project
```

### 7.6.4 Select Channels

Show checkboxes:

```text
[ ] hermes.task.create
[ ] hermes.task.cancel
[ ] hermes.task.status
[ ] hermes.task.event
```

Recommended defaults:

For task-oriented plugins:

```text
create
cancel
status
```

Event channels may be implicitly app-bound result channels, not necessarily request-grant channels.

### 7.6.5 Queueing

Default:

```text
Queueing disabled
```

Copy:

> If queueing is disabled, requests fail when the device is offline. This avoids old tasks running unexpectedly when a device reconnects.

### 7.6.6 Review

Show a human-readable summary:

```text
Hermes Web will be allowed to ask Ethan MacBook Pro's hermes plugin to:
- create tasks
- cancel tasks
- check task status

The server will route encrypted messages but cannot read task contents.
The local machine can still deny requests through local policy.
```

Actions:

- Create grant
- Cancel

Acceptance criteria:

- User can create a grant without manually typing channel names.
- User understands grant meaning.
- Grant can be revoked.

## 7.7 Messages Page

Route:

```text
/messages
```

Purpose:

Show message lifecycle across apps/devices without showing payload.

Columns:

```text
Time
App
Device
Channel
Status
Duration
Message ID
```

Filters:

```text
App
Device
Channel
Status
Time range
```

Message statuses:

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

Clicking a message opens message detail.

## 7.8 Message Detail

Route:

```text
/messages/:message_id
```

Purpose:

Explain exactly what happened to one request.

Sections:

1. Summary
2. Timeline
3. Routing metadata
4. Crypto metadata
5. Error details

### 7.8.1 Summary

Fields:

```text
Message ID
Correlation ID
App
Device
Channel
Status
Created at
Updated at
Duration
```

### 7.8.2 Timeline

Example:

```text
10:00:00 message.created
10:00:00 message.validated
10:00:01 message.delivered
10:00:01 message.received
10:00:02 message.processing
10:00:15 message.completed
```

### 7.8.3 Routing Metadata

Fields:

```text
Workspace
App ID
Device ID
Channel
TTL
Queueing mode
```

### 7.8.4 Crypto Metadata

Fields:

```text
Crypto version
Algorithm
Sender key ID
Recipient key ID
Payload size
```

Copy:

> Payload encrypted end-to-end. Musubi server cannot display task contents.

### 7.8.5 Error Details

Safe error fields:

```text
Error code
Error message
Failure stage
```

Error messages must not include decrypted payloads.

Acceptance criteria:

- User can debug delivery failures.
- User can see privacy boundary.
- User cannot see plaintext payload in server UI.

## 7.9 Audit Page

Route:

```text
/audit
```

Purpose:

Show security-relevant events across the workspace.

Columns:

```text
Time
Event
Actor
App
Device
Channel
Message ID
```

Filters:

```text
Event type
App
Device
Actor
Time range
```

M2 event types:

```text
device.registered
device.connected
device.disconnected
device.revoked
device.capabilities_reported
app.created
app.revoked
app.disabled
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
local_policy.denied
```

Acceptance criteria:

- User can inspect grants and message lifecycle history.
- Audit excludes plaintext payloads.

## 8. M2 Data Model Extensions

M1 already has core tables. M2 may add or extend these fields.

## 8.1 devices

Add:

```sql
alter table devices add column display_name text;
alter table devices add column description text;
alter table devices add column last_capability_report_at timestamptz;
alter table devices add column revoked_by text;
```

## 8.2 apps

Add:

```sql
alter table apps add column description text;
alter table apps add column disabled_at timestamptz;
alter table apps add column disabled_by text;
alter table apps add column revoked_by text;
```

## 8.3 app_device_channel_grants

Add:

```sql
alter table app_device_channel_grants add column name text;
alter table app_device_channel_grants add column description text;
alter table app_device_channel_grants add column revoked_by text;
alter table app_device_channel_grants add column updated_at timestamptz;
```

## 8.4 message_status_events

M1 may store only current message status and audit events.

For M2 message timeline, add a dedicated status events table or derive from audit.

Recommended table:

```sql
create table message_status_events (
  id text primary key,
  message_id text not null references messages(id),
  workspace_id text not null references workspaces(id),
  status text not null,
  stage text,
  error_code text,
  error_message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Reason:

- Message timeline should be product-facing.
- Audit events are security-facing.
- They overlap, but product UX is cleaner with explicit status events.

## 8.5 local_policy_reports

Optional for M2.1.

```sql
create table local_policy_reports (
  id text primary key,
  workspace_id text not null references workspaces(id),
  device_id text not null references devices(id),
  policy_version text,
  summary jsonb not null,
  reported_at timestamptz not null default now()
);
```

M2 can show placeholder if not implemented.

## 9. API Contracts for M2

## 9.1 List Devices

```http
GET /v1/devices
```

Query params:

```text
status
workspace_id
limit
cursor
```

Response:

```json
{
  "devices": [
    {
      "id": "dev_123",
      "name": "Ethan MacBook Pro",
      "status": "online",
      "platform": "darwin-arm64",
      "cli_version": "0.1.0",
      "plugin_count": 2,
      "authorized_app_count": 1,
      "last_seen_at": "2026-05-06T10:00:00Z"
    }
  ],
  "next_cursor": null
}
```

## 9.2 Get Device Detail

```http
GET /v1/devices/{device_id}
```

Response includes:

```json
{
  "device": {},
  "active_key": {},
  "capabilities": [],
  "grants": [],
  "recent_messages": [],
  "recent_audit_events": []
}
```

## 9.3 Revoke Device

```http
POST /v1/devices/{device_id}/revoke
```

Request:

```json
{
  "reason": "User revoked from console"
}
```

Response:

```json
{
  "device_id": "dev_123",
  "status": "revoked"
}
```

Behavior:

- Mark device revoked.
- Mark active device keys revoked.
- Future WebSocket connections fail.
- Existing connection should be closed if online.
- Grants remain historically visible but unusable.

## 9.4 List Apps

```http
GET /v1/apps
```

Response:

```json
{
  "apps": [
    {
      "id": "app_123",
      "name": "Hermes Web",
      "type": "first_party",
      "status": "active",
      "authorized_device_count": 1,
      "allowed_channel_count": 3,
      "created_at": "2026-05-06T10:00:00Z"
    }
  ]
}
```

## 9.5 Get App Detail

```http
GET /v1/apps/{app_id}
```

Response includes:

```json
{
  "app": {},
  "active_key": {},
  "grants": [],
  "recent_messages": [],
  "recent_audit_events": []
}
```

## 9.6 Revoke App

```http
POST /v1/apps/{app_id}/revoke
```

Behavior:

- Mark app revoked.
- Revoke app keys.
- Revoke or disable active grants.
- Future messages fail.

## 9.7 Create Grant

```http
POST /v1/grants
```

Request:

```json
{
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

Validation:

- App active
- Device active
- Channels are supported by reported device capabilities, or explicitly allowed with warning
- Workspace matches

## 9.8 Update Grant

```http
PATCH /v1/grants/{grant_id}
```

Allowed updates:

- allowed_channels
- queueing_allowed
- description

## 9.9 Revoke Grant

```http
POST /v1/grants/{grant_id}/revoke
```

Behavior:

- Mark grant revoked.
- Future messages using that app/device/channel fail.

## 9.10 List Messages

```http
GET /v1/messages
```

Query params:

```text
app_id
device_id
channel
status
from
to
limit
cursor
```

Response:

```json
{
  "messages": [
    {
      "id": "msg_123",
      "app_id": "app_123",
      "app_name": "Hermes Web",
      "device_id": "dev_123",
      "device_name": "Ethan MacBook Pro",
      "channel": "hermes.task.create",
      "status": "completed",
      "created_at": "2026-05-06T10:00:00Z",
      "updated_at": "2026-05-06T10:00:15Z",
      "duration_ms": 15000
    }
  ],
  "next_cursor": null
}
```

## 9.11 Get Message Detail

```http
GET /v1/messages/{message_id}
```

Response:

```json
{
  "message": {},
  "status_events": [],
  "audit_events": [],
  "crypto": {
    "version": "m1",
    "alg": "x25519-xsalsa20-poly1305",
    "sender_key_id": "appkey_123",
    "recipient_key_id": "devkey_456"
  }
}
```

## 9.12 List Audit Events

```http
GET /v1/audit-events
```

Query params:

```text
event_type
app_id
device_id
message_id
from
to
limit
cursor
```

## 10. Permission and Revoke Semantics

## 10.1 Message Authorization Check

Before accepting a message:

```text
1. Workspace exists.
2. App exists and is active.
3. Device exists and is not revoked.
4. App and device belong to same workspace.
5. Active grant exists for app + device.
6. Requested channel is in allowed_channels.
7. App key is active.
8. Device key is active.
9. TTL is valid.
10. Queueing policy is valid.
```

## 10.2 Revoke Device

Revoke device means:

- Device cannot reconnect.
- Existing connection closed.
- Device keys revoked.
- Messages to device fail.
- Historical grants remain visible but inactive.

## 10.3 Revoke App

Revoke app means:

- App cannot send messages.
- App keys revoked.
- App grants are effectively inactive.
- Historical messages remain.

## 10.4 Revoke Grant

Revoke grant means:

- Specific app/device/channel authorization removed.
- App and device remain active.
- Future messages requiring this grant fail.

## 10.5 Disable App

Optional distinction from revoke:

- `disabled`: can be re-enabled.
- `revoked`: terminal or requires explicit recovery.

M2 can implement revoke only, or support both if simple.

## 11. Security Copywriting Requirements

M2 UI should repeatedly reinforce correct mental models.

Recommended phrases:

```text
Apps can ask. Your machine decides.
```

```text
Musubi routes encrypted messages but cannot read task contents.
```

```text
This grant allows an app to request specific plugin channels, not access the whole machine.
```

```text
Local policy may still deny this request even when cloud access is granted.
```

```text
Queueing is disabled by default to prevent old tasks from running unexpectedly.
```

Avoid phrases:

```text
Remote control
Control your machine
Full access
Manage machines
Open a tunnel
```

Use instead:

```text
Invoke local capabilities
Authorized plugin channels
Local capability endpoint
Encrypted app-to-device message
```

## 12. Frontend Implementation Plan

## 12.1 Recommended Stack

For M2 control plane:

```text
Vite + React + TypeScript + Tailwind
```

If using existing app framework, adapt accordingly.

Avoid overinvesting in dashboard polish. Prioritize clarity.

## 12.2 UI Components

Core components:

```text
StatusBadge
DeviceCard
AppCard
PluginCapabilityCard
ChannelList
GrantSummaryCard
MessageStatusTimeline
AuditEventTable
DangerZone
SecurityNotice
EmptyState
CopyableCodeBlock
```

## 12.3 Design Style

Visual direction:

- Minimal
- Security-oriented
- Developer-friendly
- Dense enough for debugging
- Avoid enterprise dashboard bloat

## 13. Backend Implementation Plan

## 13.1 Required Backend Additions

- List/detail APIs for devices/apps/messages/audit
- Grant create/edit/revoke APIs
- Revoke app/device APIs
- Message status events table
- Capability aggregation queries
- Audit query API
- Permission checks hardened

## 13.2 Required Permission Middleware

Implement shared function:

```ts
assertCanSendMessage({
  workspaceId,
  appId,
  deviceId,
  channel,
  senderIdentity,
})
```

Implement shared function:

```ts
assertCanManageWorkspaceResource({
  workspaceId,
  userId,
  action,
  resourceType,
  resourceId,
})
```

For M2, role model can be simple:

```text
workspace_owner
```

Full RBAC later.

## 14. Implementation Slices

## Slice 0: M2 Product Contract

Deliverables:

- This plan committed as `docs/control_plane_m2.md`
- Route map
- Page wireframe sketches or low-fidelity mock
- Security copy draft

Acceptance criteria:

- Team agrees on IA and M2 scope.

## Slice 1: Backend Read APIs

Goal:

Expose the data required to render Devices, Apps, Messages, Audit.

Deliverables:

- `GET /v1/devices`
- `GET /v1/devices/:id`
- `GET /v1/apps`
- `GET /v1/apps/:id`
- `GET /v1/messages`
- `GET /v1/messages/:id`
- `GET /v1/audit-events`

Acceptance criteria:

- APIs return no plaintext payloads.
- APIs include enough joined display data for UI.
- Basic pagination exists.

## Slice 2: Devices UI

Deliverables:

- Devices list page
- Device detail page
- Capability display
- Authorized apps display
- Recent messages display
- Revoke device action

Acceptance criteria:

- User can inspect a registered device and its plugins.
- User can see app grants to that device.
- User can revoke device.

## Slice 3: Apps UI

Deliverables:

- Apps list page
- App detail page
- Key metadata display
- Authorized devices display
- Recent messages display
- Revoke app action

Acceptance criteria:

- User can inspect app identity and grants.
- User can revoke app.

## Slice 4: Grant UX

Deliverables:

- Create grant flow
- Edit grant flow
- Revoke grant flow
- Channel selection from device capabilities
- Queueing toggle with warning copy
- Review screen

Acceptance criteria:

- User can create app/device/channel grant without manual channel typing.
- User can revoke grant.
- Denied/revoked grants block future messages.

## Slice 5: Message Timeline UX

Deliverables:

- Messages list page
- Message detail page
- Status timeline
- Crypto metadata display
- Error details display
- Filters

Acceptance criteria:

- User can debug message lifecycle.
- User can see delivery/processing/failure stage.
- Payload remains hidden.

## Slice 6: Audit UX

Deliverables:

- Audit list page
- Filters
- Event detail drawer
- Links to app/device/message

Acceptance criteria:

- User can inspect security-relevant events.
- Audit excludes plaintext.

## Slice 7: Revoke Semantics Hardening

Deliverables:

- Revoke app/device/grant backend behavior
- Active connection close on device revoke
- Message send blocked after revoke
- Audit event emitted for each revoke

Acceptance criteria:

- Revoked app cannot send.
- Revoked device cannot connect.
- Revoked grant cannot authorize messages.

## Slice 8: Onboarding / Setup Polish

Deliverables:

- Home page setup card
- CLI install command
- Device register command
- First app/grant setup path
- Empty states

Acceptance criteria:

- New user can understand next step from empty state.

## 15. M2 Acceptance Criteria

M2 is complete when a user can:

1. Open Musubi control plane.
2. See connected and offline devices.
3. Open a device and see reported plugins/channels.
4. Create or view a first-party app.
5. Grant the app access to a device's Hermes channels.
6. Send a Hermes task through M1 flow.
7. See message lifecycle in UI.
8. See audit trail without plaintext payloads.
9. Revoke a grant and observe future requests fail.
10. Revoke an app and observe future requests fail.
11. Revoke a device and observe future connections fail.
12. Understand from UI copy that Musubi routes encrypted messages but does not read payload contents.

## 16. M2 Demo Script

```text
1. Open Musubi Home.
2. See one online device: Ethan MacBook Pro.
3. Open device detail.
4. See hermes plugin capabilities.
5. Open Hermes Web app detail.
6. See no grants or existing grant.
7. Create grant:
   - App: Hermes Web
   - Device: Ethan MacBook Pro
   - Plugin: hermes
   - Channels: task.create, task.cancel, task.status
   - Queueing: disabled
8. Send Hermes task.
9. Open message detail.
10. Show status timeline:
    created → validated → delivered → received → processing → completed
11. Show crypto metadata and privacy notice.
12. Revoke grant.
13. Try sending task again.
14. Show request denied due to missing grant.
15. Open Audit page and show grant/message events.
```

## 17. Product Risks

## 17.1 Dashboard Bloat

Risk:

Control plane becomes a generic admin dashboard.

Mitigation:

Keep M2 focused on trust, grants, capabilities, and message lifecycle.

## 17.2 Wrong Mental Model

Risk:

Users think Musubi gives apps full machine access.

Mitigation:

Use plugin/channel language everywhere. Avoid remote control wording.

## 17.3 Payload Leakage

Risk:

Debug UI accidentally exposes plaintext payload or sensitive local info.

Mitigation:

All server APIs must return envelope/status/metadata only. Message detail page must explicitly say payload is encrypted and unavailable to server.

## 17.4 Revoke Semantics Ambiguity

Risk:

User revokes access but messages still succeed due to stale grants/connections.

Mitigation:

Centralize permission checks and close revoked device connections.

## 17.5 Capability Drift

Risk:

Device capabilities shown in UI become stale.

Mitigation:

Show `last_reported_at`. Refresh capabilities on CLI connect. Mark stale capabilities if device has not reported recently.

## 18. Post-M2 Direction

After M2, choose based on what feels weakest.

Recommended default:

```text
M2.5 Real Codex Adapter
```

Reason:

M2 establishes trust/control. Codex then proves Musubi can support a real external coding-agent workflow beyond Hermes.

Alternative:

```text
M3 App SDK
```

Do this if app-side integration friction becomes the biggest blocker.

Alternative:

```text
M3 Local Policy UX
```

Do this if users struggle to understand or manage local policy.

## 19. M2 Decision Summary

```text
M2 Theme:
  Make Musubi understandable and controllable.

Primary objects:
  Devices, Apps, Grants, Capabilities, Messages, Audit.

Main UX:
  Device detail, app detail, grant creation, message timeline, audit trail.

Security posture:
  Payload remains hidden. Revoke must be reliable. UI explains cloud-vs-local control.

Not included:
  Third-party marketplace, billing, enterprise RBAC, remote plugin install.

Exit demo:
  User can grant Hermes Web access to a local Hermes plugin, inspect the encrypted message lifecycle, then revoke access and see future requests denied.
```
