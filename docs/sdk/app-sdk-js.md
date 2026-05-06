# App SDK for TypeScript

The TypeScript SDK lives in `sdk/app-js` and is currently designed for local backend scripts on Bun or Node-compatible runtimes.

```ts
import { MusubiApp, echoPayload } from "./sdk/app-js/src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL!,
  appId: process.env.MUSUBI_APP_ID!,
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
  appKeyId: process.env.MUSUBI_APP_KEY_ID,
});

const [device] = await musubi.devices.listGranted();
const invocation = await musubi.invoke({
  deviceId: device.id,
  channel: "echo.echo",
  payload: echoPayload("hello"),
});

for await (const event of invocation.events()) {
  console.log(event.status, event.payload);
}

console.log(await invocation.result());
```

## Environment

- `MUSUBI_API_BASE_URL`: relay URL, for example `http://127.0.0.1:8787`
- `MUSUBI_APP_ID`: app identity
- `MUSUBI_APP_KEY_ID`: app encryption key id
- `MUSUBI_API_KEY`: app runtime API key secret
- `MUSUBI_APP_PRIVATE_KEY`: base64 X25519 private key held by the app

## Errors

The SDK normalizes common failures into `MusubiAuthError`, `MusubiGrantDeniedError`, `MusubiDeviceOfflineError`, `MusubiLocalPolicyDeniedError`, `MusubiPluginNotFoundError`, `MusubiMessageTimeoutError`, `MusubiDecryptError`, `MusubiCancelledError`, and `MusubiServerError`.
