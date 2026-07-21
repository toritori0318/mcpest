/**
 * Discovery of *.mcpt.yaml files and normalization into TestCase[].
 * Validation failures become DiscoveryError messages that say exactly which
 * file and what is wrong in one shot — input errors are the first stone users
 * trip on, so the message quality here defines the DX.
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
  if (!isPlainObject(raw)) fail(file, `tests[${index}] must be an object`);
  const name = raw["name"];
  if (typeof name !== "string" || name === "") {
    fail(file, `tests[${index}] is missing name`);
  }

  const methodsPresent = METHODS.filter((m) => m in raw);
  if (methodsPresent.length === 0) {
    fail(file, `test "${name}": no method specified (expected one of ${METHODS.join(" / ")})`);
  }
  if (methodsPresent.length > 1) {
    fail(file, `test "${name}": specify exactly one method (found ${methodsPresent.join(", ")})`);
  }
  const method = methodsPresent[0]!;
  const body = raw[method];
  if (body !== null && body !== undefined && !isPlainObject(body)) {
    fail(file, `test "${name}": the value of ${method} must be an object`);
  }
  const spec = (body ?? {}) as Record<string, unknown>;

  let tool: string | undefined;
  if (method === "tools/call") {
    if (typeof spec["tool"] !== "string" || spec["tool"] === "") {
      fail(file, `test "${name}": tools/call requires tool (the tool name)`);
    }
    tool = spec["tool"];
  }

  const args = spec["args"] ?? {};
  if (!isPlainObject(args)) {
    fail(file, `test "${name}": args must be an object`);
  }

  const timeoutRaw = raw["timeout"] ?? fileTimeoutMs;
  if (typeof timeoutRaw !== "number" || timeoutRaw <= 0) {
    fail(file, `test "${name}": timeout must be a positive number`);
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
    fail(path, `YAML parse failed: ${String(error)}`);
  }
  if (!isPlainObject(doc)) fail(path, "the top level must be an object");

  const server = doc["server"];
  if (typeof server !== "string" || server === "") {
    fail(path, "server (a key in mcp.json's mcpServers) is required");
  }
  if (!knownServers.includes(server)) {
    fail(
      path,
      `server "${server}" not found in config. Available: ${knownServers.join(", ") || "(none)"}`,
    );
  }

  const fileTimeout = doc["timeout"] ?? DEFAULT_TIMEOUT_MS;
  if (typeof fileTimeout !== "number" || fileTimeout <= 0) {
    fail(path, "timeout must be a positive number");
  }

  const testsRaw = doc["tests"];
  if (!Array.isArray(testsRaw) || testsRaw.length === 0) {
    fail(path, "tests (a non-empty array) is required");
  }

  const tests = testsRaw.map((t, i) => normalizeTest(t, i, path, fileTimeout));

  const seen = new Set<string>();
  for (const t of tests) {
    if (seen.has(t.name)) {
      fail(
        path,
        `duplicate test name "${t.name}" (names are snapshot keys and must be unique)`,
      );
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
