// outputSchema に不適合な structuredContent を返す「行儀の悪い」fixtures サーバー。
// 高レベル McpServer はサーバー側で出力を検証して例外にしてしまうため、
// 仕様違反サーバーを再現する目的で低レベル Server を直接使う。
// 使い方: node fixtures/server/bad.js（stdio）
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mcpest-fixture-bad", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const badWeatherTool = {
  name: "bad_weather",
  description: "Declares an outputSchema but returns non-conforming structuredContent",
  inputSchema: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  outputSchema: {
    type: "object",
    properties: {
      temperature: { type: "number" },
      conditions: { type: "string" },
    },
    required: ["temperature", "conditions"],
  },
};

const missingStructuredTool = {
  name: "missing_structured",
  description: "Declares an outputSchema but omits structuredContent entirely",
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [badWeatherTool, missingStructuredTool],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "bad_weather") {
    // temperature を文字列で返す = outputSchema 違反
    const structuredContent = { temperature: "very hot", conditions: "Sunny" };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }
  if (request.params.name === "missing_structured") {
    return { content: [{ type: "text", text: "no structured content here" }] };
  }
  throw new Error(`unknown tool: ${request.params.name}`);
});

await server.connect(new StdioServerTransport());
