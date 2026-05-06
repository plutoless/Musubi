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

export interface MusubiAppOptions {
  apiBaseUrl: string;
  appId: string;
  apiKey: string;
  privateKey: string;
  workspaceId?: string;
  appKeyId?: string;
  pollIntervalMs?: number;
}

export interface GrantedDevice {
  id: string;
  name: string;
  status: string;
  platform?: string;
  workspace_id: string;
  allowed_channels: string[];
  queueing_allowed: boolean;
}

export interface InvokeOptions {
  deviceId: string;
  channel: string;
  payload: unknown;
  ttlSeconds?: number;
  messageId?: string;
}

export interface MessageEnvelope {
  message_id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  channel: string;
  visible_metadata: Record<string, string>;
  metadata: {
    trace_id: string;
    ttl_seconds: number;
    created_at: string;
  };
  crypto: {
    version: "m1";
    alg: "x25519-aes-256-gcm";
    sender_key_id: string;
    recipient_key_id: string;
  };
  ciphertext: string;
}

export interface ResultEnvelope {
  message_id: string;
  workspace_id: string;
  app_id: string;
  device_id: string;
  channel: string;
  status: MessageState;
  crypto: {
    version: string;
    alg: string;
    sender_key_id: string;
    recipient_key_id: string;
  };
  ciphertext: string;
}

export interface InvocationEvent<T = unknown> {
  messageId: string;
  status: MessageState;
  channel: string;
  payload: T;
  envelope: ResultEnvelope;
}
