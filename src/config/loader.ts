/**
 * mcp.json（MCP クライアント標準の mcpServers 形式）を読み、ServerConfig[] へ正規化する。
 * 既存の設定ファイルをそのまま流用できることが mcpest の DX の柱なので、
 * ここでは独自形式を導入しない。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ServerConfig =
  | { name: string; kind: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { name: string; kind: "streamable-http"; url: string; headers: Record<string, string> };

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface LoadConfigOptions {
  cwd: string;
  configPath?: string;
  /** ${VAR} 展開に使う環境変数。省略時は process.env */
  env?: Record<string, string | undefined>;
}

function expandVars(value: string, env: Record<string, string | undefined>, context: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const resolved = env[name];
    if (resolved === undefined) {
      throw new ConfigError(
        `${context} が参照する環境変数 \${${name}} が定義されていません`,
      );
    }
    return resolved;
  });
}

function expandRecord(
  record: Record<string, string>,
  env: Record<string, string | undefined>,
  context: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, expandVars(v, env, `${context}.${k}`)]),
  );
}

function resolveConfigPath(cwd: string, configPath?: string): string {
  if (configPath) {
    if (!existsSync(configPath)) {
      throw new ConfigError(`設定ファイルが見つかりません: ${configPath}`);
    }
    return configPath;
  }
  for (const candidate of [join(cwd, "mcp.json"), join(cwd, ".mcp.json")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ConfigError(
    `設定ファイルが見つかりません。${cwd} に mcp.json / .mcp.json を置くか --config で指定してください`,
  );
}

function normalizeServer(
  name: string,
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): ServerConfig {
  const hasCommand = typeof raw["command"] === "string";
  const hasUrl = typeof raw["url"] === "string";
  const declaredType = raw["type"];

  if (hasCommand && hasUrl) {
    throw new ConfigError(
      `サーバー "${name}": command と url の両方が指定されています。stdio なら command、streamable-http なら url のどちらか一方にしてください`,
    );
  }

  const kind =
    declaredType === "stdio"
      ? "stdio"
      : declaredType === "streamable-http" || declaredType === "http"
        ? "streamable-http"
        : hasCommand
          ? "stdio"
          : hasUrl
            ? "streamable-http"
            : undefined;

  if (kind === "stdio") {
    if (!hasCommand) {
      throw new ConfigError(`サーバー "${name}": stdio には command が必要です`);
    }
    const args = Array.isArray(raw["args"]) ? raw["args"].map(String) : [];
    const rawEnv = (raw["env"] ?? {}) as Record<string, string>;
    return {
      name,
      kind: "stdio",
      command: String(raw["command"]),
      args,
      env: expandRecord(rawEnv, env, `mcpServers.${name}.env`),
    };
  }

  if (kind === "streamable-http") {
    if (!hasUrl) {
      throw new ConfigError(`サーバー "${name}": streamable-http には url が必要です`);
    }
    const rawHeaders = (raw["headers"] ?? {}) as Record<string, string>;
    return {
      name,
      kind: "streamable-http",
      url: expandVars(String(raw["url"]), env, `mcpServers.${name}.url`),
      headers: expandRecord(rawHeaders, env, `mcpServers.${name}.headers`),
    };
  }

  throw new ConfigError(
    `サーバー "${name}": command（stdio）か url（streamable-http）のどちらかが必要です`,
  );
}

export function loadConfig(options: LoadConfigOptions): ServerConfig[] {
  const env = options.env ?? process.env;
  const path = resolveConfigPath(options.cwd, options.configPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`${path} の JSON パースに失敗しました: ${String(error)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["mcpServers"] !== "object" ||
    (parsed as Record<string, unknown>)["mcpServers"] === null
  ) {
    throw new ConfigError(`${path} に mcpServers オブジェクトがありません`);
  }

  const mcpServers = (parsed as { mcpServers: Record<string, Record<string, unknown>> })
    .mcpServers;
  return Object.entries(mcpServers).map(([name, raw]) => normalizeServer(name, raw, env));
}
