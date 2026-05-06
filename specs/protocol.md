# Musubi Milestone 0 Protocol

Milestone 0 uses a prototype protocol that preserves the PRD trust boundary: server-visible envelopes route opaque ciphertext, while app/device payloads are encrypted with authenticated encryption outside server logic.

## Server-Visible Envelope

```json
{
  "message_id": "msg_demo_001",
  "workspace_id": "ws_demo",
  "app_id": "app_demo",
  "device_id": "dev_demo",
  "channel": "echo.echo",
  "metadata": {
    "trace_id": "trace_demo",
    "ttl_seconds": 300,
    "created_at": "2026-05-06T10:00:00Z"
  },
  "encryption": {
    "alg": "musubi-demo-aes-256-gcm",
    "key_id": "demo-device-key"
  },
  "ciphertext": "base64..."
}
```

The relay server may log or store routing metadata and ciphertext size. It must not decrypt or log the decrypted payload or decrypted result.

## Encrypted Request Payload

```json
{
  "type": "task.create",
  "body": {
    "text": "hello from musubi"
  }
}
```

## Encrypted Result Payload

```json
{
  "type": "task.result",
  "body": {
    "ok": true,
    "echo": "hello from musubi",
    "handled_by": "echo"
  }
}
```

## Prototype Crypto

This milestone uses a documented prototype authenticated-encryption adapter, `musubi-demo-aes-256-gcm`, with static demo keys shared by the app simulator and CLI. This is real authenticated encryption, but it is not the PRD's final public-key design. Milestone 1 should replace it with app/device public-key encryption and local key storage.
