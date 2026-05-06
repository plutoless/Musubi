# Musubi Codex Plugin

The Codex plugin is the M1.5 coding-agent adapter. It receives decrypted `codex.task.*` payloads from the Musubi CLI over JSON-RPC stdio and runs a configured local Codex-compatible command.

## Channels

- `codex.task.create`
- `codex.task.cancel`
- `codex.task.status`

App-bound progress and result envelopes use:

- `codex.task.event`

## Runtime Contract

By default the plugin returns deterministic simulated output:

```text
codex simulated result: <instruction>
```

Set `CODEX_COMMAND` to run a local Codex runtime command. The plugin appends the decrypted instruction as the final argument and uses stdout as the result summary.

Example deterministic runtime check:

```bash
CODEX_COMMAND="/bin/echo codex-runtime-ok" bun run plugins/codex/src/main.ts
```

Runtime failures are sanitized to:

```text
Codex runtime failed
```

## Verification

Run the local encrypted Codex flow:

```bash
bun run verify:slice12
```

Run the deterministic runtime adapter check:

```bash
bun run verify:slice12:runtime
```
