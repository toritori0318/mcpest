/**
 * `mcpest init` — mcp.json（なければ）とサンプルテストを生成する。
 * 既存ファイルは上書きしない（init が破壊的だと安心して叩けないため）。
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

const EXAMPLE_TEST = `# mcpest のテストファイル。詳しくは https://github.com/<owner>/mcpest を参照
server: my-server
tests:
  - name: ツール一覧が壊れていない
    tools/list:
      snapshot: true

  # - name: ツールを呼んで検証する例
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
      process.stdout.write(`スキップ（既存）: ${path}\n`);
      continue;
    }
    writeFileSync(path, content);
    process.stdout.write(`作成: ${path}\n`);
  }
  process.stdout.write(
    "\nmcp.json の my-server をあなたのサーバーに書き換えて `mcpest test` を実行してください\n",
  );
  return 0;
}
