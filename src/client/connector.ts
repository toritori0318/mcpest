/**
 * Establishes an SDK Client connection from a ServerConfig.
 * The initialize/initialized handshake is delegated to the SDK; mcpest hooks
 * into the transport layer to record every JSON-RPC message for tracing.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerConfig } from "../config/loader.js";
import { TraceRecorder } from "./tracer.js";

export class ConnectionError extends Error {
  override name = "ConnectionError";
  stderrTail?: string;
}

export interface Connection {
  client: Client;
  trace: TraceRecorder;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  close(): Promise<void>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** Intercept the transport's send / onmessage to record every message */
function instrument(transport: Transport, trace: TraceRecorder): void {
  const originalSend = transport.send.bind(transport);
  transport.send = (message, options) => {
    trace.record("send", message);
    return originalSend(message, options);
  };

  // The SDK's Protocol layer assigns onmessage during connect, so hijack the
  // setter to slip in a wrapped handler
  let handler: ((message: unknown, extra?: unknown) => void) | undefined;
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    get: () => handler,
    set: (fn: (message: unknown, extra?: unknown) => void) => {
      handler = (message, extra) => {
        trace.record("recv", message);
        fn(message, extra);
      };
    },
  });
}

function buildEnv(configEnv: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") merged[k] = v;
  }
  return { ...merged, ...configEnv };
}

export async function connect(
  config: ServerConfig,
  options?: { connectTimeoutMs?: number },
): Promise<Connection> {
  const trace = new TraceRecorder();
  trace.setSecrets(
    config.kind === "stdio" ? Object.values(config.env) : Object.values(config.headers),
  );

  const stderrChunks: string[] = [];
  let transport: Transport;

  if (config.kind === "stdio") {
    const stdioTransport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: buildEnv(config.env),
      stderr: "pipe",
    });
    stdioTransport.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });
    transport = stdioTransport;
  } else {
    // Cast needed due to exactOptionalPropertyTypes friction with SDK typings
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    }) as unknown as Transport;
  }

  instrument(transport, trace);

  const client = new Client({ name: "mcpest", version: "0.1.0" });
  const timeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`connection was not established within ${timeoutMs}ms`)),
          timeoutMs,
        ).unref(),
      ),
    ]);
  } catch (error) {
    await transport.close().catch(() => {});
    const connError = new ConnectionError(
      `failed to connect to server "${config.name}": ${error instanceof Error ? error.message : String(error)}`,
    );
    const tail = stderrChunks.join("").trim().split("\n").slice(-20).join("\n");
    if (tail) connError.stderrTail = tail;
    throw connError;
  }

  const serverVersion = client.getServerVersion();
  const negotiated = trace.findNegotiatedProtocolVersion();

  return {
    client,
    trace,
    ...(negotiated !== undefined ? { protocolVersion: negotiated } : {}),
    ...(serverVersion?.name !== undefined ? { serverName: String(serverVersion.name) } : {}),
    ...(serverVersion?.version !== undefined
      ? { serverVersion: String(serverVersion.version) }
      : {}),
    close: async () => {
      // MCP-spec shutdown: for stdio the SDK's StdioClientTransport.close handles
      // stdin close → SIGTERM → SIGKILL; for HTTP it just closes the connection.
      await client.close().catch(() => {});
    },
  };
}
