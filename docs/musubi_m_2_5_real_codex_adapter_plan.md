# Musubi M2.5 Real Codex Adapter Plan

## 0. Document Status

Draft for `docs/codex_adapter_m2_5.md`.

This document defines the scope, architecture, plugin design, permission model, task lifecycle, implementation slices, and acceptance criteria for Musubi M2.5: Real Codex Adapter.

## 1. M2.5 Goal

M1 proves encrypted app-to-local-Hermes invocation.

M2 makes Musubi understandable and controllable through the control plane.

M2.5 proves Musubi can support a real external coding-agent workflow without changing the Musubi core.

M2.5 goal:

> Build a real Codex plugin that lets an authorized app send an encrypted coding task to a user-owned machine, run Codex locally inside an approved workspace, stream progress/status back through Musubi, and return an encrypted final result.

The concrete demo:

```text
Musubi Web / Demo App
  ↓ encrypted codex.task.create
Musubi Relay
  ↓ opaque routing
Musubi CLI
  ↓ local policy check
Codex Plugin
  ↓ local Codex CLI workflow
Encrypted progress/result returned to app
```

## 2. Why M2.5 Codex Matters

Hermes proves first-party value.

Codex proves extensibility.

M2.5 should answer:

1. Can Musubi integrate a real external local agent without special core changes?
2. Can a plugin safely run a coding task in a local repo?
3. Can app/device/channel grants and local policy control the adapter?
4. Can progress/results return through the same encrypted Musubi message path?
5. Can the control plane explain what happened?

M2.5 should make Musubi feel like a general local capability layer, not a Hermes-only transport.

## 3. M2.5 Non-goals

M2.5 does not include:

- Full Codex product replacement
- Full Codex UI
- Remote desktop
- Arbitrary shell plugin
- Codex account management UI
- Codex model billing management
- Automatic Codex installation
- Remote plugin installation
- Third-party app marketplace
- Multi-agent orchestration
- Full artifact system
- Complex patch review UI
- Full sandboxing beyond Codex/local policy settings
- Supporting every Codex mode and config option

M2.5 should be a focused adapter, not a new coding platform.

## 4. Product Positioning

Do not position M2.5 as:

```text
Remote shell for Codex
Remote control for your dev machine
Cloud Codex runner
```

Position it as:

```text
Run approved local Codex tasks through encrypted Musubi messages.
```

Suggested one-liner:

> Musubi can invoke a local Codex capability on your own machine without giving the app full machine access.

Security copy:

> The app can request the Codex plugin channels you granted. Your local policy still decides which workspace and execution mode are allowed.

## 5. Target User

## 5.1 Individual Developer

Wants to trigger local Codex tasks from a web/mobile/app surface without exposing SSH or uploading the full repo.

Needs:

- Choose a local device
- Choose an allowed workspace
- Send task instruction
- See status/progress
- See final summary/result
- Cancel if needed
- Trust that access is scoped

## 5.2 Musubi Developer / Dogfood User

Wants to use Codex as the first external real adapter to validate plugin protocol, local policy, and control plane extensibility.

Needs:

- Debug plugin lifecycle
- Debug Codex invocation
- Inspect message timeline
- Confirm no Musubi core changes are required

## 6. Core Design Principle

Codex is a plugin, not a Musubi core feature.

Correct boundary:

```text
Musubi Core:
- app/device identity
- grants
- encrypted relay
- local policy
- plugin dispatch
- message status/audit

Codex Plugin:
- understands codex.* channels
- invokes local Codex CLI/workflow
- manages Codex task lifecycle
- maps Codex output to Musubi events
- handles cancellation best-effort
```

The CLI must not contain Codex-specific logic.

The server must not contain Codex-specific logic beyond generic channel/grant/capability display.

## 7. Scope Overview

M2.5 includes:

1. Codex plugin manifest
2. Codex plugin config
3. Codex task channels
4. Local workspace allowlist policy
5. Codex CLI detection
6. Codex task create
7. Codex task event streaming
8. Codex task status
9. Codex task cancel best-effort
10. Message/audit integration through existing M2 control plane
11. Demo app or existing app-side sender flow

## 8. Codex Plugin Channels

M2.5 channels:

```text
codex.task.create
codex.task.cancel
codex.task.status
codex.task.event
```

Optional later channels:

```text
codex.session.create
codex.session.attach
codex.session.list
codex.patch.preview
codex.patch.apply
codex.artifact.get
```

M2.5 should not start with session-oriented complexity unless the local Codex workflow requires it.

## 9. Codex Plugin Manifest

Example `plugins/codex/musubi.plugin.json`:

```json
{
  "name": "codex",
  "version": "0.1.0",
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
  "config_schema": {
    "codex_binary": {
      "type": "string",
      "required": false,
      "default": "codex"
    },
    "allowed_workspace_dirs": {
      "type": "array",
      "items": { "type": "string" },
      "required": true
    },
    "default_working_dir": {
      "type": "string",
      "required": false
    },
    "approval_mode": {
      "type": "string",
      "required": false,
      "enum": ["manual", "auto", "codex_default"],
      "default": "codex_default"
    },
    "sandbox_mode": {
      "type": "string",
      "required": false,
      "enum": ["read_only", "workspace_write", "codex_default"],
      "default": "codex_default"
    },
    "max_task_duration_seconds": {
      "type": "number",
      "required": false,
      "default": 3600
    }
  }
}
```

## 10. Local Policy

M2.5 local policy should be explicit about Codex.

Example:

```yaml
version: m1

defaults:
  require_local_confirm: true
  max_task_duration_seconds: 3600

apps:
  app_musubi_demo:
    name: Musubi Demo App
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
          - ~/workspace
        approval_mode: codex_default
        sandbox_mode: codex_default

plugins:
  codex:
    enabled: true
    permissions:
      - process.spawn
      - fs.read.project
      - fs.write.project
      - network.outbound
    config:
      codex_binary: codex
      default_working_dir: ~/projects
```

M2.5 policy checks:

1. App is allowed for codex plugin.
2. Channel is allowed.
3. Plugin is enabled.
4. Workspace path is provided or defaulted.
5. Workspace path resolves under allowed workspace directories.
6. Requested task duration does not exceed policy.
7. Requested sandbox/approval mode does not exceed policy.
8. Local confirmation is handled if required.

## 11. Payload Contracts

## 11.1 `codex.task.create`

Decrypted payload:

```json
{
  "type": "codex.task.create",
  "nonce": "random_32_bytes",
  "body": {
    "instruction": "Inspect this repo and suggest a fix for failing tests.",
    "workspace_hint": "~/projects/demo",
    "mode": "exec",
    "stream": true,
    "limits": {
      "max_duration_seconds": 3600
    },
    "codex_options": {
      "approval_mode": "codex_default",
      "sandbox_mode": "codex_default"
    }
  }
}
```

Required fields:

```text
instruction
```

Optional fields:

```text
workspace_hint
mode
stream
limits
codex_options
```

Notes:

- `workspace_hint` must be validated by local policy.
- `codex_options` should be constrained by local policy.
- Plugin must not blindly pass arbitrary unvalidated options to shell.

## 11.2 `codex.task.event`

Decrypted event payload:

```json
{
  "type": "codex.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "codex_task_123",
    "status": "running",
    "event_type": "progress",
    "message": "Running tests...",
    "timestamp": "2026-05-06T10:00:10Z"
  }
}
```

Event types:

```text
accepted
started
stdout
stderr
progress
warning
result
failed
cancelled
```

## 11.3 `codex.task.status`

Decrypted request payload:

```json
{
  "type": "codex.task.status",
  "body": {
    "task_id": "codex_task_123"
  }
}
```

Decrypted response payload:

```json
{
  "type": "codex.task.event",
  "body": {
    "task_id": "codex_task_123",
    "status": "running",
    "event_type": "status",
    "started_at": "2026-05-06T10:00:00Z",
    "updated_at": "2026-05-06T10:00:20Z"
  }
}
```

## 11.4 `codex.task.cancel`

Decrypted request payload:

```json
{
  "type": "codex.task.cancel",
  "body": {
    "task_id": "codex_task_123",
    "reason": "User requested cancellation"
  }
}
```

Cancel behavior:

- Best-effort in M2.5
- If Codex process is running as a child process, send graceful termination first.
- If graceful termination fails, optionally kill after timeout.
- Emit `cancelled` or `failed` event.

## 12. Codex Execution Strategy

M2.5 should start with the simplest reliable integration.

## 12.1 Option A: Spawn Codex CLI Process

Flow:

```text
Codex plugin receives codex.task.create
  ↓
validate local policy
  ↓
resolve workspace dir
  ↓
spawn Codex CLI process in workspace
  ↓
write instruction / pass args
  ↓
stream stdout/stderr as events
  ↓
return final result summary
```

Pros:

- Simple
- Clear process lifecycle
- Easy to cancel
- Does not require Codex server mode
- Good M2.5 starting point

Cons:

- Output may be semi-structured
- Progress parsing may be rough
- Approval prompts may require careful handling
- Long-running sessions may be limited

M2.5 recommendation: **start here**.

## 12.2 Option B: Attach to Existing Codex Session

Flow:

```text
Codex plugin discovers existing local Codex session
  ↓
attaches to session
  ↓
sends instruction
  ↓
streams session events
```

Pros:

- Better for interactive workflows
- Reuses user session context

Cons:

- More complex
- Depends on Codex session internals
- Harder to make stable

Recommendation: post-M2.5.

## 12.3 Option C: Codex Adapter Server

Flow:

```text
Codex plugin talks to local Codex adapter HTTP/stdio service
```

Pros:

- Clean lifecycle
- Better structured events

Cons:

- Requires building and running another local service

Recommendation: consider after process-spawn adapter proves demand.

## 13. Task Lifecycle

Internal Codex plugin task states:

```text
accepted
starting
running
waiting_for_approval
completed
failed
cancel_requested
cancelled
timeout
```

Mapping to Musubi message statuses:

```text
accepted/running -> processing
completed -> completed
failed/timeout -> failed
cancel_requested -> cancel_requested
cancelled -> cancelled
```

M2.5 should maintain an in-memory task registry inside the Codex plugin process.

Optional local persistence can be added later.

## 14. Streaming Semantics

M2.5 should support streaming events but avoid promising perfect real-time output.

Event transport:

```text
Codex plugin JSON-RPC notification
  ↓
Musubi CLI encrypts event to app public key
  ↓
Musubi relay routes event
  ↓
App receives/decrypts event
```

Event throttling:

- Avoid sending one event per tiny stdout chunk.
- Batch output by time or line count.
- Suggested default: flush every 500ms or 20 lines.

Event redaction:

- Do not redact inside plugin unless explicitly configured.
- Remember server cannot read encrypted event payload.
- But local logs should avoid storing raw Codex output by default.

## 15. Error Handling

Error codes:

```text
CODEX_NOT_INSTALLED
CODEX_AUTH_REQUIRED
WORKSPACE_NOT_ALLOWED
LOCAL_POLICY_DENIED
CODEX_PROCESS_FAILED
CODEX_TIMEOUT
CODEX_CANCELLED
CODEX_OUTPUT_PARSE_ERROR
UNKNOWN_ERROR
```

Safe server-visible error messages must not include decrypted instruction or raw output.

Example safe error:

```json
{
  "type": "message.error",
  "message_id": "msg_123",
  "error_code": "WORKSPACE_NOT_ALLOWED",
  "error_message": "Requested workspace is not allowed by local policy."
}
```

Encrypted plugin event may contain richer error details for the app if appropriate.

## 16. Control Plane Changes

M2 Control Plane should already support generic devices/apps/grants/capabilities/messages/audit.

M2.5 should require minimal or no control-plane schema changes.

Needed UI behavior:

1. Codex plugin appears under device capabilities.
2. Grant creation flow can select Codex plugin.
3. Grant creation flow can select Codex channels.
4. Message timeline shows `codex.task.create` lifecycle.
5. Message detail shows encrypted payload notice.
6. Audit shows grant/message events.

Optional M2.5 UI additions:

- Codex plugin setup hint
- Codex binary detected/not detected
- Workspace allowlist summary from local policy report
- Codex task demo page

## 17. CLI Changes

Musubi CLI should not add Codex-specific logic.

Required generic improvements:

1. Plugin config support
2. Long-running plugin process support
3. Streaming JSON-RPC notifications from plugin
4. Event encryption to app public key
5. Cancel routing to plugin
6. Plugin task lifecycle logging
7. Local policy path validation utilities

If these are implemented generically, Codex plugin can work without core special cases.

## 18. Plugin Runtime Requirements

For M2.5, the plugin runtime must support:

- Starting plugin process
- Keeping plugin process alive for long-running tasks
- Reading JSON-RPC responses and notifications
- Routing notifications back to Musubi CLI event pipeline
- Sending cancel requests to plugin
- Restarting crashed plugin if safe
- Capturing plugin stderr for local logs
- Not leaking decrypted payloads into server logs

## 19. Implementation Slices

## Slice 0: Codex Adapter Contract

Goal:

Define plugin contract before implementation.

Deliverables:

- `docs/codex_adapter_m2_5.md`
- Codex plugin manifest draft
- Channel definitions
- Payload schemas
- Error codes
- Local policy examples

Acceptance criteria:

- Codex channels fit existing grant model.
- Codex payloads fit existing encrypted envelope model.
- No Musubi core schema changes are required except optional capability metadata.

## Slice 1: Plugin Runtime Streaming Support

Goal:

Ensure Musubi CLI can handle plugin-emitted events.

Deliverables:

- JSON-RPC notification reader
- `musubi.message.event` support
- Event encryption path
- Event relay to app
- Status update integration

Acceptance criteria:

- Echo or test plugin can emit multiple streaming events.
- App receives/decrypts events.
- Server never sees plaintext.

## Slice 2: Generic Cancel Routing

Goal:

Route cancel requests from app/server to plugin.

Deliverables:

- `message.cancel` relay path
- CLI maps cancel to `musubi.message.cancel`
- Plugin can respond cancelled/failed
- Message status updates

Acceptance criteria:

- Test plugin can start long task and cancel it.
- Timeline shows cancel_requested → cancelled.

## Slice 3: Codex Plugin Skeleton

Goal:

Create plugin without real Codex invocation.

Deliverables:

- `plugins/codex/musubi.plugin.json`
- `codex.task.create` handler
- `codex.task.status` handler
- `codex.task.cancel` handler
- Mock streaming events

Acceptance criteria:

- Codex plugin appears in device capabilities.
- App can grant Codex channels.
- Mock Codex task roundtrip works encrypted E2E.

## Slice 4: Codex Environment Detection

Goal:

Detect whether Codex CLI is usable locally.

Deliverables:

- Config option for `codex_binary`
- `which codex` or equivalent lookup
- Version check if available
- Safe error if not installed
- Capability metadata includes detection status if useful

Acceptance criteria:

- If Codex is missing, plugin returns `CODEX_NOT_INSTALLED` safely.
- If Codex exists, plugin reports ready state locally.

## Slice 5: Workspace Policy Validation

Goal:

Prevent accidental arbitrary directory access.

Deliverables:

- Resolve `workspace_hint`
- Expand `~`
- Normalize symlinks as much as practical
- Check against `allowed_workspace_dirs`
- Reject disallowed paths

Acceptance criteria:

- Allowed repo path runs.
- Disallowed path fails with `WORKSPACE_NOT_ALLOWED`.
- Error does not leak sensitive path in server-visible logs.

## Slice 6: Real Codex Process Invocation

Goal:

Run a real Codex task locally.

Deliverables:

- Spawn Codex process in allowed workspace
- Pass task instruction safely
- Capture stdout/stderr
- Emit started/progress/result events
- Timeout handling
- Exit code handling

Acceptance criteria:

- App sends `codex.task.create`.
- Local Codex process runs in allowed workspace.
- Progress events return encrypted.
- Final result or failure returns encrypted.

## Slice 7: Cancellation

Goal:

Cancel a running Codex process best-effort.

Deliverables:

- Track running process by task ID
- Handle `codex.task.cancel`
- Send graceful signal
- Kill after timeout if configured
- Emit cancelled event

Acceptance criteria:

- User can cancel a long-running Codex task.
- Message timeline shows cancellation.
- Process is cleaned up.

## Slice 8: Control Plane Integration

Goal:

Make Codex adapter visible and controllable through M2 UI.

Deliverables:

- Codex capability display
- Grant flow works with Codex channels
- Message timeline works with Codex messages
- Audit works with Codex events
- Optional Codex setup warning if binary missing

Acceptance criteria:

- User can grant app access to Codex plugin.
- User can see Codex task status in messages.
- Revoke grant blocks future Codex tasks.

## Slice 9: Demo App / Sender Flow

Goal:

Create a clear demo path for Codex task invocation.

Deliverables:

- Demo UI or script to send Codex task
- Device selector
- Workspace hint input
- Instruction input
- Streaming event display
- Cancel button

Acceptance criteria:

- Demo can run from start to finish without manual API calls.

## Slice 10: Hardening

Goal:

Make the adapter safe enough for dogfood.

Deliverables:

- Output throttling
- Max task duration
- Max event size
- Process cleanup
- Local log redaction/default minimal logs
- Better error normalization
- Basic tests

Acceptance criteria:

- Plugin handles missing Codex, bad workspace, timeout, cancellation, and process failure.
- No plaintext is stored in server logs.

## 20. Acceptance Criteria

M2.5 is complete when:

1. Codex plugin can be installed locally.
2. Codex plugin reports capabilities to Musubi.
3. Control plane shows Codex plugin and channels on a device.
4. User can grant an app access to Codex channels.
5. App can send encrypted `codex.task.create` message.
6. CLI decrypts and validates local policy.
7. Codex plugin validates workspace allowlist.
8. Codex plugin invokes real Codex CLI in allowed workspace.
9. Progress/events return encrypted to app.
10. Final result returns encrypted to app.
11. Message timeline shows lifecycle.
12. Audit records are written without plaintext.
13. User can cancel a running Codex task best-effort.
14. Revoking the grant prevents future Codex tasks.
15. No Codex-specific logic is added to Musubi core relay/server.

## 21. M2.5 Demo Script

```text
1. Start Musubi hosted or local server.
2. Start Musubi CLI on Mac.
3. Install Codex plugin.
4. CLI reports Codex capability.
5. Open Musubi Control Plane.
6. Open device detail.
7. See Codex plugin:
   - codex.task.create
   - codex.task.cancel
   - codex.task.status
8. Create grant:
   - App: Musubi Demo App
   - Device: Ethan MacBook Pro
   - Plugin: codex
   - Channels: task.create, task.cancel, task.status
   - Queueing: disabled
9. Open Codex demo sender.
10. Select device.
11. Enter workspace hint: ~/projects/demo
12. Enter instruction: "Inspect this repo and explain why tests are failing."
13. Send task.
14. Watch message timeline:
    created → validated → delivered → received → processing → completed
15. Watch encrypted events decrypt in app UI.
16. Open audit page.
17. Show no plaintext payload in server UI.
18. Revoke Codex grant.
19. Send another Codex task.
20. Request is denied.
```

## 22. Testing Plan

## 22.1 Unit Tests

- Payload schema validation
- Workspace path validation
- Policy checks
- Error code mapping
- Process command builder
- Event batching

## 22.2 Integration Tests

- Mock Codex task create
- Mock streaming events
- Cancel long-running mock task
- Missing binary
- Disallowed workspace
- Timeout

## 22.3 End-to-End Tests

- Encrypted Codex task roundtrip with mock Codex binary
- Real Codex task if environment supports it
- Grant revoke blocks task
- Device revoke blocks task

## 23. Security Risks and Mitigations

## 23.1 Risk: Arbitrary command execution

Risk:

Codex plugin could become a generic shell wrapper.

Mitigation:

- Codex plugin only exposes structured `codex.*` channels.
- Plugin does not accept arbitrary command strings.
- Workspace allowlist required.
- Local policy constrains modes and duration.

## 23.2 Risk: Workspace escape

Risk:

Path tricks or symlinks could escape allowed directories.

Mitigation:

- Normalize and resolve workspace paths.
- Check against allowed directories.
- Be conservative if resolution fails.

## 23.3 Risk: Sensitive output in logs

Risk:

Codex output may contain code, secrets, or private data.

Mitigation:

- Server never sees plaintext event payloads.
- CLI local logs should not record raw decrypted payload/output by default.
- Provide verbose debug mode only locally.

## 23.4 Risk: Approval/sandbox confusion

Risk:

App may request a more permissive Codex mode than user expects.

Mitigation:

- Local policy defines maximum allowed approval/sandbox mode.
- Plugin rejects over-permissive request.
- Control plane shows plugin permissions and grant channels.

## 23.5 Risk: Long-running task resource usage

Risk:

Codex task consumes CPU/network for too long.

Mitigation:

- Max duration.
- Cancellation.
- Process cleanup.
- Optional max concurrent tasks per plugin.

## 24. Product Risks

## 24.1 Codex adapter overshadows Musubi

Risk:

Users think Musubi is just a Codex remote runner.

Mitigation:

- Keep Hermes and Echo examples visible.
- Explain Codex as one plugin.
- Use generic plugin/channel UX.

## 24.2 Adapter complexity slows core platform

Risk:

Codex CLI details consume too much time.

Mitigation:

- Start with process-spawn adapter.
- Do not support every Codex option.
- Define M2.5 acceptance around one reliable flow.

## 24.3 Demo depends on Codex environment

Risk:

Demo fails because Codex is not installed/authenticated.

Mitigation:

- Build detection and friendly error.
- Keep mock Codex mode for CI/demo fallback.
- Document setup clearly.

## 25. Post-M2.5 Roadmap

## 25.1 M3 App SDK

After Codex proves external adapter extensibility, build app-side SDK to simplify:

- key handling
- payload encryption
- envelope construction
- sending messages
- streaming event subscription
- result decryption
- retries/errors

## 25.2 M3 MCP Plugin

Build MCP plugin to show Musubi as a secure bridge to local MCP servers.

Channels:

```text
mcp.tool.list
mcp.tool.call
mcp.resource.read
```

## 25.3 M3.5 Artifact Transport

Add encrypted large payload/artifact path via R2 or equivalent.

## 26. M2.5 Decision Summary

```text
M2.5 Theme:
  Real external coding-agent adapter

Primary plugin:
  codex

Core proof:
  Musubi can run a real local Codex workflow without changing core relay/server/CLI semantics.

Execution strategy:
  Spawn Codex CLI process first.

Security model:
  App/device/channel grant + local policy + workspace allowlist + encrypted payload/result.

Control plane dependency:
  Uses M2 generic device/app/grant/capability/message/audit UX.

Exit