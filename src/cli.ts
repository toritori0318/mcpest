#!/usr/bin/env node
/**
 * CLI エントリポイント。コマンド定義と引数解析のみを担い、ロジックは commands/* に置く。
 */
import { Command } from "commander";
import { callCommand } from "./commands/call.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { testCommand } from "./commands/test.js";

const program = new Command();

program.name("mcpest").description("A delightful test runner for MCP servers").version("0.0.1");

program
  .command("test", { isDefault: true })
  .description("*.mcpt.yaml のテストを実行する")
  .argument("[globs...]", "テストファイルの glob（既定: **/*.mcpt.yaml）")
  .option("--config <path>", "mcp.json のパス")
  .option("--server <name>", "対象サーバーを限定")
  .option("--grep <pattern>", "テスト name の部分一致フィルタ")
  .option("--reporter <name>", "pretty | junit | json", "pretty")
  .option("--output <path>", "junit / json の出力先ファイル")
  .option("-u, --update-snapshots", "スナップショットを実行結果で更新")
  .option("--ci", "CI モード（未存在スナップショット = 失敗）。CI=true で自動有効化")
  .option("--trace <mode>", "off | on | retain-on-failure", "retain-on-failure")
  .option("--bail", "最初の失敗で停止")
  .action(async (globs: string[], opts) => {
    const code = await testCommand({
      cwd: process.cwd(),
      ...(globs.length > 0 ? { globs } : {}),
      ...(opts.config !== undefined ? { configPath: opts.config } : {}),
      ...(opts.server !== undefined ? { server: opts.server } : {}),
      ...(opts.grep !== undefined ? { grep: opts.grep } : {}),
      reporter: opts.reporter,
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      updateSnapshots: opts.updateSnapshots === true,
      ci: opts.ci === true,
      traceMode: opts.trace,
      bail: opts.bail === true,
      color: process.stdout.isTTY === true,
    });
    process.exit(code);
  });

program
  .command("call")
  .description("ツールを単発で呼び出して結果 JSON を表示する")
  .argument("<server>", "mcp.json の mcpServers キー名")
  .argument("<tool>", "ツール名")
  .option("--args <json>", "ツール引数（JSON 文字列）")
  .option("--config <path>", "mcp.json のパス")
  .action(async (server: string, tool: string, opts) => {
    const code = await callCommand({
      cwd: process.cwd(),
      serverName: server,
      toolName: tool,
      ...(opts.args !== undefined ? { argsJson: opts.args } : {}),
      ...(opts.config !== undefined ? { configPath: opts.config } : {}),
    });
    process.exit(code);
  });

program
  .command("list")
  .description("接続して利用可能なツールを表形式で表示する")
  .option("--server <name>", "対象サーバーを限定")
  .option("--config <path>", "mcp.json のパス")
  .action(async (opts) => {
    const code = await listCommand({
      cwd: process.cwd(),
      ...(opts.server !== undefined ? { server: opts.server } : {}),
      ...(opts.config !== undefined ? { configPath: opts.config } : {}),
    });
    process.exit(code);
  });

program
  .command("init")
  .description("mcp.json とサンプルテストを生成する")
  .action(() => {
    process.exit(initCommand({ cwd: process.cwd() }));
  });

await program.parseAsync();
