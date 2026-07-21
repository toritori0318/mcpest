import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "dist", "cli.js");
const fixture = (name: string) => join(repoRoot, "fixtures", "server", name);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
}, 60_000);

function runCli(args: string[], cwd: string) {
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "" }, // CI 自動有効化をテストごとに制御するため既定は無効
    timeout: 60_000,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function setup(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
  writeFileSync(
    join(dir, "mcp.json"),
    JSON.stringify({ mcpServers: { fx: { command: "node", args: [fixture("stdio.js")] } } }),
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("mcpest test", () => {
  it("正常系で exit 0（受け入れ1）", () => {
    const dir = setup({
      "ok.mcpt.yaml": `
server: fx
tests:
  - name: 一覧
    tools/list:
      snapshot: true
  - name: echo
    tools/call:
      tool: echo
      args: { text: "hi" }
`,
    });
    const res = runCli(["test"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("passed");
  });

  it("expect 不一致で exit 1、失敗パスが stdout に出る（受け入れ2）", () => {
    const dir = setup({
      "ng.mcpt.yaml": `
server: fx
tests:
  - name: 不一致
    tools/call:
      tool: echo
      args: { text: "actual" }
      expect:
        content:
          - type: text
            text: "different"
`,
    });
    const res = runCli(["test"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("content");
  });

  it("スナップショット: 生成 → 変更検知 → -u で更新（受け入れ3）", () => {
    const dir = setup({
      "snap.mcpt.yaml": `
server: fx
tests:
  - name: 一覧スナップショット
    tools/list:
      snapshot: true
`,
    });
    // 初回: 生成されて exit 0
    expect(runCli(["test"], dir).code).toBe(0);
    const snapPath = join(dir, "__mcpest_snapshots__", "snap.mcpt.yaml.snap.json");
    expect(existsSync(snapPath)).toBe(true);

    // スナップショットを故意に書き換えて mismatch を作る
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    snap["一覧スナップショット"].tools[0].description = "書き換えた";
    writeFileSync(snapPath, JSON.stringify(snap));
    expect(runCli(["test"], dir).code).toBe(1);

    // -u で更新されて exit 0 に戻る
    expect(runCli(["test", "-u"], dir).code).toBe(0);
    expect(runCli(["test"], dir).code).toBe(0);
  }, 60_000);

  it("CI=true かつスナップショット未存在で exit 1（受け入れ3後段）", () => {
    const dir = setup({
      "ci.mcpt.yaml": `
server: fx
tests:
  - name: CI では未存在が失敗
    tools/list:
      snapshot: true
`,
    });
    const res = spawnSync(process.execPath, [cliPath, "test"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 60_000,
    });
    expect(res.status).toBe(1);
  });

  it("不正 YAML は exit 2（受け入れ10）", () => {
    const dir = setup({ "broken.mcpt.yaml": "server: [unclosed" });
    const res = runCli(["test"], dir);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("broken.mcpt.yaml");
  });

  it("未知の server キーは exit 2 で候補一覧を出す（受け入れ10）", () => {
    const dir = setup({
      "unknown.mcpt.yaml": `
server: nosuch
tests:
  - name: t
    tools/list: {}
`,
    });
    const res = runCli(["test"], dir);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("fx");
  });

  it("--reporter junit --output で JUnit XML が生成され、件数が一致する（受け入れ8）", () => {
    const dir = setup({
      "junit.mcpt.yaml": `
server: fx
tests:
  - name: パスする
    tools/call:
      tool: echo
      args: { text: "a" }
  - name: 失敗する
    tools/call:
      tool: echo
      args: { text: "b" }
      expect: { isError: true }
`,
    });
    const res = runCli(["test", "--reporter", "junit", "--output", "r.xml"], dir);
    expect(res.code).toBe(1);
    const xml = readFileSync(join(dir, "r.xml"), "utf8");
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
  });

  it("--grep でテストを絞り込める", () => {
    const dir = setup({
      "grep.mcpt.yaml": `
server: fx
tests:
  - name: これは走る
    tools/call:
      tool: echo
      args: { text: "a" }
  - name: 失敗するテスト（絞り込みの証明用）
    tools/call:
      tool: echo
      args: { text: "b" }
      expect: { isError: true }
`,
    });
    // 絞り込みなし: 失敗するテストも走るので exit 1
    expect(runCli(["test"], dir).code).toBe(1);
    // パスするテストだけに絞れば exit 0
    expect(runCli(["test", "--grep", "これは走る"], dir).code).toBe(0);
    // 失敗するテストだけに絞れば exit 1
    expect(runCli(["test", "--grep", "失敗する"], dir).code).toBe(1);
  });
});

describe("mcpest call（受け入れ11）", () => {
  it("結果 JSON を出力して exit 0", () => {
    const dir = setup({});
    const res = runCli(["call", "fx", "echo", "--args", '{"text":"from cli"}'], dir);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.content[0].text).toBe("from cli");
  });

  it("isError:true でも exit 0（実行エラーは正常な観察結果）", () => {
    const dir = setup({});
    const res = runCli(["call", "fx", "failing_tool"], dir);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).isError).toBe(true);
  });

  it("未知ツールでも高レベル SDK サーバーは isError:true を返すので exit 0", () => {
    // SDK の McpServer は未知ツールを JSON-RPC エラーでなくツール実行エラーに変換する
    const dir = setup({});
    const res = runCli(["call", "fx", "no_such_tool"], dir);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).isError).toBe(true);
  });

  it("プロトコルエラー（低レベルサーバーが throw）は exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { bad: { command: "node", args: [fixture("bad.js")] } } }),
    );
    const res = runCli(["call", "bad", "no_such_tool"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("JSON-RPC エラー");
  });
});

describe("mcpest list（受け入れ13）", () => {
  it("全ツールを表形式で出力して exit 0", () => {
    const dir = setup({});
    const res = runCli(["list"], dir);
    expect(res.code).toBe(0);
    for (const name of ["echo", "get_weather", "failing_tool", "slow_tool"]) {
      expect(res.stdout).toContain(name);
    }
  });

  it("接続失敗は exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { broken: { command: "node", args: ["/no/such.js"] } } }),
    );
    const res = runCli(["list", "--server", "broken"], dir);
    expect(res.code).toBe(2);
  }, 30_000);
});

describe("mcpest init（受け入れ12）", () => {
  it("非対話環境ではデフォルト値でファイル生成して exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    const res = runCli(["init"], dir);
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, "mcp.json"))).toBe(true);
    expect(existsSync(join(dir, "example.mcpt.yaml"))).toBe(true);
  });

  it("既存の mcp.json は上書きしない", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(join(dir, "mcp.json"), '{"mcpServers":{"keep":{"command":"x"}}}');
    const res = runCli(["init"], dir);
    expect(res.code).toBe(0);
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toContain("keep");
  });
});
