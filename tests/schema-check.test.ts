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

describe("inputSchema validation", () => {
  it("conforming args pass", () => {
    expect(checkSchema(weatherInputSchema, { location: "Tokyo" })).toEqual({ ok: true });
  });

  it("a missing required key fails and the error names the key", () => {
    const result = checkSchema(weatherInputSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("location");
    }
  });

  it("a type mismatch fails", () => {
    const result = checkSchema(weatherInputSchema, { location: 123 });
    expect(result.ok).toBe(false);
  });
});

describe("outputSchema validation", () => {
  it("conforming structuredContent passes", () => {
    expect(
      checkSchema(weatherOutputSchema, { temperature: 22.5, conditions: "Sunny", humidity: 65 }),
    ).toEqual({ ok: true });
  });

  it("non-conforming content (type mismatch) fails", () => {
    const result = checkSchema(weatherOutputSchema, {
      temperature: "very hot",
      conditions: "Sunny",
    });
    expect(result.ok).toBe(false);
  });
});

describe("schema dialects", () => {
  it("accepts schemas declaring draft 2020-12", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { n: { type: "integer" } },
    };
    expect(checkSchema(schema, { n: 1 })).toEqual({ ok: true });
  });

  it("accepts schemas without a $schema declaration (common for MCP inputSchema)", () => {
    expect(checkSchema({ type: "string" }, "text")).toEqual({ ok: true });
  });

  it("accepts schemas declaring draft-07 (what the TypeScript SDK's zod-to-json-schema emits)", () => {
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

  it("treats an invalid schema as a failure (never throws)", () => {
    const result = checkSchema({ type: "no-such-type" }, "x");
    expect(result.ok).toBe(false);
  });
});
