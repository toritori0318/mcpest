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
  - name: list snapshot
    tools/list:
      snapshot: true
  - name: call the weather tool
    tools/call:
      tool: get_weather
      args: { location: "Tokyo" }
      expect:
        isError: false
`;

describe("file discovery", () => {
  it("finds **/*.mcpt.yaml recursively", () => {
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

  it("excludes node_modules", () => {
    const dir = makeDir();
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "pkg", "x.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    const files = discoverTests({ cwd: dir, knownServers: ["weather"] });
    expect(files).toHaveLength(1);
  });

  it("explicit globs take precedence", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    writeFileSync(join(dir, "b.mcpt.yaml"), VALID_YAML);
    const files = discoverTests({ cwd: dir, globs: ["a.mcpt.yaml"], knownServers: ["weather"] });
    expect(files).toHaveLength(1);
  });
});

describe("normalization into TestCase", () => {
  it("defaults: timeout 30000 / validateInput+validateOutput true / snapshot false", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "a.mcpt.yaml"), VALID_YAML);
    const [file] = discoverTests({ cwd: dir, knownServers: ["weather"] });
    const call = file!.tests[1]!;
    expect(call).toMatchObject({
      name: "call the weather tool",
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

  it("a file-level timeout is inherited and can be overridden per test", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "a.mcpt.yaml"),
      `
server: weather
timeout: 5000
tests:
  - name: inherited
    tools/list: {}
  - name: overridden
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

describe("validation errors", () => {
  it("a tools/call without tool is an error naming the file", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "broken.mcpt.yaml"),
      `
server: weather
tests:
  - name: missing tool
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

  it("duplicate test names within a file are an error (snapshot key collision)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "dup.mcpt.yaml"),
      `
server: weather
tests:
  - name: same name
    tools/list: {}
  - name: same name
    tools/list: {}
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /same name/,
    );
  });

  it("an unknown server key is an error listing the available ones", () => {
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

  it("a YAML syntax error names the file", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "syntax.mcpt.yaml"), "server: [unclosed");
    expect(() => discoverTests({ cwd: dir, knownServers: [] })).toThrowError(
      /syntax\.mcpt\.yaml/,
    );
  });

  it("a test without a method is an error", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "nomethod.mcpt.yaml"),
      `
server: weather
tests:
  - name: does nothing
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      DiscoveryError,
    );
  });

  it("an unknown top-level file key is an error naming the key (typo protection)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "typo.mcpt.yaml"),
      `
server: weather
descrption: oops
tests:
  - name: t
    tools/list: {}
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /descrption/,
    );
  });

  it("an unknown test-level key is an error naming the key (typo protection)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "typo.mcpt.yaml"),
      `
server: weather
tests:
  - name: t
    tiemout: 1000
    tools/list: {}
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /tiemout/,
    );
  });

  it("an unknown key inside tools/call is an error naming the key (typo protection)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "typo.mcpt.yaml"),
      `
server: weather
tests:
  - name: t
    tools/call:
      tool: echo
      args: { text: hi }
      exepct: { isError: false }
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /exepct/,
    );
  });

  it("an unknown key inside tools/list is an error naming the key (typo protection)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "typo.mcpt.yaml"),
      `
server: weather
tests:
  - name: t
    tools/list:
      snapshot: true
      tool: not-allowed-here
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /tool/,
    );
  });

  it("expect.error on tools/list is an error (tools/list has no per-test protocol call to fail)", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, "badexpect.mcpt.yaml"),
      `
server: weather
tests:
  - name: t
    tools/list:
      expect:
        error: { code: -32601 }
`,
    );
    expect(() => discoverTests({ cwd: dir, knownServers: ["weather"] })).toThrowError(
      /expect\.error/,
    );
  });
});
