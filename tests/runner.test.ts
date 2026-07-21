import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runSuite } from "../src/runner/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => join(repoRoot, "fixtures", "server", name);

/** Helper: place mcp.json and test YAML in a temp dir and run runSuite there */
function setup(files: Record<string, string>, mcpServers: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-run-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers }));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const stdioServer = { command: "node", args: [fixture("stdio.js")] };

describe("stdio: happy path", () => {
  it("tools/list returns 4 tools and a snapshot is created", async () => {
    const dir = setup(
      {
        "basic.mcpt.yaml": `
server: fx
tests:
  - name: list
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

  it("echo / get_weather pass expect matching and outputSchema auto-validation", async () => {
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

  it("an isError:true tool result can be matched with expect (not an automatic failure)", async () => {
    const dir = setup(
      {
        "err.mcpt.yaml": `
server: fx
tests:
  - name: tool error
    tools/call:
      tool: get_weather
      args: { location: "nowhere-xyz" }
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

describe("failure detection", () => {
  it("an isError:true tool fails even without expect (default check)", async () => {
    const dir = setup(
      {
        "default.mcpt.yaml": `
server: fx
tests:
  - name: error tool without expect
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

  it("an expect mismatch fails with a failure path", async () => {
    const dir = setup(
      {
        "fail.mcpt.yaml": `
server: fx
tests:
  - name: deliberate mismatch
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

  it("a server violating its outputSchema fails even without expect (acceptance 4)", async () => {
    const dir = setup(
      {
        "bad.mcpt.yaml": `
server: bad
tests:
  - name: wrongly typed structuredContent
    tools/call:
      tool: bad_weather
      args: { location: "x" }
  - name: missing structuredContent
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

  it("args violating inputSchema fail before the call; the trace has no tools/call (acceptance 5)", async () => {
    const dir = setup(
      {
        "badargs.mcpt.yaml": `
server: fx
tests:
  - name: wrongly typed argument
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

  it("a timeout fails as timeout and later tests still run (acceptance 6)", async () => {
    const dir = setup(
      {
        "slow.mcpt.yaml": `
server: fx
tests:
  - name: slow tool
    timeout: 1000
    tools/call:
      tool: slow_tool
  - name: still runs afterwards
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
    expect(slow!.failures.some((f) => /timeout/i.test(f.message))).toBe(true);
    expect(after!.status).toBe("passed");
  }, 30_000);

  it("an unknown tool name fails and lists the available tools", async () => {
    const dir = setup(
      {
        "unknown.mcpt.yaml": `
server: fx
tests:
  - name: unknown tool
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

describe("connection and protocol", () => {
  it("a connection failure (missing script) errors every test with stderr diagnostics (acceptance 10)", async () => {
    const dir = setup(
      {
        "conn.mcpt.yaml": `
server: broken
tests:
  - name: never runs
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

  it("tools/list follows pagination across all pages", async () => {
    const dir = setup(
      {
        "paged.mcpt.yaml": `
server: paged
tests:
  - name: all pages
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

  it("the failure trace JSONL records initialize through tools/call with directions (acceptance 9)", async () => {
    const dir = setup(
      {
        "trace.mcpt.yaml": `
server: fx
tests:
  - name: fails and leaves a trace
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

  it("passing tests keep no trace under the default retain-on-failure mode", async () => {
    const dir = setup(
      {
        "pass.mcpt.yaml": `
server: fx
tests:
  - name: passes
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

  it("env values are masked as *** in traces (non-functional)", async () => {
    const dir = setup(
      {
        "mask.mcpt.yaml": `
server: fx
tests:
  - name: echo the secret and fail on purpose
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

  it("connects to the HTTP server with headers and tests pass (acceptance 7)", async () => {
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

    // Without headers the connection must fail with 401 — proof the headers matter
    const dirNoAuth = setup(
      {
        "http.mcpt.yaml": `
server: remote
tests:
  - name: no auth
    tools/list: {}
`,
      },
      { remote: { type: "streamable-http", url: `http://127.0.0.1:${port}/` } },
    );
    const noAuth = await runSuite({ cwd: dirNoAuth, connectTimeoutMs: 5000 });
    expect(noAuth.servers[0]!.connection.ok).toBe(false);
  }, 30_000);
});
