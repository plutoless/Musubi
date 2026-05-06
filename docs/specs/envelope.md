# M1 Envelope Spec

The Musubi envelope is the server-visible routing layer. It carries ciphertext and metadata required for authorization and delivery. The server must not require decrypted payload content to authorize, route, audit, or update status.

## Message Envelope

Required fields:

- `message_id`
- `workspace_id`
- `app_id`
- `device_id`
- `channel`
- `created_at`
- `expires_at`
- `crypto`
- `ciphertext`

`crypto` must include:

- `version`: `m1`
- `alg`: `x25519-xsalsa20-poly1305`
- `sender_key_id`
- `recipient_key_id`

## Result Envelope

Result/event envelopes include the same routing and crypto fields plus:

- `correlation_id`: original message ID

## Server-Visible Metadata

Allowed server-visible fields:

- workspace, app, device, channel, message IDs
- status
- timestamps and TTL
- key IDs and crypto algorithm
- payload size
- explicitly marked visible metadata

Disallowed server-visible fields by default:

- instructions
- file paths
- plugin parameters
- command contents
- result content
- artifact contents

## Replay Protection

The decrypted payload must include `nonce`, `message_id`, and a created/expires time. The CLI should reject duplicate message IDs or nonces within a short-lived cache.
