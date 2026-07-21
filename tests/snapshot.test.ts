import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotStore } from "../src/assert/snapshot.js";

// SnapshotStore はテストファイル単位で __mcpest_snapshots__/<basename>.snap.json を管理する。
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

describe("スナップショットのライフサイクル", () => {
  it("初回実行でファイルを生成し created を返す", () => {
    const { store, snapPath } = makeStore();
    const result = store.check("一覧", { tools: [{ name: "echo" }] });
    expect(result.status).toBe("created");
    expect(existsSync(snapPath)).toBe(true);
  });

  it("同一データでの再実行は matched", () => {
    const { store } = makeStore();
    store.check("一覧", { tools: [{ name: "echo" }] });
    expect(store.check("一覧", { tools: [{ name: "echo" }] }).status).toBe("matched");
  });

  it("データが変わると mismatched になり diff を含む", () => {
    const { store } = makeStore();
    store.check("一覧", { tools: [{ name: "echo", description: "old" }] });
    const result = store.check("一覧", { tools: [{ name: "echo", description: "new" }] });
    expect(result.status).toBe("mismatched");
    expect(result.diff).toContain("old");
    expect(result.diff).toContain("new");
  });

  it("update モードでは mismatch を上書きして matched を返す", () => {
    const first = makeStore();
    first.store.check("一覧", { v: 1 });
    const updating = new SnapshotStore(join(first.dir, "weather.mcpt.yaml"), {
      update: true,
      ci: false,
    });
    expect(updating.check("一覧", { v: 2 }).status).toBe("matched");
    // 上書き後は通常モードでも一致する
    const after = new SnapshotStore(join(first.dir, "weather.mcpt.yaml"), {
      update: false,
      ci: false,
    });
    expect(after.check("一覧", { v: 2 }).status).toBe("matched");
  });

  it("CI モードでは未存在スナップショットが missing になりファイルを生成しない", () => {
    const { store, snapPath } = makeStore({ ci: true });
    const result = store.check("一覧", { v: 1 });
    expect(result.status).toBe("missing");
    expect(existsSync(snapPath)).toBe(false);
  });
});

describe("正規化", () => {
  it("キー順が違っても同一と判定する（キーソート）", () => {
    const { store } = makeStore();
    store.check("t", { b: 1, a: 2 });
    expect(store.check("t", { a: 2, b: 1 }).status).toBe("matched");
  });

  it("nextCursor はスナップショットから除外される", () => {
    const { store, snapPath } = makeStore();
    store.check("t", { tools: [], nextCursor: "abc" });
    expect(readFileSync(snapPath, "utf8")).not.toContain("nextCursor");
    expect(store.check("t", { tools: [], nextCursor: "different" }).status).toBe("matched");
  });

  it("同一ファイルの別テストは別キーで共存する", () => {
    const { store } = makeStore();
    store.check("t1", { v: 1 });
    store.check("t2", { v: 2 });
    expect(store.check("t1", { v: 1 }).status).toBe("matched");
    expect(store.check("t2", { v: 2 }).status).toBe("matched");
  });
});
