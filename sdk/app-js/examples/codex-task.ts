import { MusubiApp, invokeCodex } from "../src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL ?? "http://127.0.0.1:8787",
  apiKey: required("MUSUBI_API_KEY"),
  privateKey: required("MUSUBI_APP_PRIVATE_KEY"),
});

const deviceId = process.env.MUSUBI_DEVICE_ID ?? (await musubi.devices.listGranted())[0]?.id;
if (!deviceId) throw new Error("no granted Musubi device found");

const invocation = await invokeCodex(musubi, deviceId, process.argv.slice(2).join(" ") || "Print sdk-codex-ok", {
  workspaceHint: process.env.MUSUBI_WORKSPACE_HINT ?? process.cwd(),
  maxDurationSeconds: 30,
});

for await (const event of invocation.events()) {
  console.log(JSON.stringify(event.payload));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
