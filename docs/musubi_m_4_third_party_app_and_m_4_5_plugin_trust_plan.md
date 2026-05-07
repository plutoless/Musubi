# Musubi M4 Third-party App Platform and M4.5 Plugin Registry / Trust Plan

## 0. Document Status

Draft for:

- `docs/third_party_app_platform_m4.md`
- `docs/plugin_registry_trust_m4_5.md`

This combined plan defines the product scope, trust model, consent flows, developer platform, plugin registry, plugin signing, permission review, APIs, implementation slices, and acceptance criteria for Musubi M4 and M4.5.

## 1. Roadmap Context

Previous milestones:

```text
M1: Encrypted Hermes local capability invocation
M2: Control Plane for devices/apps/grants/capabilities/messages/audit
M2.5: Real Codex adapter
M3: App SDK + user-owned app self-service
M3.5: Browser/session key model
```

M4 and M4.5 are where Musubi starts becoming a platform.

```text
M4: Third-party App Platform
M4.5: Plugin Registry / Plugin Trust
```

These milestones are related but should remain separate:

- M4 governs **who may ask** from outside Musubi/first-party apps.
- M4.5 governs **what local code may run** on the user's machine.

The core Musubi trust model remains:

```text
Cloud policy decides who may ask.
Local policy decides what may run.
Encryption ensures the server cannot read.
Plugins define what the machine can do.
```

## 2. M4 Goal: Third-party App Platform

M4 goal:

> Allow external developers to create Musubi Apps that users can authorize to access specific devices, plugins, and channels through a clear consent flow.

M4 turns Musubi from a first-party/user-owned integration layer into a controlled third-party app platform.

Concrete example:

```text
External AI Coding SaaS
  ↓ requests user authorization
Musubi Consent Screen
  ↓ user grants device/plugin/channel access
External App
  ↓ sends encrypted codex.task.create
Musubi Relay
  ↓ routes ciphertext to user device
Local CLI
  ↓ local policy check
Codex Plugin
```

M4 should prove:

1. Third-party developers can register apps.
2. Apps declare requested permissions/capabilities.
3. Users can review and authorize app access.
4. Grants are scoped to device/plugin/channel.
5. Users can revoke third-party access.
6. Third-party apps use App SDK / API keys safely.
7. Musubi can show trust warnings, app identity, publisher, and audit history.

## 3. M4.5 Goal: Plugin Registry / Plugin Trust

M4.5 goal:

> Let users safely discover, install, update, and trust local plugins through publisher identity, signed manifests, permission review, and workspace allowlists.

Concrete example:

```text
User installs Codex plugin from Musubi Registry
  ↓ plugin signature verified
CLI shows requested permissions
  ↓ user approves install
Device reports capability
  ↓ app can request grant to codex channels
```

M4.5 should prove:

1. Plugins have publisher identity.
2. Plugin packages/manifests are signed.
3. CLI verifies signatures.
4. Users can review requested permissions before install/update.
5. Control Plane shows plugin trust level.
6. Workspaces can allowlist official/verified plugins.
7. Plugin updates are explicit and safe.

## 4. Why M4 Before M4.5?

Recommended order:

```text
M4 first: third-party app consent and authorization
M4.5 next: plugin registry and plugin trust
```

Reason:

Musubi already has local plugins from earlier milestones. The immediate platform expansion risk is external apps asking for access.

M4 focuses on app-side trust:

```text
Who is asking?
What do they want?
Which device/plugin/channel do they need?
Can user revoke them?
```

M4.5 then focuses on local code trust:

```text
Who published this plugin?
What permissions does it request?
Is it signed?
Can the workspace allow it?
Can it be updated safely?
```

If both are built together too early, scope will explode.

## 5. M4 Non-goals

M4 does not include:

- Plugin registry
- Plugin signing
- Remote plugin installation
- Marketplace billing/revenue share
- Enterprise app approval workflow
- Full app review team operations
- Automated malware detection
- Public plugin ecosystem
- Full OAuth provider replacement
- Fine-grained human RBAC beyond existing workspace ownership
- Browser-only third-party private key model beyond M3.5 guidance

M4 is about third-party app registration, consent, grants, and revoke.

## 6. M4.5 Non-goals

M4.5 does not include:

- Third-party app consent flow, if not already done in M4
- Fully automated plugin security scanning
- WASM sandbox
- Remote plugin execution on server
- Rich plugin marketplace monetization
- Enterprise policy engine v2
- Cross-workspace private plugin distribution marketplace
- Complete supply chain attestation framework

M4.5 is about registry, signing, trust labels, install/update UX, and allowlists.

---

# Part A: M4 Third-party App Platform

## 7. M4 Product Thesis

Third-party apps are valuable because they let external products request local capabilities without asking users for SSH, VPN, full machine access, or raw credentials.

The key product shift:

```text
Not: Give this SaaS access to my computer.
But: Allow this SaaS to request these plugin channels on this device.
```

Example third-party apps:

- AI coding SaaS requesting `codex.task.create`
- QA tool requesting `test-runner.run`
- MCP agent platform requesting `mcp.tool.call`
- Diagnostics vendor requesting `diagnostics.collect`
- Data analysis SaaS requesting `local-query.run`
- Homelab dashboard requesting `docker.status`

## 8. M4 App Types

By M4, Musubi should distinguish these app types:

```text
first_party
user_owned
third_party
```

### first_party

Created and controlled by Musubi/Hermes operator.

Example:

```text
Hermes Companion
newbro backend
Musubi demo app
```

### user_owned

Created by a Musubi user for their own scripts/services.

Example:

```text
My Automation Script
My Personal Dashboard
```

### third_party

Created by an external developer/publisher for other users to authorize.

Example:

```text
ExternalAI Coding
Acme QA Cloud
Example Agent Platform
```

## 9. M4 Core Objects

M4 introduces or expands these objects:

```text
Developer Account
Publisher Profile
Third-party App
App Permission Declaration
Consent Request
User Authorization / Grant
App Trust Status
App Review Status
App Abuse Report
```

## 10. Developer / Publisher Model

## 10.1 Developer Account

A developer account represents a person or organization that can create third-party apps.

Fields:

```text
developer_id
user_id or organization_id
name
email
status
created_at
verified_at
suspended_at
```

## 10.2 Publisher Profile

A publisher profile is what users see during consent.

Fields:

```text
publisher_id
display_name
website
support_email
privacy_policy_url
terms_url
logo_url
verification_status
created_at
```

Verification statuses:

```text
unverified
verified
suspended
```

M4 can launch with unverified publishers but must label them clearly.

## 11. Third-party App Registration

## 11.1 Developer Flow

```text
Create developer account
  ↓
Create publisher profile
  ↓
Create third-party app
  ↓
Register app public key
  ↓
Declare requested plugin channels/permissions
  ↓
Configure redirect/callback URLs if needed
  ↓
Submit for basic review or publish as unverified/dev mode
```

## 11.2 Third-party App Fields

```text
app_id
workspace_id or platform_scope
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

M4 can start with:

```text
unverified + approved_by_user_consent
```

without a heavy app review operation.

## 12. Permission Declaration

Third-party apps should declare the capabilities they intend to request.

Example declaration:

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

Permission declaration does not grant access. It only informs consent UX and policy checks.

Actual grant is created after user selects device/plugin/channels.

## 13. Consent Flow

## 13.1 Consent Entry

Third-party app sends user to Musubi authorization URL:

```http
GET /oauth/authorize-like
  ?client_id=app_123
  &redirect_uri=https://thirdparty.example/callback
  &scope=local_capability
  &state=opaque_state
```

Musubi does not need to fully implement OAuth in M4, but the flow should be OAuth-like.

M4 can implement a simpler consent request object first.

## 13.2 Consent Screen

The user should see:

```text
ExampleAI wants to access local capabilities through Musubi.

Publisher:
ExampleAI Inc.
Verification: Unverified / Verified
Website: example.ai

Requested capabilities:
- Codex plugin
  - create coding tasks
  - cancel tasks
  - read task status

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
```

Primary actions:

```text
Authorize
Cancel
```

## 13.3 Consent Rules

Consent must require:

1. User is logged into Musubi.
2. Target device belongs to user/workspace.
3. Device is active.
4. Requested plugin capability is reported by device, or user explicitly accepts unsupported warning.
5. Requested channels are within app's declared capabilities, unless advanced override is enabled.
6. User confirms grant.

## 13.4 Consent Result

After consent, Musubi creates:

```text
app_device_channel_grant
```

and redirects back to app with:

```text
authorization_result
state
```

If using OAuth-like code flow later:

```text
authorization_code
```

M4 simple mode can use:

```text
consent_id + grant_id
```

The app then uses its app API key to call Musubi. User consent controls whether API calls to that device/channel are allowed.

## 14. Third-party App API Key Model

M4 should preserve the M3 rule:

```text
API key authenticates the app to Musubi server.
App private key decrypts device results.
```

For third-party apps:

- Developer creates app API keys.
- Developer stores API key on their backend.
- Developer stores app private key on their backend.
- Musubi stores app public key and API key hash.

Third-party browser-only app support should follow M3.5 backend/session-key guidance.

## 15. User Authorization Management

Users need a page for authorized third-party apps.

Route:

```text
/authorized-apps
```

or integrated under:

```text
/apps
```

Sections:

```text
First-party apps
User-owned apps
Third-party apps
```

For each third-party app:

```text
App name
Publisher
Trust status
Authorized devices
Allowed plugins/channels
Last used
Actions: view, revoke, report
```

## 16. Revoke Semantics for Third-party Apps

User can revoke:

1. One grant for one device.
2. All grants for one third-party app.
3. All third-party access.

Revoke behavior:

- Future messages using revoked grant fail.
- Existing running tasks may continue unless cancellation is explicitly sent.
- UI should offer: `Revoke and cancel active tasks` if feasible.

## 17. Abuse and Reporting

M4 minimum:

- User can report third-party app.
- Admin can suspend app.
- Suspended app cannot send new messages.
- Suspended app is clearly marked in UI.

Report reasons:

```text
misleading permissions
unexpected behavior
spam/abuse
security concern
other
```

## 18. M4 Data Model

## 18.1 developer_accounts

```sql
create table developer_accounts (
  id text primary key,
  owner_user_id text not null references users(id),
  name text not null,
  email text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  suspended_at timestamptz
);
```

## 18.2 publisher_profiles

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
  updated_at timestamptz
);
```

## 18.3 app_permission_declarations

```sql
create table app_permission_declarations (
  id text primary key,
  app_id text not null references apps(id),
  plugin_name text not null,
  channels text[] not null,
  reason text,
  queueing_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
```

## 18.4 consent_requests

```sql
create table consent_requests (
  id text primary key,
  app_id text not null references apps(id),
  user_id text references users(id),
  state text,
  redirect_uri text,
  requested_capabilities jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);
```

## 18.5 app_abuse_reports

```sql
create table app_abuse_reports (
  id text primary key,
  app_id text not null references apps(id),
  reporter_user_id text references users(id),
  reason text not null,
  description text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
```

## 19. M4 API Contracts

## 19.1 Create Developer Account

```http
POST /v1/developers
```

## 19.2 Create Publisher Profile

```http
POST /v1/publishers
```

## 19.3 Create Third-party App

```http
POST /v1/developer/apps
```

Request:

```json
{
  "name": "ExampleAI Coding",
  "type": "third_party",
  "publisher_id": "pub_123",
  "description": "Run coding tasks on your approved local machine.",
  "website": "https://example.ai",
  "privacy_policy_url": "https://example.ai/privacy",
  "public_key": "base64_app_public_key"
}
```

## 19.4 Declare App Capabilities

```http
POST /v1/developer/apps/{app_id}/permission-declarations
```

## 19.5 Start Consent Request

```http
POST /v1/consent-requests
```

or OAuth-like:

```http
GET /oauth/authorize
```

## 19.6 Complete Consent

```http
POST /v1/consent-requests/{id}/approve
```

Creates grant.

## 19.7 Revoke Third-party App Grant

```http
POST /v1/grants/{grant_id}/revoke
```

Already exists, but M4 UI/API should support third-party context.

## 19.8 Report App

```http
POST /v1/apps/{app_id}/report
```

## 20. M4 Control Plane UX

## 20.1 Developer Console

Routes:

```text
/developer
/developer/apps
/developer/apps/new
/developer/apps/:id
/developer/publisher
```

Developer app detail sections:

```text
Overview
API Keys
Encryption Keys
Permission Declarations
Consent URL
Usage
Review/Trust Status
```

## 20.2 User Consent UX

Route:

```text
/consent/:consent_request_id
```

Important sections:

```text
Who is asking?
What do they want?
Which device will receive requests?
Which plugin/channels are allowed?
What can Musubi see?
What can local policy still deny?
```

## 20.3 Authorized Apps UX

Route:

```text
/apps/authorized
```

or under app list with filters.

Show:

```text
Third-party app
Publisher
Trust status
Grants
Last used
Revoke
Report
```

## 21. M4 Implementation Slices

## Slice M4-0: Third-party App Product Contract

Deliverables:

- `docs/third_party_app_platform_m4.md`
- app type definitions
- consent UX wireframe
- permission declaration schema

Acceptance criteria:

- Team agrees third-party scope and trust language.

## Slice M4-1: Developer and Publisher Model

Deliverables:

- developer account table
- publisher profile table
- developer console basic pages

Acceptance criteria:

- User can create developer profile and publisher profile.

## Slice M4-2: Third-party App Registration

Deliverables:

- create third-party app API/UI
- app key/API key creation
- trust/review status fields

Acceptance criteria:

- Developer can create app with public key and API key.

## Slice M4-3: Permission Declarations

Deliverables:

- permission declaration table/API/UI
- plugin/channel declaration UX
- reason field

Acceptance criteria:

- App declares desired plugin/channels.

## Slice M4-4: Consent Request Flow

Deliverables:

- consent request creation
- consent screen
- device/plugin/channel selection
- approve/cancel
- grant creation

Acceptance criteria:

- User can authorize third-party app to a selected device/channel.

## Slice M4-5: Third-party Grant Enforcement

Deliverables:

- message authorization checks account for third-party app status/trust
- suspended/revoked apps blocked
- undeclared channels blocked or warned

Acceptance criteria:

- Third-party app can only send to authorized grants.
- Suspended app cannot send.

## Slice M4-6: Authorized Apps and Revoke UX

Deliverables:

- authorized apps page
- grant revoke
- revoke all app access
- audit events

Acceptance criteria:

- User can see and revoke third-party access.

## Slice M4-7: App Reporting and Suspension

Deliverables:

- report app flow
- admin suspend app action
- suspended app UI state

Acceptance criteria:

- User can report app.
- Suspended app is blocked.

## Slice M4-8: SDK and Docs Update

Deliverables:

- third-party app quickstart
- consent flow docs
- SDK docs for third-party backend

Acceptance criteria:

- External developer can register app and complete test consent.

## 22. M4 Acceptance Criteria

M4 is complete when:

1. External developer can create developer/publisher profile.
2. Developer can register a third-party app.
3. App can declare requested plugin/channels.
4. User can open consent screen.
5. User can select device/plugin/channels.
6. Musubi creates scoped grant.
7. Third-party app can send encrypted messages only to authorized device/channels.
8. User can revoke app/grant.
9. Revoked/suspended app cannot send messages.
10. Consent UI clearly explains app identity, publisher, permissions, encryption, local policy, and revoke.
11. Audit logs record consent/grant/revoke/message activity.

## 23. M4 Demo Script

```text
1. Developer creates publisher profile: ExampleAI.
2. Developer creates third-party app: ExampleAI Coding.
3. Developer declares desired channels:
   - codex.task.create
   - codex.task.cancel
   - codex.task.status
4. User opens consent link.
5. Musubi shows consent screen with publisher, trust status, requested capability.
6. User selects Ethan MacBook Pro and Codex plugin channels.
7. User authorizes.
8. Third-party app sends encrypted Codex task.
9. Device runs task through Codex plugin.
10. User opens Authorized Apps page.
11. User revokes ExampleAI access.
12. Third-party app tries again and is denied.
```

---

# Part B: M4.5 Plugin Registry / Plugin Trust

## 24. M4.5 Product Thesis

Once third-party apps can ask local machines to run capabilities, plugin trust becomes critical.

A malicious or overpowered plugin is more dangerous than a bad app because it runs locally.

M4.5 makes plugin installation and update safer through:

```text
publisher identity
signed plugin packages
permission manifest review
trust labels
workspace allowlists
explicit update flow
```

## 25. Plugin Trust Levels

Recommended trust levels:

```text
official
verified
community
local_dev
blocked
unknown
```

### official

Published by Musubi or first-party maintainers.

Examples:

```text
echo
hermes
codex
mcp
```

### verified

Publisher identity verified, plugin signed, reviewed at least basically.

### community

Published by community, signed, but not verified/reviewed.

### local_dev

Installed from local path. No registry trust.

### blocked

Known bad or policy-blocked plugin.

### unknown

Missing trust metadata.

## 26. Plugin Registry Objects

M4.5 introduces:

```text
Plugin Publisher
Plugin Package
Plugin Version
Plugin Manifest
Plugin Signature
Plugin Trust Status
Plugin Install Record
Workspace Plugin Policy
```

## 27. Plugin Manifest v2

M4.5 should extend manifest with publisher and signing metadata.

Example:

```json
{
  "name": "codex",
  "version": "0.2.0",
  "publisher": {
    "id": "pub_musubi",
    "name": "Musubi",
    "trust": "official"
  },
  "description": "Run Codex tasks on the local machine through Musubi",
  "runtime": "nodejs",
  "entry": "node ./dist/index.js",
  "channels": [
    "codex.task.create",
    "codex.task.cancel",
    "codex.task.status"
  ],
  "event_channels": [
    "codex.task.event"
  ],
  "permissions": [
    "process.spawn",
    "fs.read.project",
    "fs.write.project",
    "network.outbound"
  ],
  "config_schema": {},
  "signature": {
    "alg": "ed25519",
    "key_id": "pluginkey_123",
    "value": "base64_signature"
  }
}
```

## 28. Plugin Permissions

Permission categories remain important.

### Low risk

```text
status.report
system.notification
plugin.config.read
```

### Medium risk

```text
fs.read.project
fs.write.project
network.outbound
process.spawn.approved
```

### High risk

```text
fs.read.any
fs.write.any
process.spawn.any
screen.capture
clipboard.read
secret.read
browser.control
network.inbound
```

M4.5 install UX must display permissions clearly.

High-risk permissions should trigger stronger warnings and local confirmation.

## 29. Plugin Package Signing

## 29.1 Signing Model

Each plugin publisher has signing keys.

```text
publisher signing private key: held by publisher
publisher signing public key: registered in Musubi registry
```

Package signing:

1. Build plugin package.
2. Compute digest.
3. Sign digest + manifest.
4. Publish package + signature.
5. CLI downloads package.
6. CLI verifies signature against registry public key.

## 29.2 Signature Scope

Signature should cover:

```text
manifest
package digest
plugin name
version
publisher id
permissions
channels
entrypoint
```

Changing permissions or entrypoint invalidates signature.

## 29.3 CLI Verification

CLI install flow:

```text
musubi plugin install codex
  ↓
fetch registry metadata
  ↓
download package
  ↓
verify package digest
  ↓
verify signature
  ↓
show permissions
  ↓
user approves
  ↓
install plugin
```

If verification fails:

```text
install blocked by default
```

## 30. Plugin Install UX

CLI example:

```bash
musubi plugin install codex
```

Output:

```text
Plugin: codex
Publisher: Musubi
Trust: Official
Version: 0.2.0
Signature: verified

Channels:
- codex.task.create
- codex.task.cancel
- codex.task.status

Requested permissions:
- process.spawn
- fs.read.project
- fs.write.project
- network.outbound

Install? [y/N]
```

For high-risk plugin:

```text
Warning: This plugin requests high-risk permissions:
- process.spawn.any
- fs.write.any

Only install if you trust the publisher.
```

## 31. Plugin Update UX

Plugin updates must show diff:

```text
codex 0.2.0 -> 0.3.0

New channels:
+ codex.patch.apply

New permissions:
+ fs.write.any

Trust: Official
Signature: verified

Approve update? [y/N]
```

If permissions increase, require explicit approval.

If permissions unchanged, user may allow auto-update later, but M4.5 should keep updates explicit.

## 32. Workspace Plugin Policy

Workspace admins or users can define plugin policy.

M4.5 minimal policy:

```yaml
plugins:
  allowed_trust_levels:
    - official
    - verified
  blocked_plugins:
    - dangerous-plugin
  allowed_plugins:
    - codex
    - hermes
    - mcp
  require_signature: true
  require_approval_for_permission_increase: true
```

Control Plane should show:

```text
Workspace allows official and verified plugins.
Community plugins require manual approval.
Blocked plugins cannot be installed.
```

## 33. Plugin Registry UI

Routes:

```text
/plugins
/plugins/:name
/plugins/:name/versions
```

Plugin listing shows:

```text
Name
Publisher
Trust level
Description
Latest version
Permissions summary
Install command
```

Plugin detail shows:

```text
Overview
Channels
Permissions
Versions
Publisher
Signature/trust status
Install instructions
Security notes
```

## 34. Device Plugin UX Extensions

Device detail page should show installed plugin trust.

Fields:

```text
Plugin name
Version
Publisher
Trust level
Signature status
Install source
Permissions
Channels
Last reported
Update available
```

Install source values:

```text
registry
local_path
manual
unknown
```

## 35. M4.5 Data Model

## 35.1 plugin_publishers

```sql
create table plugin_publishers (
  id text primary key,
  display_name text not null,
  website text,
  verification_status text not null default 'unverified',
  trust_level text not null default 'community',
  created_at timestamptz not null default now(),
  suspended_at timestamptz
);
```

## 35.2 plugin_signing_keys

```sql
create table plugin_signing_keys (
  id text primary key,
  publisher_id text not null references plugin_publishers(id),
  public_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
```

## 35.3 plugin_packages

```sql
create table plugin_packages (
  id text primary key,
  name text not null,
  publisher_id text not null references plugin_publishers(id),
  description text,
  trust_level text not null default 'community',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

## 35.4 plugin_versions

```sql
create table plugin_versions (
  id text primary key,
  plugin_id text not null references plugin_packages(id),
  version text not null,
  manifest jsonb not null,
  package_url text not null,
  package_digest text not null,
  signature text not null,
  signing_key_id text not null references plugin_signing_keys(id),
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

## 35.5 device_plugin_installs

```sql
create table device_plugin_installs (
  id text primary key,
  workspace_id text not null references workspaces(id),
  device_id text not null references devices(id),
  plugin_name text not null,
  plugin_version text not null,
  publisher_id text,
  trust_level text,
  signature_status text,
  install_source text,
  permissions text[],
  channels text[],
  reported_at timestamptz not null default now()
);
```

## 35.6 workspace_plugin_policies

```sql
create table workspace_plugin_policies (
  id text primary key,
  workspace_id text not null references workspaces(id),
  require_signature boolean not null default true,
  allowed_trust_levels text[] not null,
  allowed_plugins text[],
  blocked_plugins text[],
  require_approval_for_permission_increase boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
```

## 36. M4.5 API Contracts

## 36.1 List Plugins

```http
GET /v1/plugins
```

## 36.2 Get Plugin

```http
GET /v1/plugins/{plugin_name}
```

## 36.3 Get Plugin Version

```http
GET /v1/plugins/{plugin_name}/versions/{version}
```

## 36.4 Publish Plugin Version

```http
POST /v1/developer/plugins/{plugin_name}/versions
```

## 36.5 Resolve Plugin Install

CLI endpoint:

```http
GET /v1/plugin-registry/resolve?name=codex&version=latest
```

Response:

```json
{
  "plugin": {
    "name": "codex",
    "version": "0.2.0",
    "publisher": {
      "id": "pub_musubi",
      "display_name": "Musubi",
      "trust_level": "official"
    },
    "manifest": {},
    "package_url": "https://...",
    "package_digest": "sha256:...",
    "signature": "base64...",
    "signing_public_key": "base64..."
  }
}
```

## 36.6 Report Plugin Install

CLI reports installed plugin trust metadata:

```http
POST /v1/devices/{device_id}/plugins/report
```

## 36.7 Workspace Plugin Policy

```http
GET /v1/workspace/plugin-policy
PATCH /v1/workspace/plugin-policy
```

## 37. M4.5 Implementation Slices

## Slice M4.5-0: Plugin Trust Contract

Deliverables:

- `docs/plugin_registry_trust_m4_5.md`
- trust levels
- manifest v2
- signing model
- install/update UX copy

Acceptance criteria:

- Team agrees plugin trust model.

## Slice M4.5-1: Registry Data Model

Deliverables:

- plugin publishers
- signing keys
- plugin packages
- plugin versions

Acceptance criteria:

- Official plugin metadata can be stored and queried.

## Slice M4.5-2: Plugin Resolve API

Deliverables:

- list/get/resolve plugin endpoints
- package digest/signature metadata

Acceptance criteria:

- CLI can resolve `codex@latest`.

## Slice M4.5-3: Plugin Signing Tooling

Deliverables:

- publisher signing key generation
- package digest generation
- manifest signing
- verification test vectors

Acceptance criteria:

- Signed plugin package verifies locally.

## Slice M4.5-4: CLI Registry Install

Deliverables:

- `musubi plugin install codex`
- download package
- verify digest
- verify signature
- show permission review
- install plugin

Acceptance criteria:

- Official signed plugin installs.
- Tampered package fails.
- Unsigned package blocked by default.

## Slice M4.5-5: Plugin Update Flow

Deliverables:

- update check
- permission diff
- explicit approval
- update install

Acceptance criteria:

- Permission-increasing update requires approval.

## Slice M4.5-6: Control Plane Plugin Registry UI

Deliverables:

- plugin list
- plugin detail
- plugin versions
- install instructions
- trust labels

Acceptance criteria:

- User can inspect official/verified/community plugin metadata.

## Slice M4.5-7: Device Installed Plugin Trust UI

Deliverables:

- device detail shows plugin trust/signature/source
- stale/unknown plugin warning
- update available indicator

Acceptance criteria:

- User can see whether installed plugin is official/signed/local.

## Slice M4.5-8: Workspace Plugin Policy

Deliverables:

- plugin policy table/API
- UI for allowed trust levels/blocklist
- CLI checks policy before install if available

Acceptance criteria:

- Workspace can block community/unsigned plugins.

## Slice M4.5-9: Publisher Plugin Publishing Flow

Deliverables:

- publisher can create plugin package entry
- upload plugin version metadata
- publish signed version

Acceptance criteria:

- Verified publisher can publish plugin version.

## 38. M4.5 Acceptance Criteria

M4.5 is complete when:

1. Official plugins can be published to registry.
2. Plugin packages have signed manifests and digests.
3. CLI can install registry plugin by name.
4. CLI verifies signature and digest.
5. CLI shows channels and permission review before install.
6. Tampered/unsigned plugin is blocked by default.
7. Device reports plugin trust metadata.
8. Control Plane shows installed plugin trust/signature/source.
9. Plugin update flow shows permission diff.
10. Workspace plugin policy can block untrusted plugins.
11. Audit records plugin install/update/report events.

## 39. M4.5 Demo Script

```text
1. Musubi publishes official Codex plugin v0.2.0.
2. CLI runs: musubi plugin install codex.
3. CLI shows publisher, trust level, signature verified, channels, permissions.
4. User approves install.
5. Device reports Codex plugin capability with official trust.
6. Control Plane device detail shows Codex plugin as Official / Signature verified.
7. Publish Codex v0.3.0 with new permission.
8. CLI update check shows permission diff.
9. User rejects update.
10. Workspace policy blocks community plugins.
11. Try installing unsigned community plugin.
12. CLI blocks install.
```

---

# Part C: Combined Risks and Sequencing

## 40. Key Risks

## 40.1 Trust Surface Explosion

Risk:

M4 + M4.5 expands trust surface dramatically.

Mitigation:

- Build M4 first around unambiguous scoped consent.
- Build M4.5 around signed official plugins first.
- Do not immediately launch open marketplace.

## 40.2 Users Confuse App and Plugin Trust

Risk:

Users may think authorizing a trusted app makes any plugin safe, or installing a trusted plugin makes any app safe.

Mitigation:

UI must separate:

```text
App trust: who may ask
Plugin trust: what local code may run
Grant: which app can ask which plugin/channel
Local policy: what this machine will allow
```

## 40.3 Malicious Third-party Apps

Mitigation:

- Clear consent
- Permission declaration
- User revoke
- App suspension
- Abuse reporting
- Trust labels

## 40.4 Malicious Plugins

Mitigation:

- Signing
- Permission manifest
- Trust labels
- Workspace allowlist
- Local confirmation
- Blocklist

## 40.5 Marketplace Scope Creep

Risk:

Platform work expands into billing, ranking, reviews, revenue share.

Mitigation:

M4/M4.5 should focus on trust infrastructure, not marketplace commercialization.

## 41. Recommended Sequencing

```text
M4.0 Product contract for third-party apps
M4.1 Developer/publisher profile
M4.2 Third-party app registration
M4.3 Permission declarations
M4.4 Consent flow
M4.5 User authorized apps/revoke/report

Then:

M4.5.0 Plugin trust contract
M4.5.1 Official registry metadata
M4.5.2 Signing/verification tooling
M4.5.3 CLI install from registry
M4.5.4 Control Plane plugin trust UI
M4.5.5 Workspace plugin policy
```

## 42. Final Decision Summary

```text
M4 Theme:
  Let third-party apps ask for scoped local capability access through user consent.

M4 Primary objects:
  Developer, Publisher, Third-party App, Permission Declaration, Consent Request, Grant, Authorized App, Abuse Report.

M4 Exit demo:
  External app requests Codex capability, user grants device/channel access, app sends encrypted task, user revokes access, future request fails.

M4.5 Theme:
  Make local plugin installation and updates trustworthy.

M4.5 Primary objects:
  Plugin Publisher, Plugin Package, Plugin Version, Signing Key, Trust Level, Install Record, Workspace Plugin Policy.

M4.5 Exit demo:
  User installs signed official Codex plugin from registry, sees permission review, device reports trusted plugin, tampered/unsigned plugin install is blocked.
```

