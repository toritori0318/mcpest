// Streamable HTTP トランスポートで fixtures サーバーを起動するエントリポイント。
// 使い方: PORT=3901 node fixtures/server/http.js
// MCPEST_FIXTURE_REQUIRE_AUTH=1 を設定すると `Authorization: Bearer test-token` ヘッダを要求し、
// 無ければ 401 を返す（mcpest の headers 注入が実際に効いていることの検証用）。
// ステートレスモード（リクエストごとに transport/server を生成）を採用。
// セッション管理はここでは不要で、fixtures を最小に保つため。
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
  // テストコードが起動完了を検知するための行（stdout は MCP メッセージではないので自由に使える）
  console.log(`mcpest-fixture-http listening on ${port}`);
});
