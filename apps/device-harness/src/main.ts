import { spawn } from "node:child_process";
import readline from "node:readline";
import {
  IDS,
  type AppPayload,
  type DeviceStatusUpdate,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MessageEnvelope,
  type PluginResultPayload,
  type ResultEnvelope,
  allowedChannels,
  demoKeys,
  decryptJson,
  encryptJson,
} from "../../../packages/protocol/src/index.ts";

const relay = process.env.MUSUBI_RELAY_WS ?? "ws://127.0.0.1:8787/v1/devices/dev_demo/connect";
const ws = new WebSocket(relay);

ws.addEventListener("open", () => {
  console.log("[device] connected", { relay });
});

ws.addEventListener("message", async (event) => {
  const envelope = JSON.parse(String(event.data)) as MessageEnvelope;
  sendStatus(envelope.message_id, "received");
  const result = await handleEnvelope(envelope);
  ws.send(JSON.stringify(result));
});

async function handleEnvelope(envelope: MessageEnvelope): Promise<ResultEnvelope> {
  console.log("[device] received envelope", {
    message_id: envelope.message_id,
    channel: envelope.channel,
  });

  if (!allowedChannels.has(envelope.channel)) {
    return encryptedFailure(envelope, "local policy denied channel");
  }

  try {
    const payload = decryptJson<AppPayload>(envelope.ciphertext, demoKeys.deviceRequestKey);
    sendStatus(envelope.message_id, "processing");
    const pluginResult = await callEchoPlugin(envelope.channel, payload);
    return {
      message_id: envelope.message_id,
      workspace_id: IDS.workspaceId,
      app_id: IDS.appId,
      device_id: IDS.deviceId,
      channel: envelope.channel,
      status: "completed",
      encryption: { alg: "musubi-demo-aes-256-gcm", key_id: "demo-app-key" },
      ciphertext: encryptJson(pluginResult, demoKeys.appResultKey),
    };
  } catch (error) {
    return encryptedFailure(envelope, error instanceof Error ? error.message : "unknown error");
  }
}

function sendStatus(messageId: string, status: DeviceStatusUpdate["status"]) {
  const update: DeviceStatusUpdate = {
    type: "device.status",
    message_id: messageId,
    status,
  };
  ws.send(JSON.stringify(update));
}

function encryptedFailure(envelope: MessageEnvelope, message: string): ResultEnvelope {
  const payload: PluginResultPayload = {
    type: "task.result",
    body: { ok: false, echo: message, handled_by: "echo" },
  };
  return {
    message_id: envelope.message_id,
    workspace_id: IDS.workspaceId,
    app_id: IDS.appId,
    device_id: IDS.deviceId,
    channel: envelope.channel,
    status: "failed",
    encryption: { alg: "musubi-demo-aes-256-gcm", key_id: "demo-app-key" },
    ciphertext: encryptJson(payload, demoKeys.appResultKey),
  };
}

function callEchoPlugin(channel: string, payload: AppPayload): Promise<PluginResultPayload> {
  const child = spawn("bun", ["run", "plugins/echo/src/main.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = readline.createInterface({ input: child.stdout });
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "echo.handle",
    params: { channel, payload },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("plugin timeout")), 5000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      child.kill();
      const response = JSON.parse(line) as JsonRpcResponse;
      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result as PluginResultPayload);
      }
    });
    child.once("error", reject);
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}
