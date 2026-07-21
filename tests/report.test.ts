import { describe, expect, it } from "vitest";
import type { RunResult } from "../src/report/types.js";
import { renderPretty } from "../src/report/pretty.js";
import { renderJunit } from "../src/report/junit.js";
import { renderJson } from "../src/report/json.js";

const sampleResult: RunResult = {
  servers: [
    {
      server: "weather",
      connection: {
        ok: true,
        protocolVersion: "2025-06-18",
        serverName: "fixture",
        serverVersion: "1.0.0",
        connectMs: 240,
      },
      results: [
        {
          test: {
            name: "一覧が壊れていない",
            method: "tools/list",
            args: {},
            validateInput: true,
            validateOutput: true,
            snapshot: true,
            timeoutMs: 30000,
            sourceFile: "/tmp/weather.mcpt.yaml",
          },
          status: "passed",
          durationMs: 12,
          failures: [],
          schemaChecks: [],
        },
        {
          test: {
            name: "天気の呼び出し",
            method: "tools/call",
            tool: "get_weather",
            args: { location: "Tokyo" },
            validateInput: true,
            validateOutput: true,
            snapshot: false,
            timeoutMs: 30000,
            sourceFile: "/tmp/weather.mcpt.yaml",
          },
          status: "failed",
          durationMs: 310,
          failures: [
            {
              path: "structuredContent.temperature",
              message: '型 number を期待しましたが string（"very hot"）でした',
            },
          ],
          schemaChecks: [{ kind: "output", ok: false, errors: ["type mismatch"] }],
          tracePath: "/tmp/.mcpest/traces/weather-1.jsonl",
        },
      ],
    },
  ],
  counts: { passed: 1, failed: 1, errored: 0, total: 2 },
  ok: false,
  durationMs: 562,
};

describe("pretty レポータ", () => {
  it("結果サマリ・失敗パス・トレースパスを含む", () => {
    const out = renderPretty(sampleResult, { color: false });
    expect(out).toContain("一覧が壊れていない");
    expect(out).toContain("天気の呼び出し");
    expect(out).toContain("structuredContent.temperature");
    expect(out).toContain("weather-1.jsonl");
    expect(out).toContain("1 passed");
    expect(out).toContain("1 failed");
  });

  it("color: false では ANSI エスケープを含まない", () => {
    const out = renderPretty(sampleResult, { color: false });
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\[/);
  });

  it("接続情報（プロトコルバージョン）を表示する", () => {
    const out = renderPretty(sampleResult, { color: false });
    expect(out).toContain("2025-06-18");
  });
});

describe("junit レポータ", () => {
  it("testsuite の tests/failures 数が結果と一致する（受け入れ8）", () => {
    const xml = renderJunit(sampleResult);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('errors="0"');
    expect(xml).toContain('<testsuite name="weather"');
  });

  it("失敗メッセージの XML 特殊文字がエスケープされる", () => {
    const result = structuredClone(sampleResult);
    result.servers[0]!.results[1]!.failures[0]!.message = 'a < b & "quote"';
    const xml = renderJunit(result);
    expect(xml).toContain("a &lt; b &amp; &quot;quote&quot;");
    expect(xml).not.toContain('a < b & "quote"');
  });
});

describe("json レポータ", () => {
  it("RunResult がそのままラウンドトリップできる", () => {
    const parsed = JSON.parse(renderJson(sampleResult));
    expect(parsed.counts).toEqual(sampleResult.counts);
    expect(parsed.servers[0].results[1].failures[0].path).toBe(
      "structuredContent.temperature",
    );
  });
});
