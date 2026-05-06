import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../../packages/protocol/src/index.ts";

const decoder = new TextDecoder();
let buffer = "";
const supportedChannels = new Set(["codex.task.create", "codex.task.cancel", "codex.task.status"]);
const defaultTimeoutMs = 10_000;
const defaultMaxOutputBytes = 8_192;

interface CodexRuntimeFailure {
  isCodexRuntimeError: true;
  code: string;
  exitCode?: number;
  timedOut?: boolean;
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
        version: "0.1.0",
        channels: ["codex.task.create", "codex.task.cancel", "codex.task.status"],
      };
    } else if (request.method === "musubi.message.handle") {
      const params = request.params as { channel: string; payload: { body?: { text?: string; instruction?: string } } };
      response.result = await handleCodex(params.channel, params.payload);
    } else {
      response.error = { code: -32601, message: "method not found" };
    }
  } catch (error) {
    const runtimeError = isCodexRuntimeError(error) ? error : undefined;
    response.result = {
      status: "failed",
      body: {
        ok: false,
        echo: "Codex runtime failed",
        handled_by: "codex",
        error_code: runtimeError?.code ?? "CODEX_RUNTIME_FAILED",
        ...(runtimeError?.exitCode === undefined ? {} : { exit_code: runtimeError.exitCode }),
        ...(runtimeError?.timedOut ? { timed_out: true } : {}),
      },
    };
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function isCodexRuntimeError(error: unknown): error is CodexRuntimeFailure {
  return typeof error === "object" && error !== null && (error as { isCodexRuntimeError?: boolean }).isCodexRuntimeError === true;
}

async function handleCodex(channel: string, payload: { body?: { text?: string; instruction?: string } }) {
  if (!supportedChannels.has(channel)) {
    return {
      status: "failed",
      body: {
        ok: false,
        echo: "Codex runtime failed",
        handled_by: "codex",
        error_code: "CODEX_CHANNEL_UNSUPPORTED",
      },
    };
  }

  if (channel === "codex.task.cancel") {
    return {
      status: "completed",
      body: { ok: true, echo: "codex cancel acknowledged", handled_by: "codex" },
    };
  }

  if (channel === "codex.task.status") {
    return {
      status: "completed",
      body: { ok: true, echo: "codex task status: simulated", handled_by: "codex" },
    };
  }

  const instruction = payload.body?.instruction ?? payload.body?.text ?? "";
  const runtimeResult = await runCodexRuntime(instruction);
  if (!runtimeResult.ok) {
    return {
      status: "failed",
      body: {
        ok: false,
        echo: "Codex runtime failed",
        handled_by: "codex",
        error_code: runtimeResult.code,
        ...(runtimeResult.exitCode === undefined ? {} : { exit_code: runtimeResult.exitCode }),
        ...(runtimeResult.timedOut ? { timed_out: true } : {}),
      },
    };
  }
  return {
    status: "completed",
    body: {
      ok: true,
      echo: runtimeResult.output,
      handled_by: "codex",
    },
  };
}

async function runCodexRuntime(instruction: string) {
  const command = runtimeCommand();
  if (!command) {
    return { ok: true as const, output: limitOutput(`codex simulated result: ${instruction}`, maxOutputBytes()) };
  }

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...command, instruction], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return { ok: false as const, code: "CODEX_RUNTIME_SPAWN" };
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs());
  let stdout = "";
  let exitCode = 1;
  try {
    [stdout, , exitCode] = await Promise.all([
      readCapped(proc.stdout, maxOutputBytes()),
      readCapped(proc.stderr, 1024),
      proc.exited.catch(() => proc.exitCode ?? 1),
    ]);
  } catch {
    return { ok: false as const, code: timedOut ? "CODEX_RUNTIME_TIMEOUT" : "CODEX_RUNTIME_EXIT", exitCode: proc.exitCode ?? 1, timedOut };
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    return { ok: false as const, code: "CODEX_RUNTIME_TIMEOUT", exitCode, timedOut: true };
  }
  if (exitCode !== 0) {
    return { ok: false as const, code: "CODEX_RUNTIME_EXIT", exitCode };
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
  return process.env.CODEX_COMMAND?.split(" ").filter(Boolean);
}

function timeoutMs() {
  return positiveInt(process.env.CODEX_TIMEOUT_MS, defaultTimeoutMs);
}

function maxOutputBytes() {
  return positiveInt(process.env.CODEX_MAX_OUTPUT_BYTES, defaultMaxOutputBytes);
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (total >= maxBytes) continue;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
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

function runtimeFailure(code: string, exitCode?: number, timedOut?: boolean): CodexRuntimeFailure {
  return { isCodexRuntimeError: true, code, exitCode, timedOut };
}
