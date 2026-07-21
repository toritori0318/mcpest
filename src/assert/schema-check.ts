/**
 * JSON Schema validation via ajv, used for both tool inputSchema (args)
 * and outputSchema (structuredContent).
 * The MCP spec defaults to the 2020-12 dialect, but the TypeScript SDK
 * (zod-to-json-schema) emits schemas declaring draft-07, so the dialect
 * is selected from the $schema declaration.
 */
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

export type SchemaCheckResult = { ok: true } | { ok: false; errors: string[] };

const ajvOptions = {
  strict: false, // tolerate dialect quirks in third-party server schemas
  allErrors: true,
  validateFormats: false, // the format keyword is unknown without ajv-formats; skip it
} as const;

const ajv2020 = new Ajv2020(ajvOptions);
const ajvDraft07 = new Ajv(ajvOptions);

function pickAjv(schema: unknown): Ajv | Ajv2020 {
  const declared =
    typeof schema === "object" && schema !== null
      ? (schema as Record<string, unknown>)["$schema"]
      : undefined;
  if (typeof declared === "string" && declared.includes("draft-07")) return ajvDraft07;
  return ajv2020;
}

export function checkSchema(schema: unknown, data: unknown): SchemaCheckResult {
  let validate;
  try {
    validate = pickAjv(schema).compile(schema as object);
  } catch (error) {
    return { ok: false, errors: [`invalid schema: ${String(error)}`] };
  }
  if (validate(data)) return { ok: true };
  const errors = (validate.errors ?? []).map((e) => {
    const where = e.instancePath === "" ? "(root)" : e.instancePath;
    const detail = e.params ? ` ${JSON.stringify(e.params)}` : "";
    return `${where}: ${e.message ?? "invalid"}${detail}`;
  });
  return { ok: false, errors };
}
