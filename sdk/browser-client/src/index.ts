export interface BrowserTaskClientOptions {
  baseUrl?: string;
  sessionToken?: string;
}

export interface StartTaskRequest {
  deviceId: string;
  channel: string;
  body: Record<string, unknown>;
}

export class MusubiBrowserTaskClient {
  #baseUrl: string;
  #sessionToken?: string;

  constructor(options: BrowserTaskClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "/api";
    this.#sessionToken = options.sessionToken;
  }

  async startTask(request: StartTaskRequest) {
    const response = await fetch(`${this.#baseUrl}/tasks`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        device_id: request.deviceId,
        channel: request.channel,
        body: request.body,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "Task start failed");
    return new BrowserTask(this.#baseUrl, body.task_session_id, this.#sessionToken);
  }

  async getTask(taskSessionId: string) {
    const response = await fetch(`${this.#baseUrl}/tasks/${encodeURIComponent(taskSessionId)}`, {
      headers: this.#headers(),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "Task fetch failed");
    return body;
  }

  #headers() {
    return {
      "Content-Type": "application/json",
      ...(this.#sessionToken ? { Authorization: `Bearer ${this.#sessionToken}` } : {}),
    };
  }
}

export class BrowserTask {
  constructor(
    public readonly baseUrl: string,
    public readonly id: string,
    private readonly sessionToken?: string,
  ) {}

  events() {
    const token = this.sessionToken ? `?token=${encodeURIComponent(this.sessionToken)}` : "";
    return new EventSource(`${this.baseUrl}/tasks/${encodeURIComponent(this.id)}/events${token}`);
  }

  async cancel() {
    const response = await fetch(`${this.baseUrl}/tasks/${encodeURIComponent(this.id)}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}` } : {}),
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "Task cancel failed");
    return body;
  }
}
