/**
 * *.mcpt.yaml の発見と TestCase[] への正規化。
 * バリデーション失敗はどのファイルの何が悪いかを一撃で伝える DiscoveryError にする
 * （テストランナーの入力エラーはユーザーが最初に踏む石なので、ここの音声品質が DX を決める）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";
import { parse as parseYaml } from "yaml";

export interface TestCase {
  name: string;
  method: "tools/list" | "tools/call";
  tool?: string;
  args: Record<string, unknown>;
  expect?: unknown;
  validateInput: boolean;
  validateOutput: boolean;
  snapshot: boolean;
  timeoutMs: number;
  sourceFile: string;
}

export interface TestFile {
  path: string;
  server: string;
  tests: TestCase[];
}

export class DiscoveryError extends Error {
  override name = "DiscoveryError";
}

export interface DiscoverOptions {
  cwd: string;
  globs?: string[];
  knownServers: string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const METHODS = ["tools/list", "tools/call"] as const;

function fail(file: string, message: string): never {
  throw new DiscoveryError(`${file}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTest(
  raw: unknown,
  index: number,
  file: string,
  fileTimeoutMs: number,
): TestCase {
  if (!isPlainObject(raw)) fail(file, `tests[${index}] はオブジェクトである必要があります`);
  const name = raw["name"];
  if (typeof name !== "string" || name === "") {
    fail(file, `tests[${index}] に name がありません`);
  }

  const methodsPresent = METHODS.filter((m) => m in raw);
  if (methodsPresent.length === 0) {
    fail(file, `テスト "${name}": メソッド（${METHODS.join(" / ")}）の指定がありません`);
  }
  if (methodsPresent.length > 1) {
    fail(file, `テスト "${name}": メソッドは1つだけ指定してください（${methodsPresent.join(", ")}）`);
  }
  const method = methodsPresent[0]!;
  const body = raw[method];
  if (body !== null && body !== undefined && !isPlainObject(body)) {
    fail(file, `テスト "${name}": ${method} の値はオブジェクトである必要があります`);
  }
  const spec = (body ?? {}) as Record<string, unknown>;

  let tool: string | undefined;
  if (method === "tools/call") {
    if (typeof spec["tool"] !== "string" || spec["tool"] === "") {
      fail(file, `テスト "${name}": tools/call には tool（ツール名）が必要です`);
    }
    tool = spec["tool"];
  }

  const args = spec["args"] ?? {};
  if (!isPlainObject(args)) {
    fail(file, `テスト "${name}": args はオブジェクトである必要があります`);
  }

  const timeoutRaw = raw["timeout"] ?? fileTimeoutMs;
  if (typeof timeoutRaw !== "number" || timeoutRaw <= 0) {
    fail(file, `テスト "${name}": timeout は正の数値である必要があります`);
  }

  return {
    name,
    method,
    ...(tool !== undefined ? { tool } : {}),
    args,
    ...(spec["expect"] !== undefined ? { expect: spec["expect"] } : {}),
    validateInput: spec["validateInput"] !== false,
    validateOutput: spec["validateOutput"] !== false,
    snapshot: spec["snapshot"] === true,
    timeoutMs: timeoutRaw,
    sourceFile: file,
  };
}

function parseTestFile(path: string, knownServers: string[]): TestFile {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    fail(path, `YAML のパースに失敗しました: ${String(error)}`);
  }
  if (!isPlainObject(doc)) fail(path, "トップレベルはオブジェクトである必要があります");

  const server = doc["server"];
  if (typeof server !== "string" || server === "") {
    fail(path, "server（mcp.json の mcpServers キー名）が必要です");
  }
  if (!knownServers.includes(server)) {
    fail(
      path,
      `server "${server}" は設定に存在しません。利用可能: ${knownServers.join(", ") || "(なし)"}`,
    );
  }

  const fileTimeout = doc["timeout"] ?? DEFAULT_TIMEOUT_MS;
  if (typeof fileTimeout !== "number" || fileTimeout <= 0) {
    fail(path, "timeout は正の数値である必要があります");
  }

  const testsRaw = doc["tests"];
  if (!Array.isArray(testsRaw) || testsRaw.length === 0) {
    fail(path, "tests（1件以上の配列）が必要です");
  }

  const tests = testsRaw.map((t, i) => normalizeTest(t, i, path, fileTimeout));

  const seen = new Set<string>();
  for (const t of tests) {
    if (seen.has(t.name)) {
      fail(path, `テスト名 "${t.name}" が重複しています（スナップショットのキーになるため一意にしてください）`);
    }
    seen.add(t.name);
  }

  return { path, server, tests };
}

export function discoverTests(options: DiscoverOptions): TestFile[] {
  const patterns = options.globs?.length ? options.globs : ["**/*.mcpt.yaml"];
  const paths = globSync(patterns, {
    cwd: options.cwd,
    ignore: ["**/node_modules/**"],
    absolute: false,
    nodir: true,
  })
    .map((p) => join(options.cwd, p))
    .sort();

  return paths.map((p) => parseTestFile(p, options.knownServers));
}
