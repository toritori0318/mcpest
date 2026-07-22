#!/usr/bin/env node
/**
 * CLI entry point. Only command definitions and argument parsing live here;
 * logic belongs in commands/*.
 */
import { Command, Option } from "commander";
import { callCommand } from "./commands/call.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { testCommand } from "./commands/test.js";

const program = new Command();

program.name("mcpest").description("A delightful test runner for MCP servers").version("0.1.0");

program
  .command("test", { isDefault: true })
  .description("run *.mcpt.yaml tests")
  .argument("[globs...]", "test file globs (default: **/*.mcpt.yaml)")
  .option("--config <path>", "path to mcp.json")
  .option("--server <name>", "restrict to a single server")
  .option("--grep <pattern>", "substring filter on test names")
  .option("--reporter <name>", "pretty | junit | json", "pretty")
  .option("--output <path>", "output file for junit / json reporters")
  .option("-u, --update-snapshots", "update snapshots with the current results")
  .option("--ci", "CI mode (missing snapshot = failure); auto-enabled when CI=true")
  .addOption(
    new Option("--trace <mode>", "off | on | retain-on-failure")
      .choices(["off", "on", "retain-on-failure"])
      .default("retain-on-failure"),
  )
  .option("--bail", "stop at the first failure")
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
  .description("call a single tool and print the result JSON")
  .argument("<server>", "a key in mcp.json's mcpServers")
  .argument("<tool>", "tool name")
  .option("--args <json>", "tool arguments (JSON string)")
  .option("--config <path>", "path to mcp.json")
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
  .description("connect and list available tools")
  .option("--server <name>", "restrict to a single server")
  .option("--config <path>", "path to mcp.json")
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
  .description("generate mcp.json and a sample test")
  .action(() => {
    process.exit(initCommand({ cwd: process.cwd() }));
  });

await program.parseAsync();
