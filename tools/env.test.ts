import { rm } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { loadEnvFiles, requireEnv, requireHostedLocalNeon } from "./env.ts";

describe("env helpers", () => {
  test("requireEnv returns configured values", () => {
    const previous = process.env.MUSUBI_TEST_VALUE;
    process.env.MUSUBI_TEST_VALUE = "configured";
    try {
      expect(requireEnv("MUSUBI_TEST_VALUE")).toBe("configured");
    } finally {
      restoreEnv("MUSUBI_TEST_VALUE", previous);
    }
  });

  test("requireEnv throws for missing values", () => {
    const previous = process.env.MUSUBI_TEST_MISSING;
    delete process.env.MUSUBI_TEST_MISSING;
    try {
      expect(() => requireEnv("MUSUBI_TEST_MISSING", "expected missing")).toThrow("expected missing");
    } finally {
      restoreEnv("MUSUBI_TEST_MISSING", previous);
    }
  });

  test("requireHostedLocalNeon explains the hosted-local tier", () => {
    const previous = process.env.NEON_DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
    try {
      expect(() => requireHostedLocalNeon("verify:slice11:local")).toThrow(
        "Hosted-local verification is a secondary CI tier",
      );
    } finally {
      restoreEnv("NEON_DATABASE_URL", previous);
    }
  });

  test("loadEnvFiles does not override existing values", async () => {
    const previous = process.env.NEON_DATABASE_URL;
    process.env.NEON_DATABASE_URL = "from-env";
    try {
      await Bun.write(".env.test.local", "NEON_DATABASE_URL=from-file\n");
      const loaded = loadEnvFiles([".env.test.local"]);
      expect(loaded).toEqual([".env.test.local"]);
      expect(process.env.NEON_DATABASE_URL).toBe("from-env");
    } finally {
      await rm(".env.test.local", { force: true });
      restoreEnv("NEON_DATABASE_URL", previous);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
