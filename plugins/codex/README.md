# Musubi Codex Plugin

The Codex plugin is the M2.5 coding-agent adapter. It receives decrypted `codex.task.*` payloads from the Musubi CLI over JSON-RPC stdio and runs an approved local Codex-compatible command inside an allowed workspace.

## Channels

- `codex.task.create`
- `codex.task.cancel`
- `codex.task.status`

App-bound progress and result envelopes use:

- `codex.task.event`

## Runtime Contract

By default the plugin returns deterministic simulated output for CI and local demos:

```text
codex simulated result: <instruction>
```

Set `CODEX_COMMAND`, `CODEX_COMMAND_JSON`, or `CODEX_BINARY` to run a local Codex runtime command. The plugin appends the decrypted instruction as the final argument and uses stdout as the result summary.
Use `CODEX_COMMAND_JSON` for commands that need exact argv boundaries.

Example deterministic runtime check:

```bash
CODEX_COMMAND="/bin/echo codex-runtime-ok" bun run plugins/codex/src/main.ts
```

Runtime failures are sanitized to:

```text
Codex runtime failed
```

Runtime hardening defaults:

- `CODEX_TIMEOUT_MS=10000`
- `CODEX_MAX_OUTPUT_BYTES=8192`
- `CODEX_ALLOWED_WORKSPACE_DIRS_JSON=["/allowed/repo"]`
- `CODEX_DEFAULT_WORKING_DIR=/allowed/repo`

Failure details are returned only inside the encrypted result body as structured fields such as `error_code`, `exit_code`, and `timed_out`.

Workspace policy:

- `workspace_hint` is resolved locally.
- If an allowlist is configured, the workspace must resolve under one of the allowed directories.
- A rejected workspace returns `WORKSPACE_NOT_ALLOWED`.
- A configured but missing `CODEX_BINARY` returns `CODEX_NOT_INSTALLED`.

The plugin emits JSON-RPC `musubi.message.event` notifications for accepted, started, stdout/stderr, result, failed, and cancelled task events. The CLI encrypts those notifications back to the app on `codex.task.event`.

## Verification

Run the local encrypted Codex flow:

```bash
bun run verify:slice12
```

Run the deterministic runtime adapter check:

```bash
bun run verify:slice12:runtime
```

Run the M1.6 negative-path hardening suite:

```bash
bun run verify:slice13
```

Run the M2.5 adapter verifier:

```bash
bun run verify:m2.5-codex
```
