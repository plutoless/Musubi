import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const IDS = {
  workspaceId: "ws_demo",
  appId: "app_demo",
  deviceId: "dev_demo",
} as const;

export const allowedChannels = new Set(["echo.echo", "echo.ping"]);

export const demoKeys = {
  deviceRequestKey: Buffer.from(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "hex",
  ),
  appResultKey: Buffer.from(
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "hex",
  ),
};

export type MessageState =
  | "created"
  | "validated"
  | "queued"
  | "delivered"
  | "received"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "cancel_requested"
  | "cancelled";

export interface MessageEnvelope {
  message_id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  channel: string;
  metadata: {
    trace_id: string;
    ttl_seconds: number;
    created_at: string;
  };
  encryption: {
    alg: "musubi-demo-aes-256-gcm";
    key_id: string;
  };
  ciphertext: string;
}

export interface ResultEnvelope {
  message_id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  channel: string;
  status: "completed" | "failed";
  encryption: {
    alg: "musubi-demo-aes-256-gcm";
    key_id: string;
  };
  ciphertext: string;
}

export interface DeviceStatusUpdate {
  type: "device.status";
  message_id: string;
  status: Extract<MessageState, "received" | "processing">;
}

export interface EncryptedBox {
  nonce: string;
  tag: string;
  data: string;
}

export interface AppPayload {
  type: "task.create";
  body: {
    text?: string;
  };
}

export interface PluginResultPayload {
  type: "task.result";
  body: {
    ok: boolean;
    echo?: string;
    pong?: boolean;
    handled_by: "echo";
  };
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  runtime: string;
  entry: string;
  channels: string[];
  permissions: string[];
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export function encryptJson(value: unknown, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const box: EncryptedBox = {
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
  return Buffer.from(JSON.stringify(box), "utf8").toString("base64");
}

export function decryptJson<T>(ciphertext: string, key: Buffer): T {
  const box = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")) as EncryptedBox;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(box.nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function makeMessage(channel: string, payload: AppPayload): MessageEnvelope {
  return {
    message_id: `msg_${Date.now()}`,
    workspace_id: IDS.workspaceId,
    app_id: IDS.appId,
    device_id: IDS.deviceId,
    channel,
    metadata: {
      trace_id: `trace_${Date.now()}`,
      ttl_seconds: 300,
      created_at: new Date().toISOString(),
    },
    encryption: {
      alg: "musubi-demo-aes-256-gcm",
      key_id: "demo-device-key",
    },
    ciphertext: encryptJson(payload, demoKeys.deviceRequestKey),
  };
}

export function visibleEnvelopeLog(envelope: MessageEnvelope | ResultEnvelope) {
  return {
    message_id: envelope.message_id,
    workspace_id: envelope.workspace_id,
    app_id: envelope.app_id,
    device_id: envelope.device_id,
    channel: envelope.channel,
    ciphertext_bytes: Buffer.byteLength(envelope.ciphertext, "utf8"),
  };
}
