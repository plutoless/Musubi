import { encryptPublicJson, publicKeyFromPrivateKey } from "./crypto.ts";
import { errorFromResponse } from "./errors.ts";
import { Invocation } from "./invocation.ts";
import type { GrantedDevice, InvokeOptions, MessageEnvelope, MusubiAppOptions } from "./types.ts";

export class MusubiApp {
  readonly apiBaseUrl: string;
  readonly appId: string;
  readonly privateKey: string;
  readonly workspaceId: string;
  readonly appPublicKey: string;

  #apiKey: string;
  #appKeyId: string;
  #pollIntervalMs: number;

  devices = {
    listGranted: async () => {
      const response = await this.#requestJson<{ devices: GrantedDevice[] }>("/v1/app/devices");
      return response.devices;
    },
  };

  constructor(options: MusubiAppOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.appId = options.appId;
    this.#apiKey = options.apiKey;
    this.privateKey = options.privateKey;
    this.workspaceId = options.workspaceId ?? "ws_local";
    this.#appKeyId = options.appKeyId ?? "appkey_001";
    this.#pollIntervalMs = options.pollIntervalMs ?? 75;
    this.appPublicKey = publicKeyFromPrivateKey(options.privateKey);
  }

  async invoke(options: InvokeOptions): Promise<Invocation> {
    const key = await this.#requestJson<{
      device_key_id: string;
      public_key: string;
      allowed_channels: string[];
    }>(`/v1/app/devices/${options.deviceId}/public-key`);
    if (!key.allowed_channels.includes(options.channel)) {
      throw errorFromResponse(403, { error: "channel denied" });
    }
    const messageId = options.messageId ?? `msg_sdk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const envelope: MessageEnvelope = {
      message_id: messageId,
      workspace_id: this.workspaceId,
      app_id: this.appId,
      device_id: options.deviceId,
      channel: options.channel,
      visible_metadata: {
        app_public_key: this.appPublicKey,
      },
      metadata: {
        trace_id: `trace_${messageId}`,
        ttl_seconds: options.ttlSeconds ?? 300,
        created_at: new Date().toISOString(),
      },
      crypto: {
        version: "m1",
        alg: "x25519-aes-256-gcm",
        sender_key_id: this.#appKeyId,
        recipient_key_id: key.device_key_id,
      },
      ciphertext: encryptPublicJson(options.payload, this.privateKey, key.public_key),
    };
    await this.#requestJson("/v1/messages", {
      method: "POST",
      body: JSON.stringify(envelope),
    });
    return new Invocation({
      messageId,
      deviceId: options.deviceId,
      channel: options.channel,
      privateKey: this.privateKey,
      devicePublicKey: key.public_key,
      requestJson: this.#requestJson.bind(this),
      pollIntervalMs: this.#pollIntervalMs,
      sendCancel: async (channel, payload) => {
        const cancelInvocation = await this.invoke({ deviceId: options.deviceId, channel, payload });
        return cancelInvocation.result({ timeoutMs: 5_000 }).catch(() => undefined);
      },
    });
  }

  async #requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.#apiKey}`,
        ...(options.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw errorFromResponse(response.status, body);
    return body as T;
  }
}
