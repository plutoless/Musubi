import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("NEON_DATABASE_URL is required to apply hosted migrations");
}

const migrationPaths = [
  "migrations/001_init.sql",
  "migrations/002_keys.sql",
  "migrations/003_messages_audit.sql",
  "migrations/004_device_plugin_capabilities.sql",
  "migrations/005_control_plane_m2.sql",
  "migrations/006_third_party_app_platform_m4.sql",
  "migrations/007_hosted_query_indexes.sql",
];

const sql = neon(databaseUrl);

for (const path of migrationPaths) {
  const migration = readFileSync(path, "utf8");
  const statements = migration
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`[neon-migrate] applied ${path} statements=${statements.length}`);
}

console.log("[neon-migrate] ok: hosted schema is up to date");
