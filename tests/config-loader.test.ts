import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/loader.js";

// loadConfig({ cwd, configPath?, env? }) => ServerConfig[]
// Normalizes the mcp.json mcpServers format into an array of ServerConfig.

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(json));
  return dir;
}

describe("parsing the mcpServers format", () => {
  it("normalizes a stdio config (command/args/env)", () => {
    const dir = writeConfig({
      mcpServers: {
        weather: { command: "node", args: ["build/index.js"], env: { API_KEY: "k" } },
      },
    });
    const servers = loadConfig({ cwd: dir });
    expect(servers).toEqual([
      {
        name: "weather",
        kind: "stdio",
        command: "node",
        args: ["build/index.js"],
        env: { API_KEY: "k" },
      },
    ]);
  });

  it("defaults args/env to an empty array/object", () => {
    const dir = writeConfig({ mcpServers: { s: { command: "node" } } });
    const servers = loadConfig({ cwd: dir });
    expect(servers[0]).toMatchObject({ args: [], env: {} });
  });

  it("normalizes a streamable-http config (type/url/headers)", () => {
    const dir = writeConfig({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer x" },
        },
      },
    });
    expect(loadConfig({ cwd: dir })).toEqual([
      {
        name: "remote",
        kind: "streamable-http",
        url: "http://localhost:3000/mcp",
        headers: { Authorization: "Bearer x" },
      },
    ]);
  });

  it('accepts "http" as an alias of "streamable-http"', () => {
    const dir = writeConfig({
      mcpServers: { r: { type: "http", url: "http://localhost:3000/mcp" } },
    });
    expect(loadConfig({ cwd: dir })[0]).toMatchObject({ kind: "streamable-http" });
  });
});

describe("inference when type is omitted", () => {
  it("command implies stdio", () => {
    const dir = writeConfig({ mcpServers: { s: { command: "node" } } });
    expect(loadConfig({ cwd: dir })[0]!.kind).toBe("stdio");
  });

  it("url implies streamable-http", () => {
    const dir = writeConfig({ mcpServers: { s: { url: "http://x/mcp" } } });
    expect(loadConfig({ cwd: dir })[0]!.kind).toBe("streamable-http");
  });

  it("both command and url is an error naming both keys", () => {
    const dir = writeConfig({
      mcpServers: { s: { command: "node", url: "http://x/mcp" } },
    });
    expect(() => loadConfig({ cwd: dir })).toThrowError(ConfigError);
    try {
      loadConfig({ cwd: dir });
    } catch (e) {
      expect(String(e)).toContain("command");
      expect(String(e)).toContain("url");
    }
  });

  it("neither command nor url is an error", () => {
    const dir = writeConfig({ mcpServers: { s: {} } });
    expect(() => loadConfig({ cwd: dir })).toThrowError(ConfigError);
  });
});

describe("environment variable expansion", () => {
  it("expands ${VAR} in env values (env injected for the test)", () => {
    const dir = writeConfig({
      mcpServers: { s: { command: "node", env: { KEY: "${MY_SECRET}" } } },
    });
    const servers = loadConfig({ cwd: dir, env: { MY_SECRET: "s3cret" } });
    expect(servers[0]).toMatchObject({ env: { KEY: "s3cret" } });
  });

  it("expands ${VAR} inside url and headers too", () => {
    const dir = writeConfig({
      mcpServers: {
        r: {
          url: "http://localhost:${PORT}/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      },
    });
    const servers = loadConfig({ cwd: dir, env: { PORT: "3901", TOKEN: "t0k" } });
    expect(servers[0]).toMatchObject({
      url: "http://localhost:3901/mcp",
      headers: { Authorization: "Bearer t0k" },
    });
  });

  it("an undefined ${VAR} is an error (never silently empty)", () => {
    const dir = writeConfig({
      mcpServers: { s: { command: "node", env: { KEY: "${UNDEFINED_VAR_XYZ}" } } },
    });
    expect(() => loadConfig({ cwd: dir, env: {} })).toThrowError(/UNDEFINED_VAR_XYZ/);
  });
});

describe("lookup order and errors", () => {
  it("an explicit configPath wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, "custom.json"), JSON.stringify({ mcpServers: { a: { command: "x" } } }));
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { b: { command: "y" } } }));
    const servers = loadConfig({ cwd: dir, configPath: join(dir, "custom.json") });
    expect(servers[0]!.name).toBe("a");
  });

  it("falls back to .mcp.json when mcp.json is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { c: { command: "z" } } }));
    expect(loadConfig({ cwd: dir })[0]!.name).toBe("c");
  });

  it("no config anywhere is an error naming the searched files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    try {
      loadConfig({ cwd: dir });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(String(e)).toContain("mcp.json");
    }
  });

  it("a JSON syntax error names the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, "mcp.json"), "{ broken json");
    try {
      loadConfig({ cwd: dir });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("mcp.json");
    }
  });

  it("a missing mcpServers key is an error", () => {
    const dir = writeConfig({ servers: {} });
    expect(() => loadConfig({ cwd: dir })).toThrowError(/mcpServers/);
  });
});
