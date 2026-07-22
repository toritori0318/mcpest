import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, loadConfig, runSuite } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => join(repoRoot, "fixtures", "server", name);

describe("programmatic API (src/index.ts)", () => {
  it("exposes runSuite so a suite can be run from another test harness", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-api-"));
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: { fx: { command: "node", args: [fixture("stdio.js")] } },
      }),
    );
    writeFileSync(
      join(dir, "basic.mcpt.yaml"),
      `
server: fx
tests:
  - name: echo
    tools/call:
      tool: echo
      args: { text: "via api" }
      expect:
        content: { $contains: "via api" }
`,
    );
    const result = await runSuite({ cwd: dir });
    expect(result.ok).toBe(true);
  });

  it("exposes loadConfig and evaluate for standalone use", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcpest-api-"));
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { s: { command: "node" } } }));
    expect(loadConfig({ cwd: dir })[0]).toMatchObject({ name: "s", kind: "stdio" });
    expect(evaluate({ a: 1 }, { a: 1, b: 2 })).toEqual([]);
  });
});
