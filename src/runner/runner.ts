/**
 * Execution orchestration. Servers run in parallel (capped at 4); tests within
 * a server run sequentially in definition order over a reused connection.
 * Speed and the ability to test stateful call sequences are prioritized over
 * per-test isolation (see design doc §14).
 */
import { join } from "node:path";
import {
  CallToolResultSchema,
  ErrorCode,
  ListToolsResultSchema,
  McpError,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { evaluate } from "../assert/matchers.js";
import { checkSchema } from "../assert/schema-check.js";
import { SnapshotStore } from "../assert/snapshot.js";
import { connect, ConnectionError, type Connection } from "../client/connector.js";
import { loadConfig, type ServerConfig } from "../config/loader.js";
import { discoverTests, type TestCase, type TestFile } from "../discovery.js";
import type {
  RunResult,
  ServerRunResult,
  TestFailure,
  TestResult,
  SchemaCheck,
} from "../report/types.js";

export interface RunOptions {
  cwd: string;
  configPath?: string;
  globs?: string[];
  /** Restrict to a single server name */
  server?: string;
  /** Substring filter on test names */
  grep?: string;
  bail?: boolean;
  updateSnapshots?: boolean;
  ci?: boolean;
  traceMode?: "off" | "on" | "retain-on-failure";
  connectTimeoutMs?: number;
}

const MAX_LIST_PAGES = 50;
const SERVER_CONCURRENCY = 4;

interface ExpectParts {
  /** JSON-RPC error matching (the top-level error key of expect) */
  error?: unknown;
  /** Everything else, matched against the result */
  result?: unknown;
}

function splitExpect(expect: unknown): ExpectParts {
  if (typeof expect !== "object" || expect === null || Array.isArray(expect)) {
    return { result: expect };
  }
  const { error, ...rest } = expect as Record<string, unknown>;
  return {
    ...(error !== undefined ? { error } : {}),
    ...(Object.keys(rest).length > 0 ? { result: rest } : {}),
  };
}

async function fetchAllTools(connection: Connection): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await connection.client.request(
      { method: "tools/list", params: cursor !== undefined ? { cursor } : {} },
      ListToolsResultSchema,
    );
    tools.push(...result.tools);
    if (result.nextCursor === undefined) return tools;
    cursor = result.nextCursor;
  }
  throw new Error(`tools/list pagination exceeded ${MAX_LIST_PAGES} pages`);
}

async function runSingleTest(
  test: TestCase,
  connection: Connection,
  tools: Tool[],
  snapshots: SnapshotStore,
): Promise<Omit<TestResult, "tracePath">> {
  const started = Date.now();
  const failures: TestFailure[] = [];
  const schemaChecks: SchemaCheck[] = [];
  const done = (status: TestResult["status"]): Omit<TestResult, "tracePath"> => ({
    test,
    status,
    durationMs: Date.now() - started,
    failures,
    schemaChecks,
  });

  const { error: expectError, result: expectResult } = splitExpect(test.expect);

  let actual: unknown;

  if (test.method === "tools/list") {
    actual = { tools };
  } else {
    const tool = tools.find((t) => t.name === test.tool);
    if (!tool) {
      failures.push({
        path: "tool",
        message: `tool "${test.tool}" not found. Available: ${tools.map((t) => t.name).join(", ")}`,
      });
      return done("failed");
    }

    // Input auto-validation: catch test typos before calling the server
    if (test.validateInput && tool.inputSchema) {
      const check = checkSchema(tool.inputSchema, test.args);
      if (!check.ok) {
        schemaChecks.push({ kind: "input", ok: false, errors: check.errors });
        failures.push({
          path: "args",
          message: `args do not conform to inputSchema: ${check.errors.join(" / ")}`,
        });
        return done("failed");
      }
      schemaChecks.push({ kind: "input", ok: true });
    }

    try {
      // Use the low-level request instead of the high-level callTool so the
      // SDK's own outputSchema validation (which throws) does not preempt
      // mcpest's ajv validation and its better failure messages
      actual = await connection.client.request(
        { method: "tools/call", params: { name: test.tool, arguments: test.args } },
        CallToolResultSchema,
        { timeout: test.timeoutMs },
      );
    } catch (error) {
      if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
        failures.push({
          path: "",
          message: `timeout: no response within ${test.timeoutMs}ms`,
        });
        return done("failed");
      }
      if (error instanceof McpError) {
        const protocolError = { code: error.code, message: error.message };
        if (expectError !== undefined) {
          failures.push(
            ...evaluate(expectError, protocolError).map((f) => ({
              ...f,
              path: f.path === "" ? "error" : `error.${f.path}`,
            })),
          );
          return done(failures.length === 0 ? "passed" : "failed");
        }
        failures.push({
          path: "",
          message: `JSON-RPC error: code=${error.code} ${error.message}`,
        });
        return done("failed");
      }
      throw error;
    }

    // A test that matches on error must fail if the response was successful
    if (expectError !== undefined) {
      failures.push({
        path: "error",
        message: "expected a JSON-RPC error, but received a successful response",
      });
      return done("failed");
    }

    // The MCP spec allows omitting isError on success. Normalize the omission
    // to false so users can naturally write `isError: false`
    actual = { isError: false, ...(actual as Record<string, unknown>) };

    // Output auto-validation: when outputSchema is declared, a conforming
    // structuredContent is a server-side MUST in the MCP spec
    const callResult = actual as { structuredContent?: unknown; isError?: boolean };
    if (test.validateOutput && tool.outputSchema && callResult.isError !== true) {
      if (callResult.structuredContent === undefined) {
        schemaChecks.push({
          kind: "output",
          ok: false,
          errors: ["outputSchema is declared but structuredContent is missing"],
        });
        failures.push({
          path: "structuredContent",
          message:
            "outputSchema is declared but structuredContent is missing (violates a server MUST in the MCP spec)",
        });
      } else {
        const check = checkSchema(tool.outputSchema, callResult.structuredContent);
        if (!check.ok) {
          schemaChecks.push({ kind: "output", ok: false, errors: check.errors });
          failures.push({
            path: "structuredContent",
            message: `structuredContent does not conform to outputSchema: ${check.errors.join(" / ")}`,
          });
        } else {
          schemaChecks.push({ kind: "output", ok: true });
        }
      }
    }
  }

  if (expectResult !== undefined) {
    failures.push(...evaluate(expectResult, actual));
  } else if (test.method === "tools/call" && expectError === undefined) {
    // Default check when expect is omitted: the tool must not report an
    // execution error (design doc §4.2)
    const { isError } = actual as { isError?: boolean };
    if (isError === true) {
      const content = (actual as { content?: unknown }).content;
      failures.push({
        path: "isError",
        message: `tool returned an execution error (isError: true): ${JSON.stringify(content)}`,
      });
    }
  }

  if (test.snapshot) {
    const snap = snapshots.check(test.name, actual);
    if (snap.status === "mismatched") {
      failures.push({
        path: "(snapshot)",
        message: "does not match the stored snapshot (run with -u to update)",
        ...(snap.diff !== undefined ? { diff: snap.diff } : {}),
      });
    } else if (snap.status === "missing") {
      failures.push({
        path: "(snapshot)",
        message:
          "missing snapshot is treated as a failure in CI mode (generate it locally and commit it)",
      });
    }
  }

  return done(failures.length === 0 ? "passed" : "failed");
}

async function runServer(
  config: ServerConfig,
  files: TestFile[],
  options: RunOptions,
  traceCounter: { next(): number },
): Promise<ServerRunResult> {
  const traceMode = options.traceMode ?? "retain-on-failure";
  const allTests = files.flatMap((f) => f.tests);
  const connectStarted = Date.now();

  let connection: Connection;
  try {
    connection = await connect(config, {
      ...(options.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
    });
  } catch (error) {
    const stderrTail = error instanceof ConnectionError ? error.stderrTail : undefined;
    return {
      server: config.name,
      connection: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(stderrTail !== undefined ? { stderrTail } : {}),
      },
      results: allTests.map((test) => ({
        test,
        status: "error" as const,
        durationMs: 0,
        failures: [{ path: "", message: "not executed because the server connection failed" }],
        schemaChecks: [],
      })),
    };
  }

  const results: TestResult[] = [];
  try {
    const tools = await fetchAllTools(connection);

    for (const file of files) {
      const snapshots = new SnapshotStore(file.path, {
        update: options.updateSnapshots ?? false,
        ci: options.ci ?? false,
      });
      for (const test of file.tests) {
        if (options.grep && !test.name.includes(options.grep)) continue;

        const result: TestResult = await runSingleTest(test, connection, tools, snapshots);

        const shouldTrace =
          traceMode === "on" || (traceMode === "retain-on-failure" && result.status !== "passed");
        if (shouldTrace) {
          const tracePath = join(
            options.cwd,
            ".mcpest",
            "traces",
            `${config.name}-${traceCounter.next()}.jsonl`,
          );
          connection.trace.writeTo(tracePath);
          result.tracePath = tracePath;
        }

        results.push(result);
        if (options.bail && result.status !== "passed") {
          return { server: config.name, connection: connectionInfo(), results };
        }
      }
    }
  } catch (error) {
    results.push({
      test: allTests[results.length] ?? allTests[0]!,
      status: "error",
      durationMs: 0,
      failures: [{ path: "", message: String(error) }],
      schemaChecks: [],
    });
  } finally {
    await connection.close();
  }

  function connectionInfo() {
    return {
      ok: true,
      connectMs: Date.now() - connectStarted,
      ...(connection.protocolVersion !== undefined
        ? { protocolVersion: connection.protocolVersion }
        : {}),
      ...(connection.serverName !== undefined ? { serverName: connection.serverName } : {}),
      ...(connection.serverVersion !== undefined
        ? { serverVersion: connection.serverVersion }
        : {}),
    };
  }

  return { server: config.name, connection: connectionInfo(), results };
}

/** Bounded-concurrency execution */
async function withConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function runSuite(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const servers = loadConfig({
    cwd: options.cwd,
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
  });
  const files = discoverTests({
    cwd: options.cwd,
    ...(options.globs !== undefined ? { globs: options.globs } : {}),
    knownServers: servers.map((s) => s.name),
  });

  const targetFiles = options.server ? files.filter((f) => f.server === options.server) : files;
  const byServer = new Map<string, TestFile[]>();
  for (const file of targetFiles) {
    byServer.set(file.server, [...(byServer.get(file.server) ?? []), file]);
  }

  const traceCounter = (() => {
    let n = 0;
    return { next: () => ++n };
  })();

  const tasks = [...byServer.entries()].map(([serverName, serverFiles]) => () => {
    const config = servers.find((s) => s.name === serverName)!;
    return runServer(config, serverFiles, options, traceCounter);
  });

  const serverResults = await withConcurrency(tasks, SERVER_CONCURRENCY);

  const flat = serverResults.flatMap((s) => s.results);
  const counts = {
    passed: flat.filter((r) => r.status === "passed").length,
    failed: flat.filter((r) => r.status === "failed").length,
    errored: flat.filter((r) => r.status === "error").length,
    total: flat.length,
  };

  return {
    servers: serverResults,
    counts,
    ok: counts.failed === 0 && counts.errored === 0 && serverResults.every((s) => s.connection.ok),
    durationMs: Date.now() - started,
  };
}
