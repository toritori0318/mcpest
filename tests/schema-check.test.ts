import { describe, expect, it } from "vitest";
import { checkSchema } from "../src/assert/schema-check.js";

// checkSchema(schema, data) => { ok: true } | { ok: false, errors: string[] }

const weatherInputSchema = {
  type: "object",
  properties: {
    location: { type: "string", description: "City name" },
  },
  required: ["location"],
} as const;

const weatherOutputSchema = {
  type: "object",
  properties: {
    temperature: { type: "number" },
    conditions: { type: "string" },
    humidity: { type: "number" },
  },
  required: ["temperature", "conditions", "humidity"],
} as const;

describe("inputSchema 検証", () => {
  it("適合する args はパス", () => {
    expect(checkSchema(weatherInputSchema, { location: "Tokyo" })).toEqual({ ok: true });
  });

  it("required 欠落は失敗し、欠けたキー名がエラーに含まれる", () => {
    const result = checkSchema(weatherInputSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("location");
    }
  });

  it("型違いは失敗", () => {
    const result = checkSchema(weatherInputSchema, { location: 123 });
    expect(result.ok).toBe(false);
  });
});

describe("outputSchema 検証", () => {
  it("適合する structuredContent はパス", () => {
    expect(
      checkSchema(weatherOutputSchema, { temperature: 22.5, conditions: "Sunny", humidity: 65 }),
    ).toEqual({ ok: true });
  });

  it("不適合（型違い）は失敗", () => {
    const result = checkSchema(weatherOutputSchema, {
      temperature: "very hot",
      conditions: "Sunny",
    });
    expect(result.ok).toBe(false);
  });
});

describe("スキーマ方言", () => {
  it("draft 2020-12 の $schema 宣言つきスキーマを受理する", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { n: { type: "integer" } },
    };
    expect(checkSchema(schema, { n: 1 })).toEqual({ ok: true });
  });

  it("$schema 宣言なしのスキーマも受理する（MCP の inputSchema は宣言を持たないことが多い）", () => {
    expect(checkSchema({ type: "string" }, "text")).toEqual({ ok: true });
  });

  it("draft-07 の $schema 宣言つきスキーマを受理する（TypeScript SDK の zod-to-json-schema が生成する形式）", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    };
    expect(checkSchema(schema, { text: "hi" })).toEqual({ ok: true });
    expect(checkSchema(schema, { text: 1 }).ok).toBe(false);
  });

  it("スキーマ自体が不正な場合はエラー扱い（例外を投げない）", () => {
    const result = checkSchema({ type: "no-such-type" }, "x");
    expect(result.ok).toBe(false);
  });
});
