import { decryptPublicJson } from "./crypto.ts";
import { MusubiCancelledError, MusubiMessageTimeoutError, errorFromResponse } from "./errors.ts";
import type { InvocationEvent, MessageState, ResultEnvelope } from "./types.ts";

type RequestJson = <T>(path: string, options?: RequestInit) => Promise<T>;

const TERMINAL = new Set<MessageState>(["completed", "failed", "cancelled", "expired"]);

export class Invocation {
  readonly messageId: string;
  readonly deviceId: string;
  readonly channel: string;

  #requestJson: RequestJson;
  #privateKey: string;
  #devicePublicKey: string;
  #pollIntervalMs: number;
  #sendCancel?: (channel: string, payload: unknown) => Promise<unknown>;

  constructor(options: {
    messageId: string;
    deviceId: string;
    channel: string;
    privateKey: string;
    devicePublicKey: string;
    requestJson: RequestJson;
    pollIntervalMs: number;
    sendCancel?: (channel: string, payload: unknown) => Promise<unknown>;
  }) {
    this.messageId = options.messageId;
    this.deviceId = options.deviceId;
    this.channel = options.channel;
    this.#privateKey = options.privateKey;
    this.#devicePublicKey = options.devicePublicKey;
    this.#requestJson = options.requestJson;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.#sendCancel = options.sendCancel;
  }

  async *events<T = unknown>(options: { signal?: AbortSignal; untilTerminal?: boolean } = {}): AsyncGenerator<InvocationEvent<T>> {
    let cursor = 0;
    while (!options.signal?.aborted) {
      const response = await this.#requestJson<{
        status: MessageState;
        next_cursor: string;
        events: ResultEnvelope[];
      }>(`/v1/messages/${this.messageId}/events?cursor=${cursor}`);
      cursor = Number(response.next_cursor ?? cursor);
      for (const envelope of response.events) {
        yield this.#decodeEvent<T>(envelope);
      }
      if ((options.untilTerminal ?? true) && TERMINAL.has(response.status)) return;
      await sleep(this.#pollIntervalMs, options.signal);
    }
  }

  async result<T = unknown>(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    while (!options.signal?.aborted) {
      const response = await this.#requestJson<{
        status: MessageState;
        result?: ResultEnvelope;
      }>(`/v1/messages/${this.messageId}`);
      if (response.status === "completed" && response.result) {
        return this.#decodeEvent<T>(response.result).payload;
      }
      if (response.status === "cancelled") {
        throw new MusubiCancelledError("message was cancelled", { code: "MESSAGE_CANCELLED" });
      }
      if ((response.status === "failed" || response.status === "expired") && response.result) {
        return this.#decodeEvent<T>(response.result).payload;
      }
      if (response.status === "failed" || response.status === "expired") {
        throw errorFromResponse(409, { error: `message ${response.status}` });
      }
      if (Date.now() >= deadline) {
        throw new MusubiMessageTimeoutError("message did not reach a terminal state before timeout", { code: "MESSAGE_TIMEOUT" });
      }
      await sleep(this.#pollIntervalMs, options.signal);
    }
    throw new MusubiCancelledError("result wait was aborted", { code: "WAIT_ABORTED" });
  }

  async cancel(options: { reason?: string; cancelChannel?: string; payload?: unknown } = {}) {
    const response = await this.#requestJson<{ message_id: string; status: MessageState }>(`/v1/messages/${this.messageId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: options.reason ?? "cancelled by app" }),
    });
    if (options.cancelChannel && this.#sendCancel) {
      await this.#sendCancel(options.cancelChannel, options.payload ?? {
        type: options.cancelChannel,
        body: { reason: options.reason ?? "cancelled by app" },
      });
    }
    return response;
  }

  #decodeEvent<T>(envelope: ResultEnvelope): InvocationEvent<T> {
    return {
      messageId: envelope.message_id,
      status: envelope.status,
      channel: envelope.channel,
      payload: decryptPublicJson<T>(envelope.ciphertext, this.#privateKey, this.#devicePublicKey),
      envelope,
    };
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
