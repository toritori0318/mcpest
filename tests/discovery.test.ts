import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiscoveryError, discoverTests } from "../src/discovery.js";

// discoverTests({ cwd, globs?, knownServers }) => TestFile[]
// TestFile = { path, server, tests: TestCase[] }

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "mcpest-disc-"));
}

const VALID_YAML = `
server: weather
tests:
  - name: 一覧スナップショット
    tools/list:
      snapshot: true
  - name: 天気の呼び出し
    tools/call:
      tool: get_weather
      args: { location: "Tokyo" }
      expect:
        isError: false
`;

describe("ファイル発見", () => {
  it("**/*.mcpt.yaml を再帰的に発見する", () => {
    const dir = makeDir();
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "sub", "b.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "not-a-test.yaml"), VALID_YAML);
    const files = discoverTests({ cwd: dir, knownServers: ["weather"] });
    expect(files.map((f) => f.path).sort()).toEqual([
      join(dir, "a.mcpt.yaml"),
      join(dir, "sub", "b.mcpt.yaml"),
    ]);
  });

  it("node_modules 配下は除外する", () => {
    const dir = makeDir();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "x.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    const files = discoverTests({ cwd: dir, knownServers: ["weather"] });
    expect(files).toHaveLength(1);
  });

  it("glob 指定があればそれを優先する", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "b.mcpt.yaml"), VALID_YAML);
    const files = discoverTests({ cwd: dir, globs: ["a.mcpt.yaml"], knownServers: ["weather"] });
    expect(files).toHaveLength(1);
  });
});

describe("TestCase への正規化", () => {
  it("既定値: timeout 30000 / validateInput・validateOutput true / snapshot false", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    const [file] = discoverTests({ cwd: dir, knownServers: ["weather"] });
    const call = file!.tests[1]!;
    expect(call).toMatchObject({
      name: "天気の呼び出し",
      method: "tools/call",
      tool: "get_weather",
      args: { location: "Tokyo" },
      validateInput: true,
      validateOutput: true,
      snapshot: false,
      timeoutMs: 30000,
    });
    const list = file!.tests[0]!;
    expect(list).toMatchObject({ method: "tools/list", snapshot: true });
  });

  it("ファイルレベル timeout がテストに継承され、テスト側で上書きできる", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "a.mcpt.yaml"),
      `
server: weather
timeout: 5000
tests:
  - name: 継承
    tools/list: {}
  - name: 上書き
    timeout: 1000
    tools/call:
      tool: echo
      args: { text: hi }
`,
    );
    const [file] = discoverTests({ cwd: dir, knownServers: ["weather"] });
    expect(file!.tests[0]!.timeoutMs).toBe(5000);
    expect(file!.tests[1]!.timeoutMs).toBe(1000);
  });
});

describe("バリデーションエラー", () => {
  it("tools/call で tool 欠落はファイル名を含むエラー", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "broken.mcpt.yaml"),
      `
server: weather
tests:
  - name: tool が無い
    tools/call:
      args: { x: 1 }
`,
    );
    try {
      discoverTests({ cwd: dir, knownServers: ["weather"] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DiscoveryError);
      expect(String(e)).toContain("broken.mcpt.yaml");
      expect(String(e)).toContain("tool");
    }
  });

  it("同一ファイル内の name 重複はエラー（スナップショットキー衝突防止）", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "dup.mcpt.yaml"),
      `
server: weather
tests:
  - name: 同じ名前
    tools/list: {}
  - name: 同じ名前
    tools/list: {}
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /同じ名前/,
    );
  });

  it("未知の server キーはエラーで、候補一覧を含む", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML.replace("weather", "wether"));
    try {
      discoverTests({ cwd: dir, knownServers: ["weather", "remote"] });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("wether");
      expect(String(e)).toContain("weather");
      expect(String(e)).toContain("remote");
    }
  });

  it("YAML 構文エラーはファイル名を含むエラー", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "syntax.mcpt.yaml"), "server: [unclosed");
    expect(() => discoverTests({ cwd: dir, knownServers: [] })).toThrowError(
      /syntax\.mcpt\.yaml/,
    );
  });

  it("メソッド指定が無いテストはエラー", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "nomethod.mcpt.yaml"),
      `
server: weather
tests:
  - name: 何もしない
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      DiscoveryError,
    );
  });
});
