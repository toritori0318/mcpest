import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../src/assert/snapshot.js";

// SnapshotStore manages __mcpest_snapshots__/<basename>.snap.json per test file.
// check(testName, data) => { status: "created" | "matched" | "mismatched" | "missing", diff? }

function makeStore(opts?: { update?: boolean; ci?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "mcpest-snap-"));
  const testFile = join(dir, "weather.mcpt.yaml");
  writeFileSync(testFile, "server: weather\ntests: []\n");
  return {
    dir,
    store: new SnapshotStore(testFile, { update: opts?.update ?? false, ci: opts?.ci ?? false }),
    snapPath: join(dir, "__mcpest_snapshots__", "weather.mcpt.yaml.snap.json"),
  };
}

describe("snapshot lifecycle", () => {
  it("first run creates the file and returns created", () => {
    const { store, snapPath } = makeStore();
    const result = store.check("list", { tools: [{ name: "echo" }] });
    expect(result.status).toBe("created");
    expect(existsSync(snapPath)).toBe(true);
  });

  it("re-running with identical data returns matched", () => {
    const { store } = makeStore();
    store.check("list", { tools: [{ name: "echo" }] });
    expect(store.check("list", { tools: [{ name: "echo" }] }).status).toBe("matched");
  });

  it("changed data returns mismatched with a diff", () => {
    const { store } = makeStore();
    store.check("list", { tools: [{ name: "echo", description: "old" }] });
    const result = store.check("list", { tools: [{ name: "echo", description: "new" }] });
    expect(result.status).toBe("mismatched");
    expect(result.diff).toContain("old");
    expect(result.diff).toContain("new");
  });

  it("update mode overwrites a mismatch and returns matched", () => {
    const first = makeStore();
    first.store.check("list", { v: 1 });
    const updating = new SnapshotStore(join(first.dir, "weather.mcpt.yaml"), {
      update: true,
      ci: false,
    });
    expect(updating.check("list", { v: 2 }).status).toBe("matched");
    // After the overwrite, normal mode matches too
    const after = new SnapshotStore(join(first.dir, "weather.mcpt.yaml"), {
      update: false,
      ci: false,
    });
    expect(after.check("list", { v: 2 }).status).toBe("matched");
  });

  it("CI mode returns missing for an absent snapshot and creates no file", () => {
    const { store, snapPath } = makeStore({ ci: true });
    const result = store.check("list", { v: 1 });
    expect(result.status).toBe("missing");
    expect(existsSync(snapPath)).toBe(false);
  });
});

describe("normalization", () => {
  it("treats different key orders as identical (keys are sorted)", () => {
    const { store } = makeStore();
    store.check("t", { b: 1, a: 2 });
    expect(store.check("t", { a: 2, b: 1 }).status).toBe("matched");
  });

  it("excludes nextCursor from snapshots", () => {
    const { store, snapPath } = makeStore();
    store.check("t", { tools: [], nextCursor: "abc" });
    expect(readFileSync(snapPath, "utf8")).not.toContain("nextCursor");
    expect(store.check("t", { tools: [], nextCursor: "different" }).status).toBe("matched");
  });

  it("different tests in the same file coexist under separate keys", () => {
    const { store } = makeStore();
    store.check("t1", { v: 1 });
    store.check("t2", { v: 2 });
    expect(store.check("t1", { v: 1 }).status).toBe("matched");
    expect(store.check("t2", { v: 2 }).status).toBe("matched");
  });
});
