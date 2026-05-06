import { readFileSync } from "node:fs";

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
};

const checks = [
  [
    "message envelope",
    "packages/protocol/schemas/message_envelope.schema.json",
    "examples/m1_contracts/message_envelope.json",
  ],
  [
    "plugin manifest",
    "packages/protocol/schemas/plugin_manifest.schema.json",
    "examples/m1_contracts/plugin_manifest.json",
  ],
  [
    "local policy",
    "packages/protocol/schemas/local_policy.schema.json",
    "examples/m1_contracts/local_policy.json",
  ],
] as const;

for (const [name, schemaPath, examplePath] of checks) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Schema;
  const example = JSON.parse(readFileSync(examplePath, "utf8"));
  const errors = validate(schema, example, "$");
  if (errors.length > 0) {
    console.error(`[m1-contracts] ${name} failed`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[m1-contracts] ${name} validates`);
}

console.log("[m1-contracts] ok");

function validate(schema: Schema, value: unknown, path: string): string[] {
  const errors: string[] = [];

  if (schema.type && !matchesType(schema.type, value)) {
    errors.push(`${path} expected ${schema.type}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object" && schema.required) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required) {
      if (!(key in object)) errors.push(`${path}.${key} is required`);
    }
  }

  if (schema.type === "object" && schema.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in object) errors.push(...validate(childSchema, object[key], `${path}.${key}`));
    }
  }

  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...validate(schema.items as Schema, item, `${path}[${index}]`));
    });
  }

  return errors;
}

function matchesType(type: string, value: unknown) {
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === type;
}
