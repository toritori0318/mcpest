import type { TestCase } from "../discovery.js";

export interface TestFailure {
  path: string;
  message: string;
  diff?: string;
}

export interface SchemaCheck {
  kind: "input" | "output";
  ok: boolean;
  errors?: string[];
}

export interface TestResult {
  test: TestCase;
  status: "passed" | "failed" | "error";
  durationMs: number;
  failures: TestFailure[];
  schemaChecks: SchemaCheck[];
  tracePath?: string;
  meta?: Record<string, unknown>;
}

export interface ConnectionInfo {
  ok: boolean;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  error?: string;
  stderrTail?: string;
  connectMs?: number;
}

export interface ServerRunResult {
  server: string;
  connection: ConnectionInfo;
  results: TestResult[];
}

export interface RunResult {
  servers: ServerRunResult[];
  counts: { passed: number; failed: number; errored: number; total: number };
  ok: boolean;
  durationMs: number;
}
