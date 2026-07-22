/**
 * Programmatic entry point (`import { runSuite } from "mcpest"`), for
 * embedding mcpest's suite runner in another test harness (e.g. a vitest
 * file that asserts `result.ok`) instead of only shelling out to the CLI.
 */
export { runSuite, type RunOptions } from "./runner/runner.js";
export type {
  ConnectionInfo,
  RunResult,
  SchemaCheck,
  ServerRunResult,
  TestFailure,
  TestResult,
} from "./report/types.js";
export { ConfigError, loadConfig, type LoadConfigOptions, type ServerConfig } from "./config/loader.js";
export {
  discoverTests,
  DiscoveryError,
  type DiscoverOptions,
  type TestCase,
  type TestFile,
} from "./discovery.js";
export { evaluate, type MatchFailure } from "./assert/matchers.js";
