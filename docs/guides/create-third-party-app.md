# Create a Third-party App

This guide shows the local M4 flow for an external app that asks a user to authorize scoped Codex access on one device.

Musubi routes encrypted messages. It does not receive plaintext task payloads, and the local device policy can still deny a request after cloud consent.

## Prerequisites

- A registered device.
- A relay running locally, for example `bun run server`.
- An app X25519 key pair created by the backend that will send messages.

For restart durability during local verification, set `MUSUBI_RELAY_STATE_PATH=.musubi/m4/relay-state.json` before starting the relay.

## Register Developer And Publisher

Create the developer account:

```sh
curl -sS http://127.0.0.1:8787/v1/developers \
  -H 'Content-Type: application/json' \
  -d '{"name":"ExampleAI Developer","email":"dev@example.test"}'
```

Create the publisher profile:

```sh
curl -sS http://127.0.0.1:8787/v1/publishers \
  -H 'Content-Type: application/json' \
  -d '{"developer_id":"devacct_001","display_name":"ExampleAI","website":"https://example.test","privacy_policy_url":"https://example.test/privacy"}'
```

Operators can update publisher verification state:

```sh
curl -sS -X PATCH http://127.0.0.1:8787/v1/publishers/pub_001 \
  -H 'Content-Type: application/json' \
  -d '{"verification_status":"verified"}'
```

## Create The App

Register the third-party app and receive an app API key. Store the API key only in the developer backend.

```sh
curl -sS http://127.0.0.1:8787/v1/developer/apps \
  -H 'Content-Type: application/json' \
  -d '{"name":"ExampleAI Coding","publisher_id":"pub_001","public_key":"BASE64_X25519_PUBLIC_KEY","privacy_policy_url":"https://example.test/privacy"}'
```

Create additional backend API keys as needed:

```sh
curl -sS http://127.0.0.1:8787/v1/developer/apps/app_001/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"Production backend"}'
```

## Declare Capabilities

Declare only the plugin channels the app will ask the user to authorize.

```sh
curl -sS http://127.0.0.1:8787/v1/developer/apps/app_001/permission-declarations \
  -H 'Content-Type: application/json' \
  -d '{"plugin_name":"codex","channels":["codex.task.create","codex.task.cancel","codex.task.status"],"reason":"Create and monitor scoped coding tasks"}'
```

## Start Consent

Create a consent request and send the user to the returned `consent_url`.

```sh
curl -sS http://127.0.0.1:8787/v1/consent-requests \
  -H 'Content-Type: application/json' \
  -d '{"app_id":"app_001","state":"opaque-state","redirect_uri":"https://example.test/callback"}'
```

The user opens `/control-plane#consent/consent_001`, reviews publisher identity, requested channels, eligible devices, and the end-to-end encryption notice, then approves or denies.

Approving creates a durable grant:

```sh
curl -sS http://127.0.0.1:8787/v1/consent-requests/consent_001/approve \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"dev_001","allowed_channels":["codex.task.create","codex.task.cancel","codex.task.status"]}'
```

## Send With The App SDK

The backend uses its app private key, app key id, and API key. Example shape:

```ts
import { MusubiApp, codexPayload } from "@musubi/app-sdk";

const app = new MusubiApp({
  apiBaseUrl: "http://127.0.0.1:8787",
  appId: "app_001",
  appKeyId: "appkey_001",
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
  workspaceId: "ws_local",
});

const invocation = await app.invoke({
  deviceId: "dev_001",
  channel: "codex.task.create",
  payload: codexPayload("Summarize the repository", {
    workspaceHint: "/path/to/workspace",
    maxDurationSeconds: 60,
  }),
});

const result = await invocation.result();
console.log(result.body);
```

The relay rejects messages for undeclared channels, ungranted channels, revoked grants, suspended publishers, and suspended apps.

## Revoke, Report, And Suspend

Users can inspect third-party access at `GET /v1/authorized-apps`, revoke a grant with `POST /v1/grants/{grant_id}/revoke`, and report an app with `POST /v1/apps/{app_id}/report`.

Operators can suspend an app with:

```sh
curl -sS -X POST http://127.0.0.1:8787/v1/apps/app_001/suspend
```

After revoke or suspension, future third-party sends fail before the device receives ciphertext.
