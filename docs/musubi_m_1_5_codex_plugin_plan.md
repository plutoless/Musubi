# Musubi M1.5 Codex Plugin Plan

## 1. Goal

M1.5 proves that Musubi can support an external coding-agent adapter without changing the core CLI, relay, encryption envelope, grant model, or hosted Worker architecture proven in M1.

The concrete M1.5 demo:

```text
First-party coding app
  -> encrypted codex.task.create message
  -> Musubi relay
  -> Go CLI on user's machine
  -> local policy check
  -> Codex plugin
  -> local Codex CLI/runtime
  -> encrypted codex.task.event progress/result events back to app
```

M1.5 should demonstrate:

1. The Codex plugin declares capabilities through `musubi.plugin.json`.
2. The CLI reports Codex capabilities alongside existing plugins.
3. A first-party app can be granted access to Codex channels for one device.
4. The app can send an encrypted coding task to the device.
5. The server routes the message without reading the prompt, repo path, diff, logs, or result.
6. The CLI decrypts and validates the message through local policy.
7. The CLI dispatches to the Codex plugin over JSON-RPC stdio.
8. The Codex plugin can run a configured local Codex runtime command.
9. The plugin returns encrypted progress and final result events.
10. Message status, audit records, and plugin capabilities persist locally and in hosted Cloudflare/Neon mode.

## 2. Non-goals

M1.5 does not include:

- Remote plugin installation
- Public plugin marketplace
- Generic unrestricted shell execution
- Arbitrary background daemon orchestration
- Full artifact transport
- GitHub app installation
- Pull request creation
- Browser automation
- Multi-agent scheduling
- Team role management
- Billing or quota enforcement
- New relay protocol semantics
- New encryption envelope version

M1.5 should remain a plugin-bound coding-agent adapter, not a remote shell product.

## 3. Channels

M1.5 Codex channels:

```text
codex.task.create
codex.task.cancel
codex.task.status
codex.task.event
```

Server authorization uses the create/cancel/status channels in `app_device_channel_grants.allowed_channels`.

`codex.task.event` is app-bound and produced by the device/plugin as encrypted result or progress events.

## 4. Codex Plugin Manifest

Create:

```text
plugins/codex/musubi.plugin.json
plugins/codex/README.md
plugins/codex/src/main.ts
```

Manifest:

```json
{
  "name": "codex",
  "version": "0.1.0",
  "description": "Run Codex coding-agent tasks on the local machine",
  "runtime": "bun",
  "entry": "bun run plugins/codex/src/main.ts",
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
      "required": false
    },
    "codex_command": {
      "type": "string",
      "required": false
    }
  }
}
```

## 5. Payload Contracts

### 5.1 `codex.task.create`

Decrypted payload:

```json
{
  "type": "codex.task.create",
  "nonce": "random_32_bytes",
  "body": {
    "instruction": "Investigate why the test suite is failing and propose a fix.",
    "workspace_hint": "~/projects/demo",
    "mode": "agent",
    "stream": true
  }
}
```

Required fields:

- `type`
- `nonce`
- `body.instruction`

Optional fields:

- `body.workspace_hint`
- `body.mode`
- `body.stream`
- `body.max_duration_seconds`

### 5.2 `codex.task.event`

Progress payload:

```json
{
  "type": "codex.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "task_123",
    "status": "running",
    "event_type": "progress",
    "message": "Inspecting repository structure..."
  }
}
```

Final result payload:

```json
{
  "type": "codex.task.event",
  "correlation_id": "msg_123",
  "body": {
    "task_id": "task_123",
    "status": "completed",
    "event_type": "result",
    "summary": "Tests fail because...",
    "artifacts": []
  }
}
```

M1.5 keeps artifacts inline only when small. Large encrypted artifact transport stays post-M1.5.

## 6. Local Policy

Policy must allow Codex by app, plugin, and channel:

```yaml
version: m1

apps:
  app_codex:
    plugins:
      codex:
        allow:
          - codex.task.create
          - codex.task.cancel
          - codex.task.status
        require_local_confirm: true
        max_task_duration_seconds: 3600
        allowed_workspace_dirs:
          - ~/projects

plugins:
  codex:
    enabled: true
    permissions:
      - process.spawn
      - fs.read.project
      - fs.write.project
      - network.outbound
```

Acceptance behavior:

- Unknown app: reject.
- Disabled Codex plugin: reject.
- Denied channel: reject.
- Workspace hint outside `allowed_workspace_dirs`: reject.
- Request over `max_task_duration_seconds`: reject.
- `require_local_confirm: true`: terminal confirmation must approve before execution.

## 7. Implementation Slices

## Slice 1: Codex Plugin Skeleton

Deliverables:

- `plugins/codex/musubi.plugin.json`
- `plugins/codex/src/main.ts`
- `plugins/codex/README.md`
- Plugin responds to `musubi.plugin.info`.
- Plugin handles `codex.task.create`, `codex.task.cancel`, and `codex.task.status`.

Acceptance:

- CLI can run the Codex plugin over JSON-RPC stdio without server changes.
- Plugin returns deterministic simulated output when no runtime command is configured.

## Slice 2: CLI Capability Reporting and Dispatch

Deliverables:

- CLI discovers/reports Codex capabilities.
- CLI maps `codex.*` channels to the Codex plugin.
- CLI returns app-bound events on `codex.task.event`.

Acceptance:

- Capability API records Codex plugin channels.
- Encrypted `codex.task.create` reaches the Codex plugin.
- App decrypts progress and final result events.

## Slice 3: Codex Runtime Adapter

Deliverables:

- `CODEX_COMMAND` or plugin config controls the local Codex runtime command.
- Runtime stdout maps to final result summary.
- Runtime failure maps to sanitized failure result.

Acceptance:

- A verifier can run a deterministic command such as `/bin/echo codex-runtime-ok`.
- A verifier can run the real local Codex CLI when present.
- Errors do not leak sensitive local paths or prompts into server-visible audit metadata.

## Slice 4: Local Policy Coverage

Deliverables:

- Policy examples for Codex.
- Verifier for allowed Codex request.
- Verifier for denied workspace/channel/plugin/confirmation behavior.

Acceptance:

- Local policy remains the final execution gate.
- Server grant alone is insufficient to run Codex.

## Slice 5: Hosted Cloudflare/Neon Proof

Deliverables:

- Hosted verifier for encrypted `codex.task.create`.
- Neon checks for message status, audit events, app/device/grant rows, and Codex capability rows.

Acceptance:

- Deployed Worker routes encrypted Codex flow through Durable Object WebSocket.
- Neon has completed message status and plaintext-free audit rows.
- Device reconnect still works.

## 8. Verifier Plan

Add scripts:

```json
{
  "verify:slice12": "bun run tools/verify_slice12_codex.ts",
  "verify:slice12:runtime": "CODEX_COMMAND=\"/bin/echo codex-runtime-ok\" CODEX_EXPECT=\"codex-runtime-ok\" bun run tools/verify_slice12_codex.ts",
  "verify:slice12:deployed": "bun run tools/verify_slice12_codex_deployed.ts"
}
```

Verifier coverage:

- Contract checks for Codex manifest.
- Local encrypted Codex task through local relay.
- Local policy denial.
- Runtime command success.
- Runtime command failure.
- Hosted deployed Cloudflare/Neon proof.

## 9. Exit Criteria

M1.5 is complete when:

1. Codex plugin manifest, implementation, and README exist.
2. CLI reports Codex capabilities.
3. A first-party app can be granted `codex.task.create`.
4. A local app sender can encrypt a Codex task to the device public key.
5. Server routes the Codex task without plaintext.
6. CLI decrypts and local-policy checks the request.
7. CLI dispatches to Codex plugin over JSON-RPC stdio.
8. Codex plugin runs simulated and configured runtime commands.
9. App decrypts `codex.task.event` progress and final result.
10. Message status reaches `completed` or sanitized `failed`.
11. Audit rows contain no decrypted prompt, repo path, diff, logs, or result text.
12. Local and hosted deployed verifiers pass.

## 10. Open Decisions

- Whether the first real Codex runtime command should be `codex`, `codex exec`, or another stable local API.
- Whether Codex cancellation should kill a local process group in M1.5 or return a best-effort unsupported status.
- Whether workspace write permissions should require terminal confirmation by default.
- Whether Codex result artifacts should stay inline until M2.5 artifact transport or be represented as local-only references.
