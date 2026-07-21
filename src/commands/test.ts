/**
 * The `mcpest test` command. Exit code contract:
 * 0 = all passed / 1 = test failures / 2 = config or connection errors (nothing ran).
 */
import { writeFileSync } from "node:fs";
import { ConfigError } from "../config/loader.js";
import { DiscoveryError } from "../discovery.js";
import { renderJson } from "../report/json.js";
import { renderJunit } from "../report/junit.js";
import { renderPretty } from "../report/pretty.js";
import { runSuite, type RunOptions } from "../runner/runner.js";

export interface TestCommandOptions extends Omit<RunOptions, "ci"> {
  reporter?: "pretty" | "junit" | "json";
  output?: string;
  ci?: boolean;
  color: boolean;
}

export async function testCommand(options: TestCommandOptions): Promise<number> {
  let result;
  try {
    result = await runSuite({
      ...options,
      ci: options.ci || process.env["CI"] === "true",
    });
  } catch (error) {
    if (error instanceof ConfigError || error instanceof DiscoveryError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const reporter = options.reporter ?? "pretty";
  const rendered =
    reporter === "junit"
      ? renderJunit(result)
      : reporter === "json"
        ? renderJson(result)
        : renderPretty(result, { color: options.color });

  if (options.output && reporter !== "pretty") {
    writeFileSync(options.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  if (result.ok) return 0;
  // If nothing could run at all (every server failed to connect), treat it as
  // a config/connection error rather than a test failure
  const nothingRan = result.servers.length > 0 && result.servers.every((s) => !s.connection.ok);
  return nothingRan ? 2 : 1;
}
