/**
 * ajv による JSON Schema 検証。tools の inputSchema（args 検証）と
 * outputSchema（structuredContent 検証）の両方で使う。
 * MCP のスキーマは $schema 宣言を持たないことが多いため、
 * 2020-12 をデフォルト方言とする Ajv2020 を使う。
 */
import { Ajv2020 } from "ajv/dist/2020.js";

export type SchemaCheckResult = { ok: true } | { ok: false; errors: string[] };

const ajv = new Ajv2020({
  strict: false, // サードパーティ製サーバーのスキーマの方言ゆらぎを許容する
  allErrors: true,
  validateFormats: false, // format キーワードは ajv-formats なしでは未知なので検証対象外にする
});

export function checkSchema(schema: unknown, data: unknown): SchemaCheckResult {
  let validate;
  try {
    validate = ajv.compile(schema as object);
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
