import type { MusubiApp } from "./client.ts";

export function hermesPayload(instruction: string, options: { workspaceHint?: string; stream?: boolean } = {}) {
  return {
    type: "hermes.task.create",
    body: {
      instruction,
      workspace_hint: options.workspaceHint,
      stream: options.stream ?? true,
    },
  };
}

export function codexPayload(
  instruction: string,
  options: { workspaceHint?: string; approvalMode?: string; sandboxMode?: string; maxDurationSeconds?: number; stream?: boolean } = {},
) {
  return {
    type: "codex.task.create",
    body: {
      instruction,
      workspace_hint: options.workspaceHint,
      stream: options.stream ?? true,
      limits: options.maxDurationSeconds ? { max_duration_seconds: options.maxDurationSeconds } : undefined,
      codex_options: {
        approval_mode: options.approvalMode,
        sandbox_mode: options.sandboxMode,
      },
    },
  };
}

export function echoPayload(text: string) {
  return {
    type: "echo.echo",
    body: { text, instruction: text, stream: true },
  };
}

export async function invokeHermes(app: MusubiApp, deviceId: string, instruction: string, options: Parameters<typeof hermesPayload>[1] = {}) {
  return app.invoke({ deviceId, channel: "hermes.task.create", payload: hermesPayload(instruction, options) });
}

export async function invokeCodex(app: MusubiApp, deviceId: string, instruction: string, options: Parameters<typeof codexPayload>[1] = {}) {
  return app.invoke({ deviceId, channel: "codex.task.create", payload: codexPayload(instruction, options) });
}
