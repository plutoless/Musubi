import { spawn } from "node:child_process";

const output = await run("go", [
  "run",
  "./cmd/musubi",
  "plugin",
  "run",
  "echo",
  "--payload",
  "examples/encrypted_echo/plain_payload.json",
]);

if (!output.includes('"echo":"hello from local plugin"')) {
  throw new Error("echo plugin did not return expected payload");
}
if (!output.includes("plugin manifest loaded")) {
  throw new Error("CLI did not log plugin manifest load");
}
if (!output.includes("plugin lifecycle completed")) {
  throw new Error("CLI did not log plugin lifecycle completion");
}

console.log("[slice1] ok: Go CLI discovered echo plugin and called JSON-RPC stdio");

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      env: { ...process.env, GOCACHE: `${process.cwd()}/.cache/go-build` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
      process.stderr.write(chunk);
    });
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}`));
    });
  });
}
