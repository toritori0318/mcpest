/**
 * `mcpest test` の本体。exit code 規約: 0=全パス / 1=テスト失敗あり / 2=設定・接続エラー（テスト未実行）。
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
  // 何も実行できていない（全サーバー接続失敗）なら設定・接続エラー扱い
  const nothingRan = result.servers.length > 0 && result.servers.every((s) => !s.connection.ok);
  return nothingRan ? 2 : 1;
}
