import type {
  AppPayload,
  JsonRpcRequest,
  JsonRpcResponse,
  PluginResultPayload,
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

function handleLine(line: string) {
  const request = JSON.parse(line) as JsonRpcRequest;
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: request.id,
  };

  if (request.method === "musubi.plugin.info") {
    response.result = {
      name: "echo",
      version: "0.1.0",
      channels: ["echo.echo", "echo.ping"],
    };
  } else if (request.method === "musubi.message.handle") {
    const params = request.params as { channel: string; payload: AppPayload };
    const result = handleEcho(params.channel, params.payload);
    response.result = {
      status: result.body.ok ? "completed" : "failed",
      body: result.body,
    };
  } else if (request.method === "echo.handle") {
    const params = request.params as { channel: string; payload: AppPayload };
    response.result = handleEcho(params.channel, params.payload);
  } else {
    response.error = { code: -32601, message: "method not found" };
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function handleEcho(channel: string, payload: AppPayload): PluginResultPayload {
  if (channel === "echo.ping") {
    return { type: "task.result", body: { ok: true, pong: true, handled_by: "echo" } };
  }

  return {
    type: "task.result",
    body: {
      ok: true,
      echo: payload.body.text ?? "",
      handled_by: "echo",
    },
  };
}
