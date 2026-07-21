/**
 * Reads mcp.json (the standard mcpServers format used by MCP clients) and
 * normalizes it into ServerConfig[]. Reusing the file developers already have
 * is a pillar of mcpest's DX, so no custom config format is introduced here.
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
  /** Environment used for ${VAR} expansion. Defaults to process.env */
  env?: Record<string, string | undefined>;
}

function expandVars(value: string, env: Record<string, string | undefined>, context: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const resolved = env[name];
    if (resolved === undefined) {
      // Failing loudly (rather than silently expanding to "") prevents invisible
      // failures like connecting with an empty auth header
      throw new ConfigError(
        `environment variable \${${name}} referenced by ${context} is not defined`,
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
      throw new ConfigError(`config file not found: ${configPath}`);
    }
    return configPath;
  }
  for (const candidate of [join(cwd, "mcp.json"), join(cwd, ".mcp.json")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ConfigError(
    `no config file found: put mcp.json / .mcp.json in ${cwd} or pass --config`,
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
      `server "${name}": both command and url are specified; use exactly one (command for stdio, url for streamable-http)`,
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
      throw new ConfigError(`server "${name}": stdio requires command`);
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
      throw new ConfigError(`server "${name}": streamable-http requires url`);
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
    `server "${name}": either command (stdio) or url (streamable-http) is required`,
  );
}

export function loadConfig(options: LoadConfigOptions): ServerConfig[] {
  const env = options.env ?? process.env;
  const path = resolveConfigPath(options.cwd, options.configPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ConfigError(`failed to parse JSON in ${path}: ${String(error)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["mcpServers"] !== "object" ||
    (parsed as Record<string, unknown>)["mcpServers"] === null
  ) {
    throw new ConfigError(`${path} has no mcpServers object`);
  }

  const mcpServers = (parsed as { mcpServers: Record<string, Record<string, unknown>> })
    .mcpServers;
  return Object.entries(mcpServers).map(([name, raw]) => normalizeServer(name, raw, env));
}
