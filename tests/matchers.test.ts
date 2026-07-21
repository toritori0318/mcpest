import { describe, expect, it } from "vitest";
import { evaluate } from "../src/assert/matchers.js";

// evaluate(expected, actual) は失敗の配列を返す。空配列 = パス。
// 各失敗は { path, message } を持ち、path は "a.b.0.c" 形式。

describe("プレーン値の深い等価", () => {
  it("プリミティブの一致はパス", () => {
    expect(evaluate("hello", "hello")).toEqual([]);
    expect(evaluate(42, 42)).toEqual([]);
    expect(evaluate(true, true)).toEqual([]);
    expect(evaluate(null, null)).toEqual([]);
  });

  it("プリミティブの不一致は失敗", () => {
    const failures = evaluate("hello", "world");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("");
  });

  it("型が違う場合も失敗", () => {
    expect(evaluate(42, "42")).toHaveLength(1);
  });
});

describe("オブジェクトの部分一致", () => {
  it("expect に書いたキーだけ検証し、余分な実キーは無視する", () => {
    expect(evaluate({ a: 1 }, { a: 1, b: 2, c: 3 })).toEqual([]);
  });

  it("expect にあるキーが実データに無ければ失敗", () => {
    const failures = evaluate({ a: 1, missing: "x" }, { a: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("missing");
  });

  it("ネストした不一致の失敗パスがドット区切りで返る", () => {
    const failures = evaluate(
      { outer: { inner: { value: 1 } } },
      { outer: { inner: { value: 2 } } },
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("outer.inner.value");
  });
});

describe("配列の位置対応比較", () => {
  it("同一要素・同一順序はパス", () => {
    expect(evaluate([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("長さ不一致は失敗", () => {
    expect(evaluate([1, 2], [1, 2, 3]).length).toBeGreaterThan(0);
  });

  it("要素の不一致はインデックスつきパスで失敗", () => {
    const failures = evaluate([1, 9], [1, 2]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("1");
  });

  it("配列要素のオブジェクトも部分一致", () => {
    expect(
      evaluate([{ type: "text" }], [{ type: "text", text: "extra ok" }]),
    ).toEqual([]);
  });
});

describe("$type マッチャ", () => {
  it.each([
    ["number", 1.5],
    ["string", "s"],
    ["boolean", false],
    ["object", { k: 1 }],
    ["array", [1]],
    ["null", null],
  ])("%s 型の一致はパス", (type, value) => {
    expect(evaluate({ $type: type }, value)).toEqual([]);
  });

  it("型不一致は失敗", () => {
    expect(evaluate({ $type: "number" }, "not a number")).toHaveLength(1);
  });

  it("配列は object 扱いしない", () => {
    expect(evaluate({ $type: "object" }, [1, 2])).toHaveLength(1);
  });
});

describe("$regex マッチャ", () => {
  it("部分一致でパス", () => {
    expect(evaluate({ $regex: "Tok" }, "Sunny in Tokyo")).toEqual([]);
  });

  it("不一致は失敗", () => {
    expect(evaluate({ $regex: "^Tokyo$" }, "Sunny in Tokyo")).toHaveLength(1);
  });

  it("非文字列に適用したら失敗", () => {
    expect(evaluate({ $regex: "1" }, 123)).toHaveLength(1);
  });
});

describe("$contains マッチャ", () => {
  it("文字列の部分一致", () => {
    expect(evaluate({ $contains: "not found" }, "location not found: x")).toEqual([]);
    expect(evaluate({ $contains: "absent" }, "hello")).toHaveLength(1);
  });

  it("配列の要素包含（深い等価）", () => {
    expect(evaluate({ $contains: 2 }, [1, 2, 3])).toEqual([]);
    expect(evaluate({ $contains: 9 }, [1, 2, 3])).toHaveLength(1);
  });

  it("content 配列特例: いずれかの item.text への部分一致", () => {
    const content = [
      { type: "text", text: "location not found: XYZ" },
      { type: "image", data: "...", mimeType: "image/png" },
    ];
    expect(evaluate({ $contains: "not found" }, content)).toEqual([]);
    expect(evaluate({ $contains: "no such text" }, content)).toHaveLength(1);
  });
});

describe("$length マッチャ", () => {
  it("数値指定: 配列・文字列の長さ一致", () => {
    expect(evaluate({ $length: 3 }, [1, 2, 3])).toEqual([]);
    expect(evaluate({ $length: 5 }, "hello")).toEqual([]);
    expect(evaluate({ $length: 2 }, [1])).toHaveLength(1);
  });

  it("比較指定: {$gte, $lte, $eq}", () => {
    expect(evaluate({ $length: { $gte: 1 } }, [1, 2])).toEqual([]);
    expect(evaluate({ $length: { $gte: 3 } }, [1, 2])).toHaveLength(1);
    expect(evaluate({ $length: { $gte: 1, $lte: 2 } }, [1, 2])).toEqual([]);
    expect(evaluate({ $length: { $eq: 2 } }, [1, 2])).toEqual([]);
  });

  it("長さを持たない値は失敗", () => {
    expect(evaluate({ $length: 1 }, 42)).toHaveLength(1);
  });
});

describe("数値比較マッチャ", () => {
  it("$gte / $lte / $gt / $lt", () => {
    expect(evaluate({ $gte: 10 }, 10)).toEqual([]);
    expect(evaluate({ $gt: 10 }, 10)).toHaveLength(1);
    expect(evaluate({ $lte: 10 }, 10)).toEqual([]);
    expect(evaluate({ $lt: 10 }, 9)).toEqual([]);
    expect(evaluate({ $gte: 10, $lte: 20 }, 15)).toEqual([]);
    expect(evaluate({ $gte: 10, $lte: 20 }, 25)).toHaveLength(1);
  });

  it("非数値は失敗", () => {
    expect(evaluate({ $gte: 1 }, "2")).toHaveLength(1);
  });
});

describe("$any / $absent マッチャ", () => {
  it("$any: キーが存在すれば型を問わずパス", () => {
    expect(evaluate({ k: { $any: true } }, { k: null })).toEqual([]);
    expect(evaluate({ k: { $any: true } }, { k: 0 })).toEqual([]);
  });

  it("$any: キー欠落は失敗", () => {
    expect(evaluate({ k: { $any: true } }, {})).toHaveLength(1);
  });

  it("$absent: キーが無ければパス、あれば失敗", () => {
    expect(evaluate({ k: { $absent: true } }, {})).toEqual([]);
    expect(evaluate({ k: { $absent: true } }, { k: undefined })).toEqual([]);
    const failures = evaluate({ k: { $absent: true } }, { k: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("k");
  });
});

describe("失敗の全件収集", () => {
  it("複数の失敗を最初で止めずすべて返す", () => {
    const failures = evaluate(
      { a: 1, b: { $type: "string" }, c: [1, 2] },
      { a: 2, b: 42, c: [1, 9] },
    );
    expect(failures.map((f) => f.path).sort()).toEqual(["a", "b", "c.1"]);
  });

  it("失敗メッセージに期待値と実際値の情報が含まれる", () => {
    const failures = evaluate({ isError: true }, { isError: false });
    expect(failures[0]!.message).toContain("true");
    expect(failures[0]!.message).toContain("false");
  });
});
