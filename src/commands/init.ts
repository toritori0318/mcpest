/**
 * `mcpest init` — generate mcp.json (when absent) and a sample test.
 * Existing files are never overwritten (an init that can destroy files
 * cannot be run with confidence).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MCP_JSON = `{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["build/index.js"]
    }
  }
}
`;

const EXAMPLE_TEST = `# mcpest test file. See https://github.com/toritori0318/mcpest
server: my-server
tests:
  - name: tool list has not drifted
    tools/list:
      snapshot: true

  # - name: call a tool and verify the result
  #   tools/call:
  #     tool: my_tool
  #     args: { key: "value" }
  #     expect:
  #       isError: false
  #       content: { $contains: "expected text" }
`;

export function initCommand(options: { cwd: string }): number {
  const targets: Array<[string, string]> = [
    [join(options.cwd, "mcp.json"), DEFAULT_MCP_JSON],
    [join(options.cwd, "example.mcpt.yaml"), EXAMPLE_TEST],
  ];
  for (const [path, content] of targets) {
    if (existsSync(path)) {
      process.stdout.write(`skipped (exists): ${path}\n`);
      continue;
    }
    writeFileSync(path, content);
    process.stdout.write(`created: ${path}\n`);
  }
  process.stdout.write(
    "\nEdit my-server in mcp.json to point at your server, then run `mcpest test`\n",
  );
  return 0;
}
