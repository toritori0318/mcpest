// tools/list のページングを再現する fixtures サーバー（3 ページ × 2 ツール）。
// 高レベル McpServer はページングを露出しないため低レベル Server で実装する。
// 使い方: node fixtures/server/paged.js（stdio）
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PAGE_SIZE = 2;
const allTools = Array.from({ length: 6 }, (_, i) => ({
  name: `tool_${i + 1}`,
  description: `Paged fixture tool #${i + 1}`,
  inputSchema: { type: "object", properties: {} },
}));

const server = new Server(
  { name: "mcpest-fixture-paged", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const start = request.params?.cursor ? Number(request.params.cursor) : 0;
  const page = allTools.slice(start, start + PAGE_SIZE);
  const next = start + PAGE_SIZE;
  return {
    tools: page,
    ...(next < allTools.length ? { nextCursor: String(next) } : {}),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: `called ${request.params.name}` }],
}));

await server.connect(new StdioServerTransport());
