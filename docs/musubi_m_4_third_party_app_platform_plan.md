# Musubi M4 Third-party App Platform Plan

## 0. Document Status

Draft for `docs/third_party_app_platform_m4.md`.

This document defines the M4 plan for Musubi's Third-party App Platform, including durable platform state, developer/publisher registration, third-party app identity, permission declarations, consent requests, grants, app authorization, revoke/report flows, audit, implementation slices, and acceptance criteria.

M4.5 Plugin Registry / Plugin Trust is intentionally out of scope except where M4 needs minimal registry metadata for consent display.

---

## 1. M4 Goal

M4 goal:

> Allow external developers to create Musubi Apps that users can authorize to access specific devices, plugins, and channels through a clear, durable, auditable consent flow.

M4 turns Musubi from a first-party and user-owned integration layer into a controlled third-party app platform.

Concrete M4 demo:

```text
External AI Coding SaaS
  ↓ creates third-party Musubi app
  ↓ declares requested Codex capability
User opens Musubi consent screen
  ↓ selects device/plugin/channels
Musubi creates durable grant
  ↓ external app sends encrypted codex.task.create
Musubi validates grant and routes ciphertext
  ↓ local CLI checks local policy
Codex plugin runs locally
  ↓ user revokes third-party access
Future request fails
```

M4 should prove:

1. Third-party developers can register apps.
2. Apps have durable identity, publisher, keys, and status.
3. Apps can declare requested plugin/channel permissions.
4. Users can review and authorize app access.
5. Consent requests persist across refresh, redirect, and restart.
6. Grants are scoped to app + device + channel.
7. Users can revoke third-party access.
8. Users can report suspicious apps.
9. Admin/operator can suspend apps.
10. Audit trail is durable and payload-blind.
11. Relay in-memory state is no longer the source of truth for trust objects.

---

## 2. Product Positioning

M4 should not position third-party apps as remote machine access.

Wrong framing:

```text
Allow this third-party app to control your computer.
```

Correct framing:

```text
Allow this app to ask a specific plugin on a specific device to perform specific actions.
```

Core message:

> Third-party apps can ask. Your local machine still decides. Musubi routes encrypted messages but cannot read task contents.

User-facing explanation:

```text
This app will not get full access to your machine.
It can only request the plugin channels you authorize.
Your local policy can still deny the request.
You can revoke access at any time.
```

---

## 3. M4 Non-goals

M4 does not include:

- Plugin marketplace
- Plugin package signing
- CLI plugin install from registry
- Remote plugin installation
- Enterprise approval workflow
- Billing or revenue share
- Public app ranking/reviews
- Full app review operations team
- Automated malware detection
- Full OAuth provider replacement
- Enterprise RBAC beyond simple owner/admin checks
- Full browser-only third-party private key model
- WASM plugin sandbox
- Third-party app access to unregistered devices
- Server-side payload decryption

M4 is about third-party app identity, consent, durable grants, revoke/report, and audit.

---

## 4. M4 Product Thesis

Third-party apps are valuable because they let external products request local capabilities without asking users for SSH, VPN, raw credentials, full filesystem access, or full remote control.

Examples:

```text
External AI coding SaaS       → codex.task.create
Cloud QA tool                 → test-runner.run
MCP agent platform            → mcp.tool.call
Diagnostics vendor            → diagnostics.collect
Data analysis SaaS            → local-query.run
Homelab dashboard             → docker.status
```

The product value is scoped local capability invocation:

```text
Not: Give this SaaS access to my computer.
But: Allow this SaaS to request this plugin/channel on this device.
```

---

## 5. Architecture Rule: Persistent Platform State

M4 requires a hard architecture boundary.

```text
Durable Objects / relay memory must never be the source of truth for platform trust state.
```

Relay memory may cache:

```text
- active WebSocket sessions
- device online state
- in-flight delivery state
- short-lived ack state
- ephemeral connection metadata
```

Postgres must be the source of truth for:

```text
- developer accounts
- publisher profiles
- apps
- app keys
- app API keys
- permission declarations
- consent requests
- grants
- app status/trust/review state
- abuse reports
- registry metadata needed for display
- audit events
```

Reason:

Third-party app consent and trust objects are long-lived platform state. They must survive server restart, relay migration, verifier runs, local dev resets, and hosted deployment.

---

## 6. M4 App Types

By M4, Musubi supports three app types:

```text
first_party
user_owned
third_party
```

### first_party

Created and controlled by Musubi/Hermes operator.

Examples:

```text
Hermes Companion
newbro backend
Musubi demo app
```

### user_owned

Created by a Musubi user for personal scripts and automations.

Examples:

```text
My Automation Script
My Personal Dashboard
```

### third_party

Created by an external developer/publisher for other Musubi users to authorize.

Examples:

```text
ExampleAI Coding
Acme QA Cloud
External MCP Agent Platform
```

M4 focuses on `third_party`.

---

## 7. Core Objects

M4 introduces or hardens these durable objects:

```text
Developer Account
Publisher Profile
Third-party App
App Key
App API Key
Permission Declaration
Consent Request
Grant
Authorized App View
Abuse Report
Audit Event
```

Optional lightweight registry display objects:

```text
Plugin Catalog Entry
Plugin Channel Metadata
```

Full plugin registry and signing are M4.5.

---

## 8. Trust Model

M4 has four trust layers.

## 8.1 App Trust

Answers:

```text
Who is asking?
Who published this app?
Is the app active, verified, unverified, suspended, or blocked?
```

## 8.2 Grant Trust

Answers:

```text
Has the user allowed this app to ask this device/plugin/channel?
```

## 8.3 Local Policy Trust

Answers:

```text
Even if cloud grant exists, will the local machine allow the request to run?
```

## 8.4 Plugin Trust

Answers:

```text
What local code will run?
```

M4 only shows plugin capability/trust metadata if available. Full plugin signing/trust is M4.5.

---

## 9. Developer and Publisher Model

## 9.1 Developer Account

A developer account represents a person or organization that can create third-party apps.

Fields:

```text
developer_id
owner_user_id
name
email
status
created_at
verified_at
suspended_at
```

Statuses:

```text
active
suspended
deleted
```

## 9.2 Publisher Profile

A publisher profile is what users see during consent.

Fields:

```text
publisher_id
developer_id
display_name
website
support_email
privacy_policy_url
terms_url
logo_url
verification_status
created_at
updated_at
```

Verification statuses:

```text
unverified
verified
suspended
```

M4 can launch with unverified publishers, but the UI must label them clearly.

## 9.3 Publisher Requirements

M4 minimum required fields:

```text
display_name
support_email
privacy_policy_url
```

Recommended fields:

```text
website
terms_url
logo_url
```

Consent should warn if publisher is unverified or missing important links.

---

## 10. Third-party App Registration

## 10.1 Developer Flow

```text
Create developer account
  ↓
Create publisher profile
  ↓
Create third-party app
  ↓
Register app public key
  ↓
Create app API key
  ↓
Declare requested capabilities
  ↓
Generate consent link
  ↓
User authorizes device/plugin/channels
  ↓
App sends encrypted messages through Musubi
```

## 10.2 Third-party App Fields

```text
app_id
publisher_id
name
description
logo_url
website
privacy_policy_url
terms_url
type = third_party
status
trust_status
review_status
created_at
updated_at
revoked_at
suspended_at
```

App statuses:

```text
draft
active
disabled
revoked
suspended
```

Trust statuses:

```text
unverified
verified
official
suspicious
blocked
```

Review statuses:

```text
not_submitted
in_review
approved
rejected
changes_requested
```

M4 initial mode can allow:

```text
unverified + user-consented
```

but must show warnings.

---

## 11. App Keys and API Keys

M4 preserves the M3 distinction:

```text
API key authenticates app to Musubi server.
App private key decrypts device results.
```

## 11.1 App Encryption Keys

Third-party developer generates app key pair.

```text
app_private_key: held by third-party backend
app_public_key: stored by Musubi
```

Musubi server should not store third-party app private keys.

## 11.2 App API Keys

Third-party developer creates one or more API keys.

```text
api_key: held by third-party backend
api_key_hash: stored by Musubi
```

API key scope:

```text
workspace/platform + app_id
```

Allowed operations:

```text
- send message as this app
- list devices granted to this app if consent allows
- get public keys for granted devices
- read own message statuses/events
- cancel own messages
```

Not allowed:

```text
- create grants without user consent
- revoke devices
- manage other apps
- read all workspace messages
- read plaintext payloads
```

---

## 12. Permission Declarations

Third-party apps must declare the capabilities they intend to request.

Example:

```json
{
  "requested_capabilities": [
    {
      "plugin": "codex",
      "channels": [
        "codex.task.create",
        "codex.task.cancel",
        "codex.task.status"
      ],
      "reason": "Run coding tasks in your approved local workspace."
    }
  ],
  "queueing_requested": false
}
```

Important:

Permission declarations do not grant access. They only:

1. inform consent UX,
2. constrain what the app may request in standard consent,
3. help Musubi flag unexpected channel requests.

Actual grants are created only after user consent.

## 12.1 Declaration States

```text
draft
active
archived
```

## 12.2 Declaration Validation

M4 should validate:

```text
- plugin name is syntactically valid
- channel names are syntactically valid
- reason is present
- high-risk channels are flagged if known
```

Full plugin permission risk scoring belongs to M4.5.

---

## 13. Consent Request Flow

## 13.1 Consent Entry

Third-party app creates or redirects into a Musubi consent request.

OAuth-like URL:

```http
GET /authorize
  ?client_id=app_123
  &redirect_uri=https://thirdparty.example/callback
  &state=opaque_state
  &requested_capability_set=default
```

M4 does not need to be a full OAuth provider. It can implement a simpler consent request object first.

## 13.2 Consent Request Lifecycle

States:

```text
pending
approved
denied
expired
cancelled
```

Consent request must persist.

Why:

```text
- user may refresh page
- user may need to login
- user may switch device selection
- app redirect callback needs stable state
- audit needs durable record
```

## 13.3 Consent Screen

User should see:

```text
ExampleAI wants to access local capabilities through Musubi.

Publisher:
ExampleAI Inc.
Verification: Unverified / Verified
Website: example.ai
Privacy Policy: example.ai/privacy

Requested capabilities:
- Codex plugin
  - create coding tasks
  - cancel tasks
  - read task status
Reason: Run coding tasks in your approved local workspace.

Choose device:
[ Ethan MacBook Pro ] online
[ Home Server ] offline

Choose plugin/channels:
[ ] codex.task.create
[ ] codex.task.cancel
[ ] codex.task.status

Queueing:
[ ] Allow requests while device is offline

Security:
- This app cannot access your whole machine.
- Musubi routes encrypted messages and cannot read task contents.
- Your local policy can still deny requests.
- You can revoke this app later.
```

Actions:

```text
Authorize
Cancel
Report app
```

## 13.4 Consent Rules

Consent approval requires:

1. User is logged into Musubi.
2. App is active.
3. App is not suspended or blocked.
4. Publisher is not suspended.
5. Target device belongs to user/workspace.
6. Target device is active.
7. Requested channels are declared by app, unless advanced override is allowed.
8. Device has reported matching plugin capability, or user accepts warning.
9. User confirms grant.

## 13.5 Consent Result

On approval:

```text
- create app_device_channel_grant
- mark consent_request approved
- write audit events
- redirect to third-party app callback
```

Callback can include:

```text
state
consent_id
grant_id
status=approved
```

If later adopting OAuth code flow:

```text
authorization_code
```

M4 simple mode can use `consent_id + grant_id`.

---

## 14. Grant Model

M4 uses the existing app-device-channel grant model.

A grant answers:

```text
Can this app ask this device on these channels?
```

Grant fields:

```text
grant_id
workspace_id
app_id
device_id
allowed_channels
queueing_allowed
created_by
created_from_consent_request_id
revoked_at
revoked_by
```

Grant does not override local policy.

## 14.1 Queueing Default

Default:

```text
queueing_allowed = false
```

Reason:

Avoid old remote tasks running unexpectedly when device reconnects.

Consent copy:

> If queueing is disabled, requests fail when the device is offline. This avoids old tasks running unexpectedly later.

---

## 15. Authorized Apps UX

Users need a place to manage third-party access.

Route:

```text
/authorized-apps
```

or integrated under:

```text
/apps?type=third_party_authorized
```

Show for each third-party app:

```text
App name
Publisher
Trust status
Authorized devices
Allowed plugins/channels
Last used
Created at
Actions: view, revoke, report
```

App detail should show:

```text
Publisher details
Verification status
Privacy/terms links
Active grants
Recent messages
Recent audit
Report / revoke all access
```

---

## 16. Revoke Semantics

Users can revoke:

1. One grant for one device.
2. All grants for one third-party app.
3. All third-party access for their workspace/user.

Behavior:

```text
- future messages using revoked grant fail
- historical messages remain visible
- audit records revoke
- existing running tasks may continue unless cancellation is explicitly sent
```

Optional UI action:

```text
Revoke and cancel active tasks
```

M4 can implement revoke first, cancel-active-tasks later.

---

## 17. Abuse Reporting and Suspension

M4 minimum:

- User can report app.
- Operator/admin can suspend app.
- Suspended app cannot send new messages.
- Suspended app is clearly marked in UI.

Report reasons:

```text
misleading permissions
unexpected behavior
spam/abuse
security concern
publisher impersonation
other
```

Suspension behavior:

```text
- app status = suspended
- API keys remain stored but cannot authenticate/send
- consent links fail
- existing grants become unusable
- authorized app UI shows suspended state
```

---

## 18. Audit Requirements

M4 audit must be durable and append-only by convention.

Events:

```text
developer.created
developer.suspended
publisher.created
publisher.updated
publisher.verified
publisher.suspended
third_party_app.created
third_party_app.updated
third_party_app.activated
third_party_app.suspended
third_party_app.revoked
app_api_key.created
app_api_key.revoked
app_key.created
app_key.revoked
permission_declaration.created
permission_declaration.updated
consent_request.created
consent_request.approved
consent_request.denied
consent_request.expired
grant.created
grant.revoked
third_party_app.reported
message.created
message.validated
message.denied
message.delivered
message.failed
```

Audit must not include decrypted payloads.

---

## 19. Data Model

## 19.1 developer_accounts

```sql
create table developer_accounts (
  id text primary key,
  owner_user_id text not null references users(id),
  name text not null,
  email text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  verified_at timestamptz,
  suspended_at timestamptz
);
```

## 19.2 publisher_profiles

```sql
create table publisher_profiles (
  id text primary key,
  developer_id text not null references developer_accounts(id),
  display_name text not null,
  website text,
  support_email text,
  privacy_policy_url text,
  terms_url text,
  logo_url text,
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  suspended_at timestamptz
);
```

## 19.3 apps extensions

The existing `apps` table should support third-party fields.

```sql
alter table apps add column publisher_id text references publisher_profiles(id);
alter table apps add column description text;
alter table apps add column logo_url text;
alter table apps add column website text;
alter table apps add column privacy_policy_url text;
alter table apps add column terms_url text;
alter table apps add column trust_status text not null default 'unverified';
alter table apps add column review_status text not null default 'not_submitted';
alter table apps add column suspended_at timestamptz;
alter table apps add column suspended_by text;
```

Existing `type` should include:

```text
third_party
```

## 19.4 app_permission_declarations

```sql
create table app_permission_declarations (
  id text primary key,
  app_id text not null references apps(id),
  plugin_name text not null,
  channels text[] not null,
  reason text,
  queueing_requested boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
```

## 19.5 consent_requests

```sql
create table consent_requests (
  id text primary key,
  app_id text not null references apps(id),
  user_id text references users(id),
  workspace_id text references workspaces(id),
  state text,
  redirect_uri text,
  requested_capabilities jsonb,
  selected_device_id text references devices(id),
  selected_channels text[],
  queueing_allowed boolean,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz
);
```

## 19.6 consent_request_events

```sql
create table consent_request_events (
  id text primary key,
  consent_request_id text not null references consent_requests(id),
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

## 19.7 app_abuse_reports

```sql
create table app_abuse_reports (
  id text primary key,
  app_id text not null references apps(id),
  reporter_user_id text references users(id),
  reason text not null,
  description text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  resolved_at timestamptz
);
```

## 19.8 audit_events

Existing audit table should be extended if needed.

Recommended shape:

```sql
create table audit_events (
  id text primary key,
  workspace_id text,
  actor_type text not null,
  actor_id text,
  event_type text not null,
  resource_type text,
  resource_id text,
  app_id text references apps(id),
  device_id text references devices(id),
  plugin_name text,
  channel text,
  message_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

## 19.9 Optional lightweight plugin catalog

Full registry is M4.5. M4 can include lightweight catalog entries for consent display.

```sql
create table plugin_catalog_entries (
  id text primary key,
  plugin_name text not null unique,
  display_name text,
  description text,
  known_channels text[],
  risk_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
```

---

## 20. API Contracts

## 20.1 Create Developer Account

```http
POST /v1/developers
Authorization: Bearer user_session
```

Request:

```json
{
  "name": "ExampleAI Dev",
  "email": "dev@example.ai"
}
```

Response:

```json
{
  "developer_id": "devacct_123",
  "status": "active"
}
```

## 20.2 Create Publisher Profile

```http
POST /v1/publishers
Authorization: Bearer user_session
```

Request:

```json
{
  "developer_id": "devacct_123",
  "display_name": "ExampleAI",
  "website": "https://example.ai",
  "support_email": "support@example.ai",
  "privacy_policy_url": "https://example.ai/privacy",
  "terms_url": "https://example.ai/terms"
}
```

## 20.3 Create Third-party App

```http
POST /v1/developer/apps
Authorization: Bearer user_session
```

Request:

```json
{
  "publisher_id": "pub_123",
  "name": "ExampleAI Coding",
  "description": "Run coding tasks on your approved local machine.",
  "logo_url": "https://example.ai/logo.png",
  "website": "https://example.ai",
  "privacy_policy_url": "https://example.ai/privacy",
  "terms_url": "https://example.ai/terms",
  "public_key": "base64_app_public_key"
}
```

Response:

```json
{
  "app_id": "app_123",
  "app_key_id": "appkey_123",
  "status": "draft",
  "trust_status": "unverified"
}
```

## 20.4 Create App API Key

```http
POST /v1/developer/apps/{app_id}/api-keys
Authorization: Bearer user_session
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

## 20.5 Declare App Permissions

```http
POST /v1/developer/apps/{app_id}/permission-declarations
Authorization: Bearer user_session
```

Request:

```json
{
  "plugin_name": "codex",
  "channels": [
    "codex.task.create",
    "codex.task.cancel",
    "codex.task.status"
  ],
  "reason": "Run coding tasks in your approved local workspace.",
  "queueing_requested": false
}
```

## 20.6 Create Consent Request

```http
POST /v1/consent-requests
```

Request:

```json
{
  "app_id": "app_123",
  "redirect_uri": "https://example.ai/musubi/callback",
  "state": "opaque_state",
  "requested_capabilities": [
    {
      "plugin": "codex",
      "channels": [
        "codex.task.create",
        "codex.task.cancel",
        "codex.task.status"
      ]
    }
  ]
}
```

Response:

```json
{
  "consent_request_id": "consent_123",
  "consent_url": "https://musubi.dev/consent/consent_123",
  "status": "pending",
  "expires_at": "..."
}
```

## 20.7 Get Consent Request

```http
GET /v1/consent-requests/{id}
Authorization: Bearer user_session
```

Response includes:

```json
{
  "consent_request": {},
  "app": {},
  "publisher": {},
  "permission_declarations": [],
  "eligible_devices": []
}
```

## 20.8 Approve Consent Request

```http
POST /v1/consent-requests/{id}/approve
Authorization: Bearer user_session
```

Request:

```json
{
  "device_id": "dev_123",
  "allowed_channels": [
    "codex.task.create",
    "codex.task.cancel",
    "codex.task.status"
  ],
  "queueing_allowed": false
}
```

Response:

```json
{
  "status": "approved",
  "grant_id": "grant_123",
  "redirect_uri": "https://example.ai/musubi/callback?state=opaque_state&status=approved&grant_id=grant_123"
}
```

## 20.9 Deny Consent Request

```http
POST /v1/consent-requests/{id}/deny
Authorization: Bearer user_session
```

## 20.10 List Authorized Apps

```http
GET /v1/authorized-apps
Authorization: Bearer user_session
```

Response:

```json
{
  "apps": [
    {
      "app_id": "app_123",
      "name": "ExampleAI Coding",
      "publisher": {
        "display_name": "ExampleAI",
        "verification_status": "unverified"
      },
      "trust_status": "unverified",
      "grants": [
        {
          "grant_id": "grant_123",
          "device_id": "dev_123",
          "device_name": "Ethan MacBook Pro",
          "allowed_channels": ["codex.task.create"]
        }
      ],
      "last_used_at": "..."
    }
  ]
}
```

## 20.11 Revoke Third-party App Grant

```http
POST /v1/grants/{grant_id}/revoke
Authorization: Bearer user_session
```

## 20.12 Report App

```http
POST /v1/apps/{app_id}/report
Authorization: Bearer user_session
```

Request:

```json
{
  "reason": "misleading_permissions",
  "description": "The app asked for more than it described."
}
```

## 20.13 Suspend App

Operator/admin endpoint:

```http
POST /v1/admin/apps/{app_id}/suspend
```

---

## 21. Message Authorization Changes

Before accepting a message from a third-party app, Musubi must check:

```text
1. API key is valid.
2. App exists.
3. App type is third_party or supported app type.
4. App status is active.
5. App is not suspended, blocked, or revoked.
6. Publisher is not suspended.
7. App key is active.
8. Device exists and is active.
9. App has active grant for device.
10. Channel is in grant.allowed_channels.
11. If app has permission declarations, channel is declared or advanced override exists.
12. Queueing request matches grant policy.
13. Message TTL is valid.
```

Denied messages should produce safe errors:

```text
APP_SUSPENDED
APP_REVOKED
GRANT_NOT_FOUND
CHANNEL_NOT_GRANTED
DEVICE_REVOKED
QUEUEING_NOT_ALLOWED
```

No plaintext payloads in errors.

---

## 22. Control Plane UX

## 22.1 Developer Console

Routes:

```text
/developer
/developer/publisher
/developer/apps
/developer/apps/new
/developer/apps/:id
```

Developer app detail sections:

```text
Overview
App Keys
API Keys
Permission Declarations
Consent URL
Usage
Review / Trust Status
Danger Zone
```

## 22.2 Consent Screen

Route:

```text
/consent/:consent_request_id
```

Primary sections:

```text
Who is asking?
What do they want?
Which device will receive requests?
Which plugin/channels are allowed?
What can Musubi see?
What can local policy still deny?
```

## 22.3 Authorized Apps

Routes:

```text
/authorized-apps
/authorized-apps/:app_id
```

Show:

```text
App name
Publisher
Trust status
Authorized devices
Allowed plugins/channels
Last used
Revoke
Report
```

## 22.4 App Warning Labels

Use clear trust labels:

```text
Official
Verified publisher
Unverified publisher
Suspended
Blocked
```

Unverified warning:

> This publisher has not been verified by Musubi. Only authorize apps you trust.

Suspended warning:

> This app has been suspended and can no longer send requests.

---

## 23. M4 Implementation Slices

## Slice M4.0: Persist Platform State

Goal:

Move M4 trust/platform objects out of relay in-memory state and into durable storage.

Deliverables:

- migrations for developer_accounts
- publisher_profiles
- app extensions for third-party fields
- app_permission_declarations
- consent_requests
- consent_request_events
- app_abuse_reports
- audit_events hardening
- repository/data-access layer
- local dev seed data

Acceptance criteria:

1. Developer profiles persist across server restart.
2. Publisher profiles persist across server restart.
3. Third-party apps persist across server restart.
4. App permission declarations persist.
5. Consent requests persist and can be resumed/expired.
6. Grants created from consent persist.
7. Audit events are durable.
8. Relay restart does not lose app/grant/consent configuration.
9. In-memory state is limited to active connection/session state only.

## Slice M4.1: Developer and Publisher Model

Goal:

Allow external developers to create durable developer/publisher identities.

Deliverables:

- create/list/update developer account APIs
- create/update publisher profile APIs
- developer console basic UI
- audit events

Acceptance criteria:

- User can create developer account.
- User can create publisher profile.
- Publisher appears in app registration and consent.

## Slice M4.2: Third-party App Registration

Goal:

Allow developers to create third-party app identities.

Deliverables:

- create third-party app API/UI
- app public key registration
- app API key creation
- trust/review/status fields
- app detail developer page

Acceptance criteria:

- Developer can create app.
- App has public key.
- Developer can create API key.
- App survives restart.

## Slice M4.3: Permission Declarations

Goal:

Require apps to declare requested plugin/channels.

Deliverables:

- declaration API/UI
- declaration validation
- declaration shown on consent screen
- audit events

Acceptance criteria:

- App can declare Codex channels with reason.
- Consent screen displays declaration.

## Slice M4.4: Consent Request Flow

Goal:

Create durable user consent flow.

Deliverables:

- create consent request API
- consent URL
- consent request detail API
- consent screen UI
- device/plugin/channel selection
- approve/deny APIs
- grant creation on approval
- redirect/callback handling
- expiration handling
- audit events

Acceptance criteria:

- User can approve third-party app for selected device/channels.
- Refresh does not lose consent state.
- Approval creates durable grant.
- Denial records audit and redirects safely.

## Slice M4.5: Third-party Grant Enforcement

Goal:

Ensure third-party app can only send within active consent grants.

Deliverables:

- message authorization changes
- app status/trust checks
- publisher suspension checks
- declaration-vs-channel check
- safe error codes
- tests

Acceptance criteria:

- Granted channel succeeds.
- Ungranted channel fails.
- Suspended app fails.
- Revoked grant fails.
- Denied messages do not leak payload.

## Slice M4.6: Authorized Apps and Revoke UX

Goal:

Let users inspect and revoke third-party access.

Deliverables:

- authorized apps list/detail
- revoke grant
- revoke all app access
- app last-used display if available
- audit events

Acceptance criteria:

- User can see third-party apps they authorized.
- User can revoke a grant.
- Revoked access blocks future messages.

## Slice M4.7: App Reporting and Suspension

Goal:

Add basic abuse handling.

Deliverables:

- report app API/UI
- admin/operator suspend action
- suspended app UI state
- message send block for suspended apps
- audit events

Acceptance criteria:

- User can report app.
- Operator can suspend app.
- Suspended app cannot send new messages.

## Slice M4.8: Third-party Developer Docs and SDK Guide

Goal:

Make third-party app integration understandable.

Deliverables:

- docs: create developer account
- docs: create third-party app
- docs: app keys vs API keys
- docs: permission declarations
- docs: consent flow
- docs: using App SDK as third-party backend
- example third-party Codex app

Acceptance criteria:

- External developer can complete test app registration and consent flow from docs.

---

## 24. M4 Acceptance Criteria

M4 is complete when:

1. Developer can create durable developer account.
2. Developer can create durable publisher profile.
3. Developer can create third-party app with app public key.
4. Developer can create app API key.
5. Developer can declare requested plugin/channels.
6. Third-party app can generate consent request.
7. User can open consent screen.
8. User can inspect app, publisher, verification status, and requested capabilities.
9. User can select device and channels.
10. User can approve consent.
11. Approval creates durable grant.
12. Third-party app can send encrypted messages only to granted channels.
13. User can revoke grant.
14. Revoked grant blocks future messages.
15. User can report app.
16. Operator can suspend app.
17. Suspended app cannot send messages.
18. Developer/publisher/app/consent/grant/audit state persists across server restart.
19. Relay in-memory state is not source of truth for trust objects.
20. Audit trail records consent, grant, revoke, report, suspension, and message authorization events without plaintext payloads.

---

## 25. M4 Demo Script

```text
1. Developer logs into Musubi Developer Console.
2. Developer creates publisher profile: ExampleAI.
3. Developer creates third-party app: ExampleAI Coding.
4. Developer registers app public key and creates API key.
5. Developer declares requested channels:
   - codex.task.create
   - codex.task.cancel
   - codex.task.status
6. Developer copies consent URL.
7. User opens consent URL.
8. Musubi shows consent screen:
   - app name
   - publisher
   - verification status
   - requested Codex channels
   - security explanation
9. User selects Ethan MacBook Pro.
10. User approves channels.
11. Musubi creates durable grant.
12. ExampleAI sends encrypted codex.task.create.
13. Musubi validates grant and routes ciphertext.
14. Local CLI checks local policy and runs Codex plugin.
15. User opens Authorized Apps page.
16. User revokes ExampleAI access.
17. ExampleAI tries sending again.
18. Musubi rejects with GRANT_NOT_FOUND or GRANT_REVOKED.
19. User reports ExampleAI.
20. Operator suspends app.
21. App status shows suspended.
```

---

## 26. Key Risks and Mitigations

## 26.1 Risk: Trust Surface Explosion

Risk:

Opening third-party apps dramatically increases trust and abuse surface.

Mitigation:

- Start with limited developer beta.
- Label unverified apps clearly.
- Keep grants scoped to device/plugin/channel.
- Add revoke/report/suspend from day one.

## 26.2 Risk: Users Confuse App and Plugin Trust

Risk:

Users may think a trusted app makes any plugin safe, or a trusted plugin makes any app safe.

Mitigation:

UI must separate:

```text
App trust: who may ask
Grant: what they may ask
Plugin capability: what local code handles
Local policy: what actually runs
```

## 26.3 Risk: Consent Screen Too Complex

Risk:

Too many details cause users to blindly approve.

Mitigation:

Use layered UI:

```text
Summary first
Detailed channels second
Advanced metadata collapsed
```

## 26.4 Risk: In-memory State Leaks Back In

Risk:

Developer/publisher/app/consent state remains local verifier-only.

Mitigation:

M4.0 persistence hardening is mandatory before other M4 slices.

## 26.5 Risk: Third-party Apps Request Broad Channels

Risk:

Apps request too many channels.

Mitigation:

- Permission declaration reason required.
- Consent screen shows each channel.
- User can deselect channels.
- Queueing disabled by default.

## 26.6 Risk: Abuse Handling Is Too Weak

Risk:

Bad apps persist after reports.

Mitigation:

M4 includes report and suspend, even if review operations are manual.

---

## 27. Post-M4: M4.5 Handoff

After M4, Musubi should move to M4.5 Plugin Registry / Plugin Trust.

Reason:

M4 makes third-party apps able to ask. M4.5 must make local plugins safer to install and trust.

M4.5 should cover:

```text
plugin publisher identity
plugin package signing
manifest v2
permission review
trust levels
CLI install from registry
plugin update diff
workspace plugin policy
```

---

## 28. M4 Decision Summary

```text
M4 Theme:
  Third-party app platform with durable consent and scoped grants.

M4.0 mandatory foundation:
  Persist all platform trust state in Postgres.

Primary objects:
  Developer, Publisher, Third-party App, App Key, API Key, Permission Declaration, Consent Request, Grant, Abuse Report, Audit Event.

Primary UX:
  Developer Console, Consent Screen, Authorized Apps, Revoke/Report.

Security model:
  App can ask only after user consent.
  Grant is scoped to device/plugin/channel.
  Local policy still decides what runs.
  Musubi server still cannot read payloads.

Exit demo:
  External app requests Codex capability, user grants device/channel access, app sends encrypted task, user revokes access, future request fails, all state persists across restart.
```

