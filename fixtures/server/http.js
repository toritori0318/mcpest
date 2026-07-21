// Entry point that starts the fixture server over the Streamable HTTP transport.
// Usage: PORT=3901 node fixtures/server/http.js
// With MCPEST_FIXTURE_REQUIRE_AUTH=1 it requires an `Authorization: Bearer test-token`
// header and returns 401 otherwise (proves that mcpest's header injection works).
// Stateless mode (a fresh transport/server per request) keeps the fixture minimal;
// session management is not needed here.
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./build-server.js";

const port = Number(process.env.PORT ?? 3901);
const requireAuth = process.env.MCPEST_FIXTURE_REQUIRE_AUTH === "1";

const httpServer = createServer(async (req, res) => {
  if (requireAuth && req.headers.authorization !== "Bearer test-token") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  }
});

httpServer.listen(port, "127.0.0.1", () => {
  // Readiness line for test code (stdout is not an MCP channel here, so it's free to use)
  console.log(`mcpest-fixture-http listening on ${port}`);
});
