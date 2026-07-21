/**
 * `mcpest call <server> <tool>` — one-shot tool invocation for quick checks
 * during development (a CLI replacement for poking around in Inspector).
 * isError:true is "a tool execution error observed successfully", so it exits 0;
 * JSON-RPC errors (unknown tool etc.) exit 1; config/connection errors exit 2.
 */
import { CallToolResultSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { connect, ConnectionError } from "../client/connector.js";
import { ConfigError, loadConfig } from "../config/loader.js";

export interface CallCommandOptions {
  cwd: string;
  configPath?: string;
  serverName: string;
  toolName: string;
  argsJson?: string;
}

export async function callCommand(options: CallCommandOptions): Promise<number> {
  let servers;
  try {
    servers = loadConfig({
      cwd: options.cwd,
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const config = servers.find((s) => s.name === options.serverName);
  if (!config) {
    process.stderr.write(
      `server "${options.serverName}" not found in config. Available: ${servers.map((s) => s.name).join(", ")}\n`,
    );
    return 2;
  }

  let args: Record<string, unknown> = {};
  if (options.argsJson) {
    try {
      args = JSON.parse(options.argsJson) as Record<string, unknown>;
    } catch {
      process.stderr.write(`--args is not valid JSON: ${options.argsJson}\n`);
      return 2;
    }
  }

  let connection;
  try {
    connection = await connect(config);
  } catch (error) {
    if (error instanceof ConnectionError) {
      process.stderr.write(`${error.message}\n`);
      if (error.stderrTail) process.stderr.write(`${error.stderrTail}\n`);
      return 2;
    }
    throw error;
  }

  try {
    const result = await connection.client.request(
      { method: "tools/call", params: { name: options.toolName, arguments: args } },
      CallToolResultSchema,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof McpError) {
      process.stderr.write(`JSON-RPC error: code=${error.code} ${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await connection.close();
  }
}
