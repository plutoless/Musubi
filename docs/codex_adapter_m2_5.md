# Musubi M2.5 Codex Adapter

M2.5 proves that Codex is a Musubi plugin, not a Musubi core feature.

Preferred framing:

```text
Run approved local Codex tasks through encrypted Musubi messages.
```

The app can request the Codex plugin channels you granted. Your local policy still decides which workspace and execution mode are allowed.

## Channels

Device-bound channels:

```text
codex.task.create
codex.task.cancel
codex.task.status
```

App-bound event channel:

```text
codex.task.event
```

The relay and control plane treat these as ordinary plugin channels. They do not inspect decrypted Codex task instructions or output.

## Task Payloads

`codex.task.create` decrypted body:

```json
{
  "instruction": "Inspect this repo and explain why tests fail.",
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
```

Only `instruction` is required. `workspace_hint` is resolved locally and must fall under the configured allowlist when an allowlist is present.

`codex.task.status` decrypted body:

```json
{
  "task_id": "codex_task_123"
}
```

`codex.task.cancel` decrypted body:

```json
{
  "task_id": "codex_task_123",
  "reason": "User requested cancellation"
}
```

## Events

The plugin may emit JSON-RPC `musubi.message.event` notifications. The CLI encrypts them back to the app on `codex.task.event`.

Event payload body:

```json
{
  "task_id": "codex_task_123",
  "status": "running",
  "event_type": "stdout",
  "message": "Running tests...",
  "timestamp": "2026-05-06T10:00:10Z"
}
```

Event types used by M2.5:

```text
accepted
started
stdout
stderr
progress
result
failed
cancelled
status
```

## Local Policy

Example `policy.yaml`:

```yaml
version: m1
apps:
  app_001:
    plugins:
      codex:
        allow:
          - codex.task.create
          - codex.task.cancel
          - codex.task.status
        require_local_confirm: false
        allowed_workspace_dirs:
          - ~/projects
        max_task_duration_seconds: 3600
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
      allowed_workspace_dirs:
        - ~/projects
```

Policy checks:

- App is allowed for the Codex plugin.
- Channel is granted locally and in cloud policy.
- Plugin is enabled and all manifest permissions are allowed.
- Workspace path is provided or defaulted when an allowlist exists.
- Workspace path resolves under `allowed_workspace_dirs`.
- Requested task duration and Codex modes do not exceed local policy.

## Runtime

The M2.5 adapter starts with a process-spawn strategy. Configure one of:

```text
CODEX_COMMAND_JSON=["/path/to/codex-compatible-command","arg"]
CODEX_COMMAND="/path/to/codex-compatible-command arg"
CODEX_BINARY=codex
```

For CI and demos, leaving those unset keeps the deterministic mock behavior:

```text
codex simulated result: <instruction>
```

If `CODEX_BINARY` is set and cannot be found, the plugin returns `CODEX_NOT_INSTALLED`.

## Errors

Sanitized error codes:

```text
CODEX_NOT_INSTALLED
CODEX_AUTH_REQUIRED
WORKSPACE_NOT_ALLOWED
LOCAL_POLICY_DENIED
CODEX_PROCESS_FAILED
CODEX_TIMEOUT
CODEX_CANCELLED
CODEX_TASK_INVALID
CODEX_TASK_NOT_FOUND
UNKNOWN_ERROR
```

Server-visible message status and audit metadata must not include decrypted instructions, Codex stdout, Codex stderr, or workspace-private content. Richer details may appear only inside encrypted app-bound result/event payloads.

## Verification

Run:

```bash
bun run verify:m2.5-codex
```

The verifier proves:

- Codex manifest declares task and event channels.
- Workspace allowlist policy rejects disallowed paths with `WORKSPACE_NOT_ALLOWED`.
- Missing configured binary returns `CODEX_NOT_INSTALLED`.
- A Codex-compatible process runs in an allowed workspace.
- Progress/result events are encrypted back to the app.
- Message timeline and audit stay payload-opaque.
- Cancellation records `cancel_requested` and `cancelled` without being overwritten by late plugin output.
- Revoking a grant blocks future Codex tasks.
