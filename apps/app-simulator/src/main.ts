import {
  type PluginResultPayload,
  demoKeys,
  decryptJson,
  makeMessage,
} from "../../../packages/protocol/src/index.ts";

const channel = process.argv[2] ?? "echo.echo";
const relay = process.env.MUSUBI_RELAY_URL ?? "http://127.0.0.1:8787";
const envelope = makeMessage(channel, {
  type: "task.create",
  body: { text: "hello from musubi" },
});

const created = await requestJson<{ message_id: string; status: string; error?: string }>(
  "POST",
  `${relay}/v1/messages`,
  envelope,
);

const createdBody = created.body;
if (created.status < 200 || created.status >= 300) {
  console.error("[app] message rejected", createdBody);
  process.exit(2);
}

let statusBody: any;
for (let attempt = 0; attempt < 100; attempt += 1) {
  statusBody = (await requestJson("GET", `${relay}/v1/messages/${createdBody.message_id}`)).body;
  if (statusBody.status === "completed" || statusBody.status === "failed") break;
  await Bun.sleep(50);
}

if (statusBody.status !== "completed") {
  console.error("[app] message did not complete", statusBody);
  process.exit(3);
}

const result = decryptJson<PluginResultPayload>(
  statusBody.result.ciphertext,
  demoKeys.appResultKey,
);
console.log("[app] message history", JSON.stringify(statusBody.history));
console.log("[app] decrypted result", JSON.stringify(result));

async function requestJson<T>(
  method: string,
  rawUrl: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const args = ["--noproxy", "127.0.0.1", "-sS", "-i", "-X", method, rawUrl];
  if (body !== undefined) {
    args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  }

  const proc = Bun.spawn(["curl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr || `curl exited ${exitCode}`);
  }

  const separator = stdout.indexOf("\r\n\r\n");
  const headerText = separator >= 0 ? stdout.slice(0, separator) : "";
  const bodyText = separator >= 0 ? stdout.slice(separator + 4) : stdout;
  const status = Number(headerText.match(/^HTTP\/\S+\s+(\d+)/)?.[1] ?? "0");
  return { status, body: JSON.parse(bodyText) as T };
}
