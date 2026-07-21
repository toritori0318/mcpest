// stdio トランスポートで fixtures サーバーを起動するエントリポイント。
// 使い方: node fixtures/server/stdio.js
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./build-server.js";

const server = buildServer();
await server.connect(new StdioServerTransport());
