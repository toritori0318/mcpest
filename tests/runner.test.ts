import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runSuite } from "../src/runner/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => join(repoRoot, "fixtures", "server", name);

/** 一時ディレクトリに mcp.json とテスト YAML を配置して runSuite を回すヘルパ */
function setup(files: Record<string, string>, mcpServers: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-run-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers }));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const stdioServer = { command: "node", args: [fixture("stdio.js")] };

describe("stdio: 正常系", () => {
  it("tools/list が 4 ツールを返し、スナップショットが生成される", async () => {
    const dir = setup(
      {
        "basic.mcpt.yaml": `
server: fx
tests:
  - name: 一覧
    tools/list:
      snapshot: true
      expect:
        tools: { $length: 4 }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ passed: 1, failed: 0, errored: 0 });
    expect(existsSync(join(dir, "__mcpest_snapshots__", "basic.mcpt.yaml.snap.json"))).toBe(true);
  });

  it("echo / get_weather の expect 照合と outputSchema 自動検証がパスする", async () => {
    const dir = setup(
      {
        "call.mcpt.yaml": `
server: fx
tests:
  - name: echo
    tools/call:
      tool: echo
      args: { text: "hello mcpest" }
      expect:
        isError: false
        content:
          - type: text
            text: { $contains: "mcpest" }
  - name: weather
    tools/call:
      tool: get_weather
      args: { location: "Tokyo" }
      expect:
        structuredContent:
          temperature: { $type: number }
          conditions: { $regex: "Tokyo" }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);
    const weather = result.servers[0]!.results[1]!;
    expect(weather.schemaChecks.some((c) => c.kind === "output" && c.ok)).toBe(true);
  });

  it("isError:true のツール実行エラーは expect で照合できる（失敗にしない）", async () => {
    const dir = setup(
      {
        "err.mcpt.yaml": `
server: fx
tests:
  - name: ツールエラー
    tools/call:
      tool: get_weather
      args: { location: "存在しない場所XYZ" }
      expect:
        isError: true
        content: { $contains: "not found" }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);
  });
});

describe("失敗の検出", () => {
  it("expect 省略時でも isError:true のツールは failed（既定検証）", async () => {
    const dir = setup(
      {
        "default.mcpt.yaml": `
server: fx
tests:
  - name: expect なしでエラーツール
    tools/call:
      tool: failing_tool
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    const r = result.servers[0]!.results[0]!;
    expect(r.status).toBe("failed");
    expect(r.failures[0]!.message).toContain("isError");
  });

  it("expect 不一致は failed になり、失敗パスが返る", async () => {
    const dir = setup(
      {
        "fail.mcpt.yaml": `
server: fx
tests:
  - name: わざと不一致
    tools/call:
      tool: echo
      args: { text: "actual" }
      expect:
        content:
          - type: text
            text: "expected-but-different"
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(false);
    const r = result.servers[0]!.results[0]!;
    expect(r.status).toBe("failed");
    expect(r.failures.some((f) => f.path.includes("content"))).toBe(true);
  });

  it("outputSchema 不適合サーバーは expect なしでも failed（受け入れ4）", async () => {
    const dir = setup(
      {
        "bad.mcpt.yaml": `
server: bad
tests:
  - name: 型違いの structuredContent
    tools/call:
      tool: bad_weather
      args: { location: "x" }
  - name: structuredContent の欠落
    tools/call:
      tool: missing_structured
`,
      },
      { bad: { command: "node", args: [fixture("bad.js")] } },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(false);
    const [typeViolation, missing] = result.servers[0]!.results;
    expect(typeViolation!.status).toBe("failed");
    expect(typeViolation!.schemaChecks.some((c) => c.kind === "output" && !c.ok)).toBe(true);
    expect(missing!.status).toBe("failed");
  });

  it("inputSchema 不適合の args は呼び出し前に failed、トレースに tools/call が無い（受け入れ5）", async () => {
    const dir = setup(
      {
        "badargs.mcpt.yaml": `
server: fx
tests:
  - name: 引数の型違い
    tools/call:
      tool: get_weather
      args: { location: 12345 }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    const r = result.servers[0]!.results[0]!;
    expect(r.status).toBe("failed");
    expect(r.schemaChecks.some((c) => c.kind === "input" && !c.ok)).toBe(true);
    expect(r.tracePath).toBeDefined();
    const trace = readFileSync(r.tracePath!, "utf8");
    expect(trace).not.toContain('"tools/call"');
  });

  it("timeout は failed(timeout) になり後続テストは継続する（受け入れ6）", async () => {
    const dir = setup(
      {
        "slow.mcpt.yaml": `
server: fx
tests:
  - name: 遅いツール
    timeout: 1000
    tools/call:
      tool: slow_tool
  - name: 後続は動く
    tools/call:
      tool: echo
      args: { text: "still alive" }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    const [slow, after] = result.servers[0]!.results;
    expect(slow!.status).toBe("failed");
    expect(slow!.failures.some((f) => /timeout|タイムアウト/i.test(f.message))).toBe(true);
    expect(after!.status).toBe("passed");
  }, 30_000);

  it("存在しないツール名は failed で、実在ツール一覧を含む", async () => {
    const dir = setup(
      {
        "unknown.mcpt.yaml": `
server: fx
tests:
  - name: 未知ツール
    tools/call:
      tool: no_such_tool
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    const r = result.servers[0]!.results[0]!;
    expect(r.status).toBe("failed");
    expect(r.failures[0]!.message).toContain("echo");
  });
});

describe("接続とプロトコル", () => {
  it("接続失敗（存在しないスクリプト）は全テスト error + stderr 診断（受け入れ10）", async () => {
    const dir = setup(
      {
        "conn.mcpt.yaml": `
server: broken
tests:
  - name: 実行されない
    tools/list: {}
`,
      },
      { broken: { command: "node", args: ["/no/such/script.js"] } },
    );
    const result = await runSuite({ cwd: dir, connectTimeoutMs: 5000 });
    const server = result.servers[0]!;
    expect(server.connection.ok).toBe(false);
    expect(server.results[0]!.status).toBe("error");
    expect(result.ok).toBe(false);
  }, 20_000);

  it("tools/list のページングを全ページ追跡する", async () => {
    const dir = setup(
      {
        "paged.mcpt.yaml": `
server: paged
tests:
  - name: 全ページ
    tools/list:
      expect:
        tools: { $length: 6 }
`,
      },
      { paged: { command: "node", args: [fixture("paged.js")] } },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);
  });

  it("失敗時トレース JSONL に initialize〜tools/call が方向つきで記録される（受け入れ9）", async () => {
    const dir = setup(
      {
        "trace.mcpt.yaml": `
server: fx
tests:
  - name: 失敗してトレースが残る
    tools/call:
      tool: echo
      args: { text: "x" }
      expect: { isError: true }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    const r = result.servers[0]!.results[0]!;
    expect(r.status).toBe("failed");
    const lines = readFileSync(r.tracePath!, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.some((l) => l.dir === "send" && l.message.method === "initialize")).toBe(true);
    expect(lines.some((l) => l.dir === "send" && l.message.method === "tools/call")).toBe(true);
    expect(lines.some((l) => l.dir === "recv" && l.message.result)).toBe(true);
  });

  it("パスしたテストのトレースは既定（retain-on-failure）では残らない", async () => {
    const dir = setup(
      {
        "pass.mcpt.yaml": `
server: fx
tests:
  - name: パスする
    tools/call:
      tool: echo
      args: { text: "y" }
`,
      },
      { fx: stdioServer },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.servers[0]!.results[0]!.tracePath).toBeUndefined();
  });

  it("env の値はトレース内で *** にマスクされる（非機能）", async () => {
    const dir = setup(
      {
        "mask.mcpt.yaml": `
server: fx
tests:
  - name: 秘密値をエコーして失敗させる
    tools/call:
      tool: echo
      args: { text: "topsecret123" }
      expect: { isError: true }
`,
      },
      { fx: { ...stdioServer, env: { SECRET_TOKEN: "topsecret123" } } },
    );
    const result = await runSuite({ cwd: dir });
    const trace = readFileSync(result.servers[0]!.results[0]!.tracePath!, "utf8");
    expect(trace).not.toContain("topsecret123");
    expect(trace).toContain("***");
  });
});

describe("streamable-http", () => {
  let proc: ChildProcess | undefined;
  const port = 3941;

  afterAll(() => {
    proc?.kill();
  });

  it("HTTP サーバーに headers つきで接続してテストが通る（受け入れ7）", async () => {
    proc = spawn("node", [fixture("http.js")], {
      env: { ...process.env, PORT: String(port), MCPEST_FIXTURE_REQUIRE_AUTH: "1" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture http server timeout")), 10_000);
      proc!.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) {
          clearTimeout(timer);
          resolveReady();
        }
      });
    });

    const dir = setup(
      {
        "http.mcpt.yaml": `
server: remote
tests:
  - name: HTTP echo
    tools/call:
      tool: echo
      args: { text: "over http" }
      expect:
        content: { $contains: "over http" }
`,
      },
      {
        remote: {
          type: "streamable-http",
          url: `http://127.0.0.1:${port}/`,
          headers: { Authorization: "Bearer test-token" },
        },
      },
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);

    // headers が無ければ 401 で接続に失敗することも確認（ヘッダが実際に効いている証明）
    const dirNoAuth = setup(
      {
        "http.mcpt.yaml": `
server: remote
tests:
  - name: 認証なし
    tools/list: {}
`,
      },
      { remote: { type: "streamable-http", url: `http://127.0.0.1:${port}/` } },
    );
    const noAuth = await runSuite({ cwd: dirNoAuth, connectTimeoutMs: 5000 });
    expect(noAuth.servers[0]!.connection.ok).toBe(false);
  }, 30_000);
});
