// Entry point that starts the fixture server over the stdio transport.
// Usage: node fixtures/server/stdio.js
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./build-server.js";

const server = buildServer();
await server.connect(new StdioServerTransport());
