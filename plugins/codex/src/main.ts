import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { JsonRpcRequest, JsonRpcResponse } from "../../../packages/protocol/src/index.ts";

const decoder = new TextDecoder();
let buffer = "";

const supportedChannels = new Set(["codex.task.create", "codex.task.cancel", "codex.task.status"]);
const defaultTimeoutMs = 10_000;
const defaultMaxOutputBytes = 8_192;
const tasks = new Map<string, CodexTask>();

interface CodexRuntimeFailure {
  isCodexRuntimeError: true;
  code: string;
  exitCode?: number;
  timedOut?: boolean;
}

interface CodexPayload {
  type?: string;
  nonce?: string;
  body?: {
    text?: string;
    instruction?: string;
    workspace_hint?: string;
    mode?: string;
    stream?: boolean;
    limits?: {
      max_duration_seconds?: number;
    };
    codex_options?: {
      approval_mode?: string;
      sandbox_mode?: string;
    };
    task_id?: string;
    reason?: string;
  };
}

interface CodexTask {
  id: string;
  status: "accepted" | "starting" | "running" | "completed" | "failed" | "cancel_requested" | "cancelled" | "timeout";
  instruction: string;
  workspace: string;
  started_at: string;
  updated_at: string;
  child?: Bun.Subprocess<"ignore", "pipe", "pipe">;
  output?: string;
  error_code?: string;
}

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handleLine(line);
    index = buffer.indexOf("\n");
  }
}

async function handleLine(line: string) {
  const request = JSON.parse(line) as JsonRpcRequest;
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: request.id,
  };

  try {
    if (request.method === "musubi.plugin.info") {
      response.result = {
        name: "codex",
        version: "0.2.5",
        channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
        event_channels: ["codex.task.event"],
        metadata: detectCodex(),
      };
    } else if (request.method === "musubi.message.handle") {
      const params = request.params as { channel: string; payload: CodexPayload };
      response.result = await handleCodex(params.channel, params.payload);
    } else {
      response.error = { code: -32601, message: "method not found" };
    }
  } catch (error) {
    const runtimeError = isCodexRuntimeError(error) ? error : runtimeFailure("UNKNOWN_ERROR");
    response.result = failureResult(runtimeError.code, runtimeError.exitCode, runtimeError.timedOut);
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function isCodexRuntimeError(error: unknown): error is CodexRuntimeFailure {
  return typeof error === "object" && error !== null && (error as { isCodexRuntimeError?: boolean }).isCodexRuntimeError === true;
}

async function handleCodex(channel: string, payload: CodexPayload) {
  if (!supportedChannels.has(channel)) {
    return failureResult("CODEX_CHANNEL_UNSUPPORTED");
  }

  if (channel === "codex.task.cancel") {
    return cancelTask(payload);
  }

  if (channel === "codex.task.status") {
    return statusTask(payload);
  }

  return createTask(payload);
}

async function createTask(payload: CodexPayload) {
  const instruction = payload.body?.instruction ?? payload.body?.text ?? "";
  if (!instruction.trim()) return failureResult("CODEX_TASK_INVALID");

  const workspace = resolveWorkspace(payload.body?.workspace_hint);
  const task: CodexTask = {
    id: `codex_task_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    status: "accepted",
    instruction,
    workspace,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  tasks.set(task.id, task);

  emitEvent(task, "accepted", "accepted", "Codex task accepted");
  emitEvent(task, "started", "running", "Codex task started");
  task.status = "running";
  task.updated_at = new Date().toISOString();

  const runtimeResult = await runCodexRuntime(task, payload);
  if (!runtimeResult.ok) {
    task.status = runtimeResult.timedOut ? "timeout" : "failed";
    task.error_code = runtimeResult.code;
    task.updated_at = new Date().toISOString();
    emitEvent(task, runtimeResult.timedOut ? "failed" : "failed", "failed", "Codex runtime failed", {
      error_code: runtimeResult.code,
      ...(runtimeResult.exitCode === undefined ? {} : { exit_code: runtimeResult.exitCode }),
      ...(runtimeResult.timedOut ? { timed_out: true } : {}),
    });
    return failureResult(runtimeResult.code, runtimeResult.exitCode, runtimeResult.timedOut, task.id);
  }

  task.status = "completed";
  task.output = runtimeResult.output;
  task.updated_at = new Date().toISOString();
  emitEvent(task, "result", "completed", runtimeResult.output);
  return {
    status: "completed",
    body: {
      ok: true,
      echo: runtimeResult.output,
      handled_by: "codex",
      task_id: task.id,
      event_type: "result",
      status: "completed",
      timestamp: task.updated_at,
    },
  };
}

function cancelTask(payload: CodexPayload) {
  const taskId = payload.body?.task_id;
  const task = taskId ? tasks.get(taskId) : undefined;
  if (!task) {
    return {
      status: "completed",
      body: { ok: true, echo: "codex cancel acknowledged", handled_by: "codex", task_id: taskId, event_type: "cancelled", status: "cancelled" },
    };
  }
  task.status = "cancel_requested";
  task.updated_at = new Date().toISOString();
  task.child?.kill("SIGTERM");
  task.status = "cancelled";
  task.updated_at = new Date().toISOString();
  emitEvent(task, "cancelled", "cancelled", payload.body?.reason || "Codex task cancelled");
  return {
    status: "completed",
    body: { ok: true, echo: "codex cancel acknowledged", handled_by: "codex", task_id: task.id, event_type: "cancelled", status: "cancelled" },
  };
}

function statusTask(payload: CodexPayload) {
  const taskId = payload.body?.task_id;
  const task = taskId ? tasks.get(taskId) : undefined;
  if (!task) {
    return failureResult("CODEX_TASK_NOT_FOUND", undefined, false, taskId);
  }
  return {
    status: "completed",
    body: {
      ok: true,
      echo: `codex task status: ${task.status}`,
      handled_by: "codex",
      task_id: task.id,
      event_type: "status",
      status: task.status,
      timestamp: task.updated_at,
      metadata: { started_at: task.started_at, updated_at: task.updated_at },
    },
  };
}

async function runCodexRuntime(task: CodexTask, payload: CodexPayload) {
  const command = runtimeCommand();
  if (!command) {
    const output = limitOutput(`codex simulated result: ${task.instruction}`, maxOutputBytes());
    emitEvent(task, "progress", "running", output);
    return { ok: true as const, output };
  }

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...command, task.instruction], {
      cwd: task.workspace,
      stdout: "pipe",
      stderr: "pipe",
    });
    task.child = proc;
  } catch {
    return { ok: false as const, code: "CODEX_PROCESS_FAILED" };
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs(payload));
  let stdout = "";
  let stderr = "";
  let exitCode = 1;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      readCapped(proc.stdout, maxOutputBytes(), (line) => emitEvent(task, "stdout", "running", line)),
      readCapped(proc.stderr, 1024, (line) => emitEvent(task, "stderr", "running", line)),
      proc.exited.catch(() => proc.exitCode ?? 1),
    ]);
  } catch {
    return { ok: false as const, code: timedOut ? "CODEX_TIMEOUT" : "CODEX_PROCESS_FAILED", exitCode: proc.exitCode ?? 1, timedOut };
  } finally {
    clearTimeout(timeout);
    task.child = undefined;
  }
  if (timedOut) {
    return { ok: false as const, code: "CODEX_TIMEOUT", exitCode, timedOut: true };
  }
  if (task.status === "cancelled" || task.status === "cancel_requested") {
    return { ok: false as const, code: "CODEX_CANCELLED", exitCode };
  }
  if (exitCode !== 0) {
    const code = looksAuthRelated(stderr) ? "CODEX_AUTH_REQUIRED" : "CODEX_PROCESS_FAILED";
    return { ok: false as const, code, exitCode };
  }
  return { ok: true as const, output: limitOutput(stdout.trim(), maxOutputBytes()) };
}

function runtimeCommand(): string[] | undefined {
  const commandJson = process.env.CODEX_COMMAND_JSON;
  if (commandJson) {
    const parsed = JSON.parse(commandJson);
    if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== "string" || part.length === 0)) {
      throw runtimeFailure("CODEX_RUNTIME_CONFIG");
    }
    return parsed;
  }
  const command = process.env.CODEX_COMMAND?.split(" ").filter(Boolean);
  if (command?.length) return command;
  const binary = process.env.CODEX_BINARY;
  if (!binary) return undefined;
  const found = findExecutable(binary);
  if (!found) throw runtimeFailure("CODEX_NOT_INSTALLED");
  return [found, "exec"];
}

function resolveWorkspace(hint: string | undefined) {
  const workspace = normalizePath(hint || process.env.CODEX_DEFAULT_WORKING_DIR || process.cwd());
  const allowed = allowedWorkspaceDirs();
  if (allowed.length === 0) return workspace;
  for (const dir of allowed) {
    const allowedDir = normalizePath(dir);
    if (workspace === allowedDir || workspace.startsWith(`${allowedDir}/`)) {
      return workspace;
    }
  }
  throw runtimeFailure("WORKSPACE_NOT_ALLOWED");
}

function allowedWorkspaceDirs() {
  const json = process.env.CODEX_ALLOWED_WORKSPACE_DIRS_JSON;
  if (json) {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw runtimeFailure("CODEX_RUNTIME_CONFIG");
    }
    return parsed;
  }
  return (process.env.CODEX_ALLOWED_WORKSPACE_DIRS || "")
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePath(value: string) {
  let path = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  path = isAbsolute(path) ? path : resolve(path);
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function findExecutable(binary: string) {
  if (binary.includes("/")) return existsSync(binary) ? binary : undefined;
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    const candidate = join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function timeoutMs(payload?: CodexPayload) {
  const requestedSeconds = payload?.body?.limits?.max_duration_seconds;
  const requestedMs = typeof requestedSeconds === "number" && requestedSeconds > 0 ? requestedSeconds * 1000 : undefined;
  const configured = positiveInt(process.env.CODEX_TIMEOUT_MS, defaultTimeoutMs);
  return requestedMs ? Math.min(requestedMs, configured) : configured;
}

function maxOutputBytes() {
  return positiveInt(process.env.CODEX_MAX_OUTPUT_BYTES, defaultMaxOutputBytes);
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number, onLine: (line: string) => void) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let textBuffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      textBuffer += text;
      let newline = textBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = textBuffer.slice(0, newline).trim();
        textBuffer = textBuffer.slice(newline + 1);
        if (line) onLine(limitOutput(line, 1024));
        newline = textBuffer.indexOf("\n");
      }
      if (total >= maxBytes) continue;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const tail = textBuffer.trim();
    if (tail) onLine(limitOutput(tail, 1024));
  } catch {
    // Stream errors are represented through runtime status, not leaked text.
  }
  return Buffer.concat(chunks).toString("utf8");
}

function limitOutput(value: string, maxBytes: number) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function emitEvent(task: CodexTask, eventType: string, status: string, message: string, metadata: Record<string, unknown> = {}) {
  const event = {
    status: "processing",
    body: {
      ok: status !== "failed",
      echo: message,
      handled_by: "codex",
      task_id: task.id,
      event_type: eventType,
      status,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    },
  };
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "musubi.message.event", params: event })}\n`);
}

function failureResult(code: string, exitCode?: number, timedOut?: boolean, taskId?: string) {
  return {
    status: "failed",
    body: {
      ok: false,
      echo: "Codex runtime failed",
      handled_by: "codex",
      task_id: taskId,
      event_type: "failed",
      status: "failed",
      error_code: code,
      ...(exitCode === undefined ? {} : { exit_code: exitCode }),
      ...(timedOut ? { timed_out: true } : {}),
      timestamp: new Date().toISOString(),
    },
  };
}

function looksAuthRelated(stderr: string) {
  return /auth|login|unauthorized|forbidden|credential/i.test(stderr);
}

function detectCodex() {
  const binary = process.env.CODEX_BINARY || "codex";
  const found = findExecutable(binary);
  return {
    codex_binary: binary,
    detected: Boolean(found),
    ready: Boolean(found || process.env.CODEX_COMMAND || process.env.CODEX_COMMAND_JSON),
  };
}

function runtimeFailure(code: string, exitCode?: number, timedOut?: boolean): CodexRuntimeFailure {
  return { isCodexRuntimeError: true, code, exitCode, timedOut };
}
