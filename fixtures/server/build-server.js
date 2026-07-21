// The standard fixture server that mcpest's acceptance tests run against.
// Four tools: echo / get_weather (with outputSchema) / failing_tool (isError) / slow_tool (3s delay).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function buildServer() {
  const server = new McpServer({ name: "mcpest-fixture", version: "1.0.0" });

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Echoes back the given text",
      inputSchema: { text: z.string().describe("Text to echo back") },
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );

  server.registerTool(
    "get_weather",
    {
      title: "Weather",
      description: "Get current weather for a location",
      inputSchema: { location: z.string().describe("City name") },
      outputSchema: {
        temperature: z.number(),
        conditions: z.string(),
        humidity: z.number(),
      },
    },
    async ({ location }) => {
      if (location === "nowhere-xyz") {
        return {
          content: [{ type: "text", text: `location not found: ${location}` }],
          isError: true,
        };
      }
      const structuredContent = { temperature: 22.5, conditions: `Sunny in ${location}`, humidity: 65 };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "failing_tool",
    {
      title: "Failing Tool",
      description: "Always returns a tool execution error",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "boom: upstream API returned 500" }],
      isError: true,
    }),
  );

  server.registerTool(
    "slow_tool",
    {
      title: "Slow Tool",
      description: "Waits 3 seconds before responding",
      inputSchema: {},
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return { content: [{ type: "text", text: "finally done" }] };
    },
  );

  return server;
}
