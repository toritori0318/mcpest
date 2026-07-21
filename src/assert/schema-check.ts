/**
 * ajv による JSON Schema 検証。tools の inputSchema（args 検証）と
 * outputSchema（structuredContent 検証）の両方で使う。
 * MCP の仕様上の既定方言は 2020-12 だが、TypeScript SDK（zod-to-json-schema）は
 * draft-07 宣言つきスキーマを生成するため、$schema 宣言を見て方言を切り替える。
 */
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

export type SchemaCheckResult = { ok: true } | { ok: false; errors: string[] };

const ajvOptions = {
  strict: false, // サードパーティ製サーバーのスキーマの方言ゆらぎを許容する
  allErrors: true,
  validateFormats: false, // format キーワードは ajv-formats なしでは未知なので検証対象外にする
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
    return { ok: false, errors: [`スキーマ自体が不正です: ${String(error)}`] };
  }
  if (validate(data)) return { ok: true };
  const errors = (validate.errors ?? []).map((e) => {
    const where = e.instancePath === "" ? "(root)" : e.instancePath;
    const detail = e.params ? ` ${JSON.stringify(e.params)}` : "";
    return `${where}: ${e.message ?? "invalid"}${detail}`;
  });
  return { ok: false, errors };
}
