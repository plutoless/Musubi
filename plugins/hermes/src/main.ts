import type {
  JsonRpcRequest,
  JsonRpcResponse,
} from "../../../packages/protocol/src/index.ts";

const decoder = new TextDecoder();
let buffer = "";

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
        name: "hermes",
        version: "0.1.0",
        channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
      };
    } else if (request.method === "musubi.message.handle") {
      const params = request.params as { channel: string; payload: { body?: { text?: string; instruction?: string } } };
      response.result = await handleHermes(params.channel, params.payload);
    } else {
      response.error = { code: -32601, message: "method not found" };
    }
  } catch {
    response.result = {
      status: "failed",
      body: { ok: false, echo: "Hermes runtime failed", handled_by: "hermes" },
    };
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handleHermes(channel: string, payload: { body?: { text?: string; instruction?: string } }) {
  if (channel === "hermes.task.cancel") {
    return {
      status: "completed",
      body: { ok: true, echo: "hermes cancel acknowledged", handled_by: "hermes" },
    };
  }

  if (channel === "hermes.task.status") {
    return {
      status: "completed",
      body: { ok: true, echo: "hermes task status: simulated", handled_by: "hermes" },
    };
  }

  const instruction = payload.body?.instruction ?? payload.body?.text ?? "";
  const runtimeResult = await runHermesRuntime(instruction);
  return {
    status: "completed",
    body: {
      ok: true,
      echo: runtimeResult,
      handled_by: "hermes",
    },
  };
}

async function runHermesRuntime(instruction: string) {
  const command = process.env.HERMES_COMMAND;
  if (!command) return `hermes simulated result: ${instruction}`;

  const [bin, ...args] = command.split(" ").filter(Boolean);
  const proc = Bun.spawn([...[bin, ...args], instruction], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error("Hermes runtime failed");
  }
  return stdout.trim();
}
