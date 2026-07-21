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
    env: { ...process.env, CI: "" }, // disable CI auto-enable so each test controls it
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
  it("exits 0 on the happy path (acceptance 1)", () => {
    const dir = setup({
      "ok.mcpt.yaml": `
server: fx
tests:
  - name: list
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

  it("exits 1 on an expect mismatch and prints the failure path (acceptance 2)", () => {
    const dir = setup({
      "ng.mcpt.yaml": `
server: fx
tests:
  - name: mismatch
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

  it("snapshots: create, detect change, then update with -u (acceptance 3)", () => {
    const dir = setup({
      "snap.mcpt.yaml": `
server: fx
tests:
  - name: list snapshot
    tools/list:
      snapshot: true
`,
    });
    // First run: created, exit 0
    expect(runCli(["test"], dir).code).toBe(0);
    const snapPath = join(dir, "__mcpest_snapshots__", "snap.mcpt.yaml.snap.json");
    expect(existsSync(snapPath)).toBe(true);

    // Tamper with the snapshot to force a mismatch
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    snap["list snapshot"].tools[0].description = "tampered";
    writeFileSync(snapPath, JSON.stringify(snap));
    expect(runCli(["test"], dir).code).toBe(1);

    // -u updates it and exit 0 returns
    expect(runCli(["test", "-u"], dir).code).toBe(0);
    expect(runCli(["test"], dir).code).toBe(0);
  }, 60_000);

  it("exits 1 when CI=true and the snapshot is missing (acceptance 3, CI part)", () => {
    const dir = setup({
      "ci.mcpt.yaml": `
server: fx
tests:
  - name: missing snapshot fails in CI
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

  it("exits 2 on invalid YAML (acceptance 10)", () => {
    const dir = setup({ "broken.mcpt.yaml": "server: [unclosed" });
    const res = runCli(["test"], dir);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("broken.mcpt.yaml");
  });

  it("exits 2 on an unknown server key and lists the available ones (acceptance 10)", () => {
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

  it("generates JUnit XML via --reporter junit --output with matching counts (acceptance 8)", () => {
    const dir = setup({
      "junit.mcpt.yaml": `
server: fx
tests:
  - name: passes
    tools/call:
      tool: echo
      args: { text: "a" }
  - name: fails
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

  it("--grep filters tests by name", () => {
    const dir = setup({
      "grep.mcpt.yaml": `
server: fx
tests:
  - name: this one runs
    tools/call:
      tool: echo
      args: { text: "a" }
  - name: failing test (proves the filter works)
    tools/call:
      tool: echo
      args: { text: "b" }
      expect: { isError: true }
`,
    });
    // Without a filter, the failing test runs too: exit 1
    expect(runCli(["test"], dir).code).toBe(1);
    // Filtered down to the passing test only: exit 0
    expect(runCli(["test", "--grep", "this one runs"], dir).code).toBe(0);
    // Filtered down to the failing test only: exit 1
    expect(runCli(["test", "--grep", "failing"], dir).code).toBe(1);
  });
});

describe("mcpest call (acceptance 11)", () => {
  it("prints the result JSON and exits 0", () => {
    const dir = setup({});
    const res = runCli(["call", "fx", "echo", "--args", '{"text":"from cli"}'], dir);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.content[0].text).toBe("from cli");
  });

  it("exits 0 even for isError:true (an execution error is a valid observation)", () => {
    const dir = setup({});
    const res = runCli(["call", "fx", "failing_tool"], dir);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).isError).toBe(true);
  });

  it("exits 0 for an unknown tool too — the high-level SDK server converts it to isError:true", () => {
    // The SDK's McpServer turns unknown tools into tool execution errors, not JSON-RPC errors
    const dir = setup({});
    const res = runCli(["call", "fx", "no_such_tool"], dir);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).isError).toBe(true);
  });

  it("exits 1 on a protocol error (a low-level server that throws)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { bad: { command: "node", args: [fixture("bad.js")] } } }),
    );
    const res = runCli(["call", "bad", "no_such_tool"], dir);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("JSON-RPC error");
  });
});

describe("mcpest list (acceptance 13)", () => {
  it("prints every tool as a table and exits 0", () => {
    const dir = setup({});
    const res = runCli(["list"], dir);
    expect(res.code).toBe(0);
    for (const name of ["echo", "get_weather", "failing_tool", "slow_tool"]) {
      expect(res.stdout).toContain(name);
    }
  });

  it("exits 2 on a connection failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { broken: { command: "node", args: ["/no/such.js"] } } }),
    );
    const res = runCli(["list", "--server", "broken"], dir);
    expect(res.code).toBe(2);
  }, 30_000);
});

describe("mcpest init (acceptance 12)", () => {
  it("generates files with defaults in a non-interactive environment and exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    const res = runCli(["init"], dir);
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, "mcp.json"))).toBe(true);
    expect(existsSync(join(dir, "example.mcpt.yaml"))).toBe(true);
  });

  it("never overwrites an existing mcp.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-cli-"));
    writeFileSync(join(dir, "mcp.json"), '{"mcpServers":{"keep":{"command":"x"}}}');
    const res = runCli(["init"], dir);
    expect(res.code).toBe(0);
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toContain("keep");
  });
});
