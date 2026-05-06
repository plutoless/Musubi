# Send a Codex Task with the SDK

Grant the app `codex.task.create` and, if cancellation is needed, `codex.task.cancel`.

```ts
import { MusubiApp, invokeCodex } from "./sdk/app-js/src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL!,
  appId: process.env.MUSUBI_APP_ID!,
  apiKey: process.env.MUSUBI_API_KEY!,
  privateKey: process.env.MUSUBI_APP_PRIVATE_KEY!,
  appKeyId: process.env.MUSUBI_APP_KEY_ID,
});

const [device] = await musubi.devices.listGranted();
const invocation = await invokeCodex(musubi, device.id, "Inspect the current repo status", {
  workspaceHint: process.cwd(),
  maxDurationSeconds: 30,
});

for await (const event of invocation.events()) {
  console.log(event.payload);
}
```

To cancel:

```ts
await invocation.cancel({
  reason: "user stopped task",
  cancelChannel: "codex.task.cancel",
  payload: { type: "codex.task.cancel", body: { reason: "user stopped task" } },
});
```
