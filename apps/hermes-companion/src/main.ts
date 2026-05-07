import { createMusubiEventBridge, hermesPayload, MusubiApp, normalizeMusubiError } from "../../../sdk/app-js/src/index.ts";
import type { Invocation } from "../../../sdk/app-js/src/index.ts";

type TaskStatus = "created" | "starting" | "running" | "completed" | "failed" | "cancel_requested" | "cancelled";
type AppTaskEventType = "task.status" | "task.progress" | "task.result" | "task.error";

interface AppTaskEvent {
  id: number;
  type: AppTaskEventType;
  data: Record<string, unknown>;
  created_at: string;
}

interface AppTaskSession {
  id: string;
  user_id: string;
  app_id: string;
  device_id: string;
  plugin_name: string;
  channel: string;
  musubi_message_id?: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  failed_at?: string;
  error_code?: string;
  error_message?: string;
  final_summary?: string;
  invocation?: Invocation;
  bridge?: ReturnType<typeof createMusubiEventBridge>;
  events: AppTaskEvent[];
  subscribers: Set<(event: AppTaskEvent) => void>;
}

export function startHermesCompanion(options: { hostname?: string; port?: number; musubi?: MusubiApp; userToken?: string } = {}) {
  const userToken = options.userToken ?? process.env.HERMES_COMPANION_USER_TOKEN ?? "dev-user-token";
  const musubi = options.musubi ?? new MusubiApp({
    apiBaseUrl: requiredEnv("MUSUBI_API_BASE_URL"),
    apiKey: requiredEnv("MUSUBI_API_KEY"),
    privateKey: requiredEnv("MUSUBI_APP_PRIVATE_KEY"),
    workspaceId: process.env.MUSUBI_WORKSPACE_ID ?? "ws_local",
  });
  const sessions = new Map<string, AppTaskSession>();
  let nextEventId = 1;

  function requireUser(req: Request, url?: URL): string | Response {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${userToken}` || url?.searchParams.get("token") === userToken) return "user_demo";
    return Response.json({ error: "authentication required" }, { status: 401 });
  }

  function publicSession(session: AppTaskSession) {
    return {
      id: session.id,
      device_id: session.device_id,
      plugin_name: session.plugin_name,
      channel: session.channel,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      completed_at: session.completed_at,
      failed_at: session.failed_at,
      error_code: session.error_code,
      error_message: session.error_message,
      final_summary: session.final_summary,
    };
  }

  function getOwnedSession(req: Request, id: string, url?: URL): AppTaskSession | Response {
    const user = requireUser(req, url);
    if (user instanceof Response) return user;
    const session = sessions.get(id);
    if (!session || session.user_id !== user) return Response.json({ error: "task not found" }, { status: 404 });
    return session;
  }

  function publish(session: AppTaskSession, type: AppTaskEventType, data: Record<string, unknown>) {
    const event: AppTaskEvent = {
      id: nextEventId,
      type,
      data,
      created_at: new Date().toISOString(),
    };
    nextEventId += 1;
    session.events.push(event);
    for (const subscriber of session.subscribers) subscriber(event);
  }

  function updateStatus(session: AppTaskSession, status: TaskStatus) {
    session.status = status;
    session.updated_at = new Date().toISOString();
    if (status === "completed") session.completed_at = session.updated_at;
    if (status === "failed") session.failed_at = session.updated_at;
    publish(session, "task.status", { status });
  }

  function mapPayloadToBrowserEvent(payload: any): { type: AppTaskEventType; data: Record<string, unknown> } {
    const body = payload?.body ?? {};
    if (body.event_type === "result" || payload?.type === "task.result") {
      return {
        type: "task.result",
        data: {
          status: body.status ?? "completed",
          summary: body.echo ?? body.message ?? "",
          event_type: body.event_type ?? "result",
        },
      };
    }
    if (body.ok === false || body.error_code) {
      return {
        type: "task.error",
        data: browserSafeError(body.error_code ?? "PLUGIN_ERROR", body.echo ?? body.message ?? "Task failed"),
      };
    }
    return {
      type: "task.progress",
      data: {
        status: body.status ?? "running",
        message: body.message ?? body.echo ?? "Hermes task update",
        event_type: body.event_type ?? payload?.type ?? "progress",
      },
    };
  }

  async function startTask(req: Request): Promise<Response> {
    const user = requireUser(req);
    if (user instanceof Response) return user;
    const body = await req.json().catch(() => ({})) as {
      device_id?: string;
      channel?: string;
      body?: {
        instruction?: string;
        workspace_hint?: string;
        stream?: boolean;
      };
    };
    const deviceId = body.device_id;
    const channel = body.channel ?? "hermes.task.create";
    const instruction = body.body?.instruction ?? "";
    if (!deviceId) return Response.json({ error: "device_id required" }, { status: 400 });
    if (!instruction.trim()) return Response.json({ error: "instruction required" }, { status: 400 });
    if (channel !== "hermes.task.create") return Response.json({ error: "only hermes.task.create is supported by this companion demo" }, { status: 400 });

    const devices = await musubi.devices.listGranted();
    const granted = devices.find((device) => device.id === deviceId && device.allowed_channels.includes(channel));
    if (!granted) return Response.json(browserSafeError("GRANT_DENIED", "Hermes is not authorized for this device."), { status: 403 });

    const now = new Date().toISOString();
    const session: AppTaskSession = {
      id: `ats_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      user_id: user,
      app_id: musubi.appId,
      device_id: deviceId,
      plugin_name: "hermes",
      channel,
      status: "created",
      created_at: now,
      updated_at: now,
      events: [],
      subscribers: new Set(),
    };
    sessions.set(session.id, session);
    publish(session, "task.status", { status: "created" });

    try {
      updateStatus(session, "starting");
      const invocation = await musubi.invoke({
        deviceId,
        channel,
        payload: hermesPayload(instruction, {
          workspaceHint: body.body?.workspace_hint,
          stream: body.body?.stream ?? true,
        }),
      });
      session.invocation = invocation;
      session.musubi_message_id = invocation.messageId;
      updateStatus(session, "running");
      session.bridge = createMusubiEventBridge({
        invocation,
        onEvent: async (event) => {
          const browserEvent = mapPayloadToBrowserEvent(event.payload);
          publish(session, browserEvent.type, browserEvent.data);
          if (browserEvent.type === "task.result") {
            session.final_summary = String(browserEvent.data.summary ?? "");
          }
        },
        onResult: async () => {
          if (session.status !== "cancelled") updateStatus(session, "completed");
        },
        onError: async (error) => {
          if (session.status === "cancelled") return;
          const safe = browserSafeError((error as any).code ?? "TASK_FAILED", error.message);
          session.error_code = String(safe.code);
          session.error_message = String(safe.message);
          publish(session, "task.error", safe);
          updateStatus(session, "failed");
        },
      });
      session.bridge.start();
      return Response.json({ task_session_id: session.id, status: session.status });
    } catch (error) {
      const normalized = normalizeMusubiError(error);
      const safe = browserSafeError(normalized.code, normalized.message);
      session.error_code = String(safe.code);
      session.error_message = String(safe.message);
      publish(session, "task.error", safe);
      updateStatus(session, "failed");
      return Response.json(safe, { status: normalized.status ?? 500 });
    }
  }

  async function cancelTask(req: Request, id: string): Promise<Response> {
    const session = getOwnedSession(req, id);
    if (session instanceof Response) return session;
    if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
      return Response.json({ task_session_id: session.id, status: session.status });
    }
    updateStatus(session, "cancel_requested");
    try {
      await session.invocation?.cancel({
        reason: "cancelled from browser session",
        cancelChannel: "hermes.task.cancel",
        payload: { type: "hermes.task.cancel", body: { reason: "cancelled from browser session" } },
      });
    } catch {
      // Cancellation is best effort; the task session state remains browser-safe.
    }
    session.bridge?.stop();
    updateStatus(session, "cancelled");
    publish(session, "task.result", { status: "cancelled", summary: "Task was cancelled." });
    return Response.json({ task_session_id: session.id, status: session.status });
  }

  function streamEvents(req: Request, id: string, url: URL): Response {
    const session = getOwnedSession(req, id, url);
    if (session instanceof Response) return session;
    const after = Number(url.searchParams.get("after") ?? 0);
    const encoder = new TextEncoder();
    let subscriber: ((event: AppTaskEvent) => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        function send(event: AppTaskEvent) {
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`));
        }
        for (const event of session.events.filter((item) => item.id > after)) send(event);
        subscriber = (event: AppTaskEvent) => send(event);
        session.subscribers.add(subscriber);
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        if (subscriber) session.subscribers.delete(subscriber);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  }

  async function serveStatic(pathname: string): Promise<Response> {
    const filePath = pathname === "/" || pathname === "/index.html"
      ? "apps/hermes-companion/static/index.html"
      : pathname === "/app.js"
        ? "apps/hermes-companion/static/app.js"
        : pathname === "/styles.css"
          ? "apps/hermes-companion/static/styles.css"
          : "";
    if (!filePath) return Response.json({ error: "not found" }, { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return Response.json({ error: "not found" }, { status: 404 });
    const contentType = filePath.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
    return new Response(file, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  }

  const server = Bun.serve({
    hostname: options.hostname ?? process.env.HERMES_COMPANION_HOST ?? "127.0.0.1",
    port: options.port ?? Number(process.env.HERMES_COMPANION_PORT ?? "8797"),
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (url.pathname === "/api/devices" && req.method === "GET") {
          const user = requireUser(req);
          if (user instanceof Response) return user;
          const devices = await musubi.devices.listGranted();
          return Response.json({ devices });
        }
        if (url.pathname === "/api/tasks" && req.method === "POST") return startTask(req);
        const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
        if (taskMatch && req.method === "GET") {
          const session = getOwnedSession(req, taskMatch[1]);
          if (session instanceof Response) return session;
          return Response.json({ task: publicSession(session), events: session.events });
        }
        const eventsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
        if (eventsMatch && req.method === "GET") return streamEvents(req, eventsMatch[1], url);
        const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
        if (cancelMatch && req.method === "POST") return cancelTask(req, cancelMatch[1]);
        return serveStatic(url.pathname);
      } catch (error) {
        const normalized = normalizeMusubiError(error);
        return Response.json(browserSafeError(normalized.code, normalized.message), { status: normalized.status ?? 500 });
      }
    },
  });

  console.log("[hermes-companion] listening", { url: `http://${server.hostname}:${server.port}` });
  return server;
}

function browserSafeError(code: string, message: string) {
  const normalized = code || "TASK_FAILED";
  const table: Record<string, string> = {
    DEVICE_OFFLINE: "Device is offline.",
    GRANT_DENIED: "Hermes is not authorized for this device.",
    LOCAL_POLICY_DENIED: "Local policy denied the request.",
    PLUGIN_NOT_FOUND: "Hermes plugin is not installed.",
    MESSAGE_TIMEOUT: "Task timed out.",
    MESSAGE_CANCELLED: "Task was cancelled.",
    TASK_FAILED: "Task failed.",
  };
  return {
    code: normalized,
    message: table[normalized] ?? message.replace(/MUSUBI_API_KEY|MUSUBI_APP_PRIVATE_KEY|musubi_app_sk_[A-Za-z0-9_-]+/g, "[redacted]"),
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

if (import.meta.main) startHermesCompanion();
