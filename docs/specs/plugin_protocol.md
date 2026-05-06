# M1 Plugin Protocol Spec

M1 plugins communicate with the CLI using JSON-RPC 2.0 over stdio.

## Manifest

Each plugin provides `musubi.plugin.json` with:

- `name`
- `version`
- `description`
- `runtime`
- `entry`
- `channels`
- `permissions`
- optional `config_schema`

The CLI must load manifests before dispatch and must reject messages for undeclared channels.

## Methods

### `musubi.plugin.info`

The CLI asks the plugin for runtime info.

### `musubi.message.handle`

The CLI sends a decrypted and locally approved message to the plugin.

Required params:

- `message_id`
- `app_id`
- `channel`
- `payload`

Immediate result statuses:

- `completed`
- `failed`
- `accepted`

### `musubi.message.event`

Plugins may emit JSON-RPC notifications for streaming progress. The CLI encrypts each event before sending it to the app.

### `musubi.message.cancel`

The CLI asks a plugin to cancel a task by `correlation_id` and optional `task_id`.

## Error Hygiene

Plugin errors returned to the server must be sanitized. They may include local-safe codes such as `LOCAL_POLICY_DENIED` or `PLUGIN_FAILED`, but must not include decrypted instructions, file contents, secrets, or full command lines.
