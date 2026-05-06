# Send a Hermes Task with the SDK

Grant the app `hermes.task.create` for a device, then run:

```ts
import { MusubiApp, invokeHermes } from "./sdk/app-js/src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL!,
  appId: process.env.MUSUBI_APP_ID!,
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
  appKeyId: process.env.MUSUBI_APP_KEY_ID,
});

const [device] = await musubi.devices.listGranted();
const invocation = await invokeHermes(musubi, device.id, "Reply with exactly: hermes-ok");

console.log(await invocation.result());
```

The SDK encrypts the instruction to the device key and decrypts the encrypted Hermes result locally.
