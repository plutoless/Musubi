import { MusubiApp, invokeHermes } from "../src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL ?? "http://127.0.0.1:8787",
  appId: required("MUSUBI_APP_ID"),
  apiKey: required("MUSUBI_API_KEY"),
  privateKey: required("MUSUBI_APP_PRIVATE_KEY"),
  appKeyId: process.env.MUSUBI_APP_KEY_ID,
});

const deviceId = process.env.MUSUBI_DEVICE_ID ?? (await musubi.devices.listGranted())[0]?.id;
if (!deviceId) throw new Error("no granted Musubi device found");

const invocation = await invokeHermes(musubi, deviceId, process.argv.slice(2).join(" ") || "Reply with exactly: sdk-hermes-ok", {
  workspaceHint: process.env.MUSUBI_WORKSPACE_HINT,
});

for await (const event of invocation.events()) {
  console.log(JSON.stringify(event.payload));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
