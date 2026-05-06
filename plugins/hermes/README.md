# Hermes Plugin

The Hermes plugin is the M1 first real capability surface. It implements the Musubi JSON-RPC over stdio plugin protocol and supports:

- `musubi.plugin.info`
- `musubi.message.handle`
- `hermes.task.create`
- `hermes.task.cancel`
- `hermes.task.status`

## Runtime Adapter

By default, the plugin returns a simulated result:

```text
hermes simulated result: <instruction>
```

Set `HERMES_COMMAND` to invoke a local Hermes-compatible runtime:

```bash
HERMES_COMMAND="/path/to/hermes-runner --json" bun run plugins/hermes/src/main.ts
```

On this machine, a Hermes CLI is available at:

```bash
/Users/zhangqianze/.local/bin/hermes
```

Its non-interactive mode is:

```bash
HERMES_COMMAND="/Users/zhangqianze/.local/bin/hermes -z"
```

The plugin appends the task instruction as the final argument.

Runtime contract:

- Exit code `0` means success.
- Stdout is returned as the task result body.
- Non-zero exit returns a sanitized `Hermes runtime failed` message.
- Stderr is not exposed to the Musubi server or app result by default.

This keeps Hermes-specific execution inside the plugin. The CLI and relay only see plugin channels, encrypted envelopes, and sanitized status.

## Verification

The runtime seam is verified with:

```bash
bun run verify:slice10
```

That verifier sets:

```text
HERMES_COMMAND="/bin/echo hermes-runtime"
```

and confirms the encrypted app-to-device-to-plugin result includes the runtime command output.

To verify the real Hermes CLI path on this machine:

```bash
bun run verify:slice10:hermes
```

That command uses:

```text
HERMES_COMMAND="/Users/zhangqianze/.local/bin/hermes -z"
```

and expects the decrypted result to include `hermes-runtime-ok`. This verifier requires the local Hermes CLI to be authenticated and able to reach its configured model provider.
