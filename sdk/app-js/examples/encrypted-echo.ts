import { MusubiApp, echoPayload } from "../src/index.ts";

const musubi = new MusubiApp({
  apiBaseUrl: process.env.MUSUBI_API_BASE_URL ?? "http://127.0.0.1:8787",
  apiKey: required("MUSUBI_API_KEY"),
  privateKey: required("MUSUBI_APP_PRIVATE_KEY"),
});

const deviceId = process.env.MUSUBI_DEVICE_ID ?? (await musubi.devices.listGranted())[0]?.id;
if (!deviceId) throw new Error("no granted Musubi device found");

const invocation = await musubi.invoke({
  deviceId,
  channel: "echo.echo",
  payload: echoPayload(process.argv.slice(2).join(" ") || "hello from Musubi App SDK"),
});

console.log(JSON.stringify(await invocation.result(), null, 2));

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
