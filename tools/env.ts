import { existsSync, readFileSync } from "node:fs";

export function loadEnvFiles(paths = [".env.local", ".env"]) {
  const loaded: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
      const equals = normalized.indexOf("=");
      if (equals <= 0) continue;
      const key = normalized.slice(0, equals).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
      process.env[key] = unquoteEnvValue(normalized.slice(equals + 1).trim());
    }
    loaded.push(path);
  }
  return loaded;
}

export function requireEnv(name: string, message?: string) {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  throw new Error(message ?? `${name} is required.`);
}

export function requireHostedLocalNeon(scriptName: string) {
  return requireEnv(
    "NEON_DATABASE_URL",
    `NEON_DATABASE_URL is required for ${scriptName}. Hosted-local verification is a secondary CI tier and needs a real Neon database URL in the shell or .env.local; see .env.example.`,
  );
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
