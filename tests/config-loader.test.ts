import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/loader.js";

// loadConfig({ cwd, configPath?, env? }) => ServerConfig[]
// mcp.json の mcpServers 形式を ServerConfig の配列へ正規化する。

function writeConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(json));
  return dir;
}

describe("mcpServers 形式のパース", () => {
  it("stdio 設定（command/args/env）を正規化する", () => {
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

  it("args/env 省略時は空配列・空オブジェクトになる", () => {
    const dir = writeConfig({ mcpServers: { s: { command: "node" } } });
    const servers = loadConfig({ cwd: dir });
    expect(servers[0]).toMatchObject({ args: [], env: {} });
  });

  it("streamable-http 設定（type/url/headers）を正規化する", () => {
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

  it('"http" を "streamable-http" の同義として受理する', () => {
    const dir = writeConfig({
      mcpServers: { r: { type: "http", url: "http://localhost:3000/mcp" } },
    });
    expect(loadConfig({ cwd: dir })[0]).toMatchObject({ kind: "streamable-http" });
  });
});

describe("type 省略時の推論", () => {
  it("command があれば stdio", () => {
    const dir = writeConfig({ mcpServers: { s: { command: "node" } } });
    expect(loadConfig({ cwd: dir })[0]!.kind).toBe("stdio");
  });

  it("url があれば streamable-http", () => {
    const dir = writeConfig({ mcpServers: { s: { url: "http://x/mcp" } } });
    expect(loadConfig({ cwd: dir })[0]!.kind).toBe("streamable-http");
  });

  it("command と url の両方があればエラーで、メッセージに両キー名を含む", () => {
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

  it("どちらも無ければエラー", () => {
    const dir = writeConfig({ mcpServers: { s: {} } });
    expect(() => loadConfig({ cwd: dir })).toThrowError(ConfigError);
  });
});

describe("環境変数の展開", () => {
  it("env の値の ${VAR} を展開する（テスト用に env を注入）", () => {
    const dir = writeConfig({
      mcpServers: { s: { command: "node", env: { KEY: "${MY_SECRET}" } } },
    });
    const servers = loadConfig({ cwd: dir, env: { MY_SECRET: "s3cret" } });
    expect(servers[0]).toMatchObject({ env: { KEY: "s3cret" } });
  });

  it("url と headers 内の ${VAR} も展開する", () => {
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

  it("未定義の ${VAR} はエラー（黙って空文字にしない）", () => {
    const dir = writeConfig({
      mcpServers: { s: { command: "node", env: { KEY: "${UNDEFINED_VAR_XYZ}" } } },
    });
    expect(() => loadConfig({ cwd: dir, env: {} })).toThrowError(/UNDEFINED_VAR_XYZ/);
  });
});

describe("探索順とエラー", () => {
  it("configPath 指定が最優先", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, "custom.json"), JSON.stringify({ mcpServers: { a: { command: "x" } } }));
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { b: { command: "y" } } }));
    const servers = loadConfig({ cwd: dir, configPath: join(dir, "custom.json") });
    expect(servers[0]!.name).toBe("a");
  });

  it("mcp.json が無ければ .mcp.json にフォールバック", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { c: { command: "z" } } }));
    expect(loadConfig({ cwd: dir })[0]!.name).toBe("c");
  });

  it("どこにも無ければ探索した場所を含むエラー", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    try {
      loadConfig({ cwd: dir });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(String(e)).toContain("mcp.json");
    }
  });

  it("JSON 構文エラーはファイル名を含むエラー", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-config-"));
    writeFileSync(join(dir, "mcp.json"), "{ broken json");
    try {
      loadConfig({ cwd: dir });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("mcp.json");
    }
  });

  it("mcpServers キーが無ければエラー", () => {
    const dir = writeConfig({ servers: {} });
    expect(() => loadConfig({ cwd: dir })).toThrowError(/mcpServers/);
  });
});
