import { describe, expect, it } from "vitest";
import { evaluate } from "../src/assert/matchers.js";

// evaluate(expected, actual) returns an array of failures. Empty array = pass.
// Each failure carries { path, message }, where path is "a.b.0.c"-style.

describe("deep equality for plain values", () => {
  it("matching primitives pass", () => {
    expect(evaluate("hello", "hello")).toEqual([]);
    expect(evaluate(42, 42)).toEqual([]);
    expect(evaluate(true, true)).toEqual([]);
    expect(evaluate(null, null)).toEqual([]);
  });

  it("mismatching primitives fail", () => {
    const failures = evaluate("hello", "world");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("");
  });

  it("differing types fail", () => {
    expect(evaluate(42, "42")).toHaveLength(1);
  });
});

describe("partial object matching", () => {
  it("checks only the keys written in expect; extra actual keys are ignored", () => {
    expect(evaluate({ a: 1 }, { a: 1, b: 2, c: 3 })).toEqual([]);
  });

  it("fails when an expected key is missing from actual", () => {
    const failures = evaluate({ a: 1, missing: "x" }, { a: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("missing");
  });

  it("reports nested mismatches with a dotted failure path", () => {
    const failures = evaluate(
      { outer: { inner: { value: 1 } } },
      { outer: { inner: { value: 2 } } },
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("outer.inner.value");
  });
});

describe("positional array matching", () => {
  it("same elements in the same order pass", () => {
    expect(evaluate([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("length mismatch fails", () => {
    expect(evaluate([1, 2], [1, 2, 3]).length).toBeGreaterThan(0);
  });

  it("element mismatch fails with an indexed path", () => {
    const failures = evaluate([1, 9], [1, 2]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("1");
  });

  it("objects inside arrays also match partially", () => {
    expect(
      evaluate([{ type: "text" }], [{ type: "text", text: "extra ok" }]),
    ).toEqual([]);
  });
});

describe("$type matcher", () => {
  it.each([
    ["number", 1.5],
    ["string", "s"],
    ["boolean", false],
    ["object", { k: 1 }],
    ["array", [1]],
    ["null", null],
  ])("matching %s type passes", (type, value) => {
    expect(evaluate({ $type: type }, value)).toEqual([]);
  });

  it("type mismatch fails", () => {
    expect(evaluate({ $type: "number" }, "not a number")).toHaveLength(1);
  });

  it("arrays are not treated as object", () => {
    expect(evaluate({ $type: "object" }, [1, 2])).toHaveLength(1);
  });
});

describe("$regex matcher", () => {
  it("passes on a partial match", () => {
    expect(evaluate({ $regex: "Tok" }, "Sunny in Tokyo")).toEqual([]);
  });

  it("fails when the pattern does not match", () => {
    expect(evaluate({ $regex: "^Tokyo$" }, "Sunny in Tokyo")).toHaveLength(1);
  });

  it("fails when applied to a non-string", () => {
    expect(evaluate({ $regex: "1" }, 123)).toHaveLength(1);
  });
});

describe("$contains matcher", () => {
  it("substring match on strings", () => {
    expect(evaluate({ $contains: "not found" }, "location not found: x")).toEqual([]);
    expect(evaluate({ $contains: "absent" }, "hello")).toHaveLength(1);
  });

  it("element inclusion on arrays (deep equality)", () => {
    expect(evaluate({ $contains: 2 }, [1, 2, 3])).toEqual([]);
    expect(evaluate({ $contains: 9 }, [1, 2, 3])).toHaveLength(1);
  });

  it("content-array special case: substring match against any item.text", () => {
    const content = [
      { type: "text", text: "location not found: XYZ" },
      { type: "image", data: "...", mimeType: "image/png" },
    ];
    expect(evaluate({ $contains: "not found" }, content)).toEqual([]);
    expect(evaluate({ $contains: "no such text" }, content)).toHaveLength(1);
  });
});

describe("$length matcher", () => {
  it("numeric form: exact length of arrays and strings", () => {
    expect(evaluate({ $length: 3 }, [1, 2, 3])).toEqual([]);
    expect(evaluate({ $length: 5 }, "hello")).toEqual([]);
    expect(evaluate({ $length: 2 }, [1])).toHaveLength(1);
  });

  it("comparison form: {$gte, $lte, $eq}", () => {
    expect(evaluate({ $length: { $gte: 1 } }, [1, 2])).toEqual([]);
    expect(evaluate({ $length: { $gte: 3 } }, [1, 2])).toHaveLength(1);
    expect(evaluate({ $length: { $gte: 1, $lte: 2 } }, [1, 2])).toEqual([]);
    expect(evaluate({ $length: { $eq: 2 } }, [1, 2])).toEqual([]);
  });

  it("fails on values without a length", () => {
    expect(evaluate({ $length: 1 }, 42)).toHaveLength(1);
  });
});

describe("numeric comparison matchers", () => {
  it("$gte / $lte / $gt / $lt", () => {
    expect(evaluate({ $gte: 10 }, 10)).toEqual([]);
    expect(evaluate({ $gt: 10 }, 10)).toHaveLength(1);
    expect(evaluate({ $lte: 10 }, 10)).toEqual([]);
    expect(evaluate({ $lt: 10 }, 9)).toEqual([]);
    expect(evaluate({ $gte: 10, $lte: 20 }, 15)).toEqual([]);
    expect(evaluate({ $gte: 10, $lte: 20 }, 25)).toHaveLength(1);
  });

  it("fails on non-numbers", () => {
    expect(evaluate({ $gte: 1 }, "2")).toHaveLength(1);
  });
});

describe("$any / $absent matchers", () => {
  it("$any: passes on any value as long as the key exists", () => {
    expect(evaluate({ k: { $any: true } }, { k: null })).toEqual([]);
    expect(evaluate({ k: { $any: true } }, { k: 0 })).toEqual([]);
  });

  it("$any: fails when the key is missing", () => {
    expect(evaluate({ k: { $any: true } }, {})).toHaveLength(1);
  });

  it("$absent: passes when the key is missing, fails when present", () => {
    expect(evaluate({ k: { $absent: true } }, {})).toEqual([]);
    expect(evaluate({ k: { $absent: true } }, { k: undefined })).toEqual([]);
    const failures = evaluate({ k: { $absent: true } }, { k: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.path).toBe("k");
  });
});

describe("failure collection", () => {
  it("collects every failure instead of stopping at the first", () => {
    const failures = evaluate(
      { a: 1, b: { $type: "string" }, c: [1, 2] },
      { a: 2, b: 42, c: [1, 9] },
    );
    expect(failures.map((f) => f.path).sort()).toEqual(["a", "b", "c.1"]);
  });

  it("failure messages include the expected and received values", () => {
    const failures = evaluate({ isError: true }, { isError: false });
    expect(failures[0]!.message).toContain("true");
    expect(failures[0]!.message).toContain("false");
  });
});
