/**
 * `mcpest list` — connect and print tools/list as a table
 * (name / title / first 60 chars of the description).
 */
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, ConnectionError } from "../client/connector.js";
import { ConfigError, loadConfig, type ServerConfig } from "../config/loader.js";

export interface ListCommandOptions {
  cwd: string;
  configPath?: string;
  server?: string;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

async function listServer(config: ServerConfig): Promise<string[]> {
  const connection = await connect(config);
  try {
    const lines: string[] = [`[${config.name}]`];
    let cursor: string | undefined;
    const rows: Array<[string, string, string]> = [];
    do {
      const page = await connection.client.request(
        { method: "tools/list", params: cursor !== undefined ? { cursor } : {} },
        ListToolsResultSchema,
      );
      for (const tool of page.tools) {
        rows.push([
          tool.name,
          typeof tool.title === "string" ? tool.title : "",
          truncate(tool.description ?? "", 60),
        ]);
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    const nameWidth = Math.max(4, ...rows.map(([n]) => n.length));
    const titleWidth = Math.max(5, ...rows.map(([, t]) => t.length));
    lines.push(`${"NAME".padEnd(nameWidth)}  ${"TITLE".padEnd(titleWidth)}  DESCRIPTION`);
    for (const [name, title, description] of rows) {
      lines.push(`${name.padEnd(nameWidth)}  ${title.padEnd(titleWidth)}  ${description}`);
    }
    return lines;
  } finally {
    await connection.close();
  }
}

export async function listCommand(options: ListCommandOptions): Promise<number> {
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

  const targets = options.server ? servers.filter((s) => s.name === options.server) : servers;
  if (targets.length === 0) {
    process.stderr.write(
      `no matching server. Available: ${servers.map((s) => s.name).join(", ")}\n`,
    );
    return 2;
  }

  for (const config of targets) {
    try {
      process.stdout.write(`${(await listServer(config)).join("\n")}\n`);
    } catch (error) {
      if (error instanceof ConnectionError) {
        process.stderr.write(`${error.message}\n`);
        if (error.stderrTail) process.stderr.write(`${error.stderrTail}\n`);
        return 2;
      }
      throw error;
    }
  }
  return 0;
}
