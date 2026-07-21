/**
 * expect 木の評価器。expect の値を実データと再帰比較し、失敗を全件収集する。
 * `$` で始まるキーのみを持つオブジェクトはマッチャとして解釈する。
 * マッチャでないオブジェクトは部分一致（expect に書いたキーのみ検証）。
 */

export interface MatchFailure {
  path: string;
  message: string;
}

type Json = unknown;

const MATCHER_KEYS = new Set([
  "$type",
  "$regex",
  "$contains",
  "$length",
  "$gte",
  "$lte",
  "$gt",
  "$lt",
  "$any",
  "$absent",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMatcher(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => MATCHER_KEYS.has(k));
}

function show(value: unknown): string {
  const s = JSON.stringify(value);
  // undefined は JSON.stringify で消えるため明示する
  return s === undefined ? "undefined" : s;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function joinPath(parent: string, key: string | number): string {
  return parent === "" ? String(key) : `${parent}.${key}`;
}

/** 数値比較演算子群（$length の内側と値そのものの両方で使う） */
function evaluateNumericOps(
  ops: Record<string, unknown>,
  actual: number,
  path: string,
  failures: MatchFailure[],
  subject: string,
): void {
  const checks: Array<[string, (a: number, b: number) => boolean]> = [
    ["$gte", (a, b) => a >= b],
    ["$lte", (a, b) => a <= b],
    ["$gt", (a, b) => a > b],
    ["$lt", (a, b) => a < b],
    ["$eq", (a, b) => a === b],
  ];
  for (const [op, cmp] of checks) {
    if (op in ops) {
      const bound = ops[op];
      if (typeof bound !== "number") {
        failures.push({ path, message: `${op} の指定値が数値ではありません: ${show(bound)}` });
        continue;
      }
      if (!cmp(actual, bound)) {
        failures.push({
          path,
          message: `${subject} ${actual} が ${op}: ${bound} を満たしません`,
        });
      }
    }
  }
}

function evaluateMatcher(
  matcher: Record<string, unknown>,
  actual: unknown,
  path: string,
  failures: MatchFailure[],
): void {
  // $any / $absent はキー存在の検証なので親（evaluateNode のオブジェクト分岐）で
  // 処理済み。ここに到達するのは「キーが存在した」場合のみ。
  if (matcher["$any"] === true) return;
  if (matcher["$absent"] === true) {
    failures.push({ path, message: `キーが存在しないことを期待しましたが、値 ${show(actual)} が存在します` });
    return;
  }

  if ("$type" in matcher) {
    const expected = matcher["$type"];
    const actualType = typeOf(actual);
    if (actualType !== expected) {
      failures.push({ path, message: `型 ${String(expected)} を期待しましたが ${actualType}（${show(actual)}）でした` });
    }
  }

  if ("$regex" in matcher) {
    const pattern = String(matcher["$regex"]);
    if (typeof actual !== "string") {
      failures.push({ path, message: `$regex は文字列にのみ適用できます（実際値: ${show(actual)}）` });
    } else if (!new RegExp(pattern).test(actual)) {
      failures.push({ path, message: `/${pattern}/ にマッチしません（実際値: ${show(actual)}）` });
    }
  }

  if ("$contains" in matcher) {
    const needle = matcher["$contains"];
    if (typeof actual === "string") {
      if (typeof needle !== "string" || !actual.includes(needle)) {
        failures.push({ path, message: `${show(needle)} を含みません（実際値: ${show(actual)}）` });
      }
    } else if (Array.isArray(actual)) {
      const hit = actual.some(
        (item) =>
          deepEqual(item, needle) ||
          // content 配列特例: item.text への部分一致
          (typeof needle === "string" &&
            isPlainObject(item) &&
            typeof item["text"] === "string" &&
            item["text"].includes(needle)),
      );
      if (!hit) {
        failures.push({ path, message: `配列に ${show(needle)} を含む要素がありません` });
      }
    } else {
      failures.push({ path, message: `$contains は文字列か配列にのみ適用できます（実際値: ${show(actual)}）` });
    }
  }

  if ("$length" in matcher) {
    const spec = matcher["$length"];
    const len =
      typeof actual === "string" || Array.isArray(actual) ? actual.length : undefined;
    if (len === undefined) {
      failures.push({ path, message: `$length は文字列か配列にのみ適用できます（実際値: ${show(actual)}）` });
    } else if (typeof spec === "number") {
      if (len !== spec) {
        failures.push({ path, message: `長さ ${spec} を期待しましたが ${len} でした` });
      }
    } else if (isPlainObject(spec)) {
      evaluateNumericOps(spec, len, path, failures, "長さ");
    }
  }

  const hasNumericOp = ["$gte", "$lte", "$gt", "$lt"].some((op) => op in matcher);
  if (hasNumericOp) {
    if (typeof actual !== "number") {
      failures.push({ path, message: `数値比較は数値にのみ適用できます（実際値: ${show(actual)}）` });
    } else {
      evaluateNumericOps(matcher, actual, path, failures, "値");
    }
  }
}

function evaluateNode(
  expected: unknown,
  actual: unknown,
  path: string,
  failures: MatchFailure[],
): void {
  if (isMatcher(expected)) {
    evaluateMatcher(expected, actual, path, failures);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push({ path, message: `配列を期待しましたが ${typeOf(actual)}（${show(actual)}）でした` });
      return;
    }
    if (expected.length !== actual.length) {
      failures.push({
        path,
        message: `配列長 ${expected.length} を期待しましたが ${actual.length} でした`,
      });
      return;
    }
    expected.forEach((item, i) => evaluateNode(item, actual[i], joinPath(path, i), failures));
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      failures.push({ path, message: `オブジェクトを期待しましたが ${typeOf(actual)}（${show(actual)}）でした` });
      return;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      const childPath = joinPath(path, key);
      const exists = key in actual && actual[key] !== undefined;
      // キー存在系マッチャはキーの有無自体が検証対象なので、ここで先に処理する
      if (isMatcher(expectedValue)) {
        if (expectedValue["$absent"] === true) {
          if (exists) {
            failures.push({
              path: childPath,
              message: `キーが存在しないことを期待しましたが、値 ${show(actual[key])} が存在します`,
            });
          }
          continue;
        }
        if (!exists) {
          failures.push({ path: childPath, message: "キーが存在しません" });
          continue;
        }
        evaluateMatcher(expectedValue, actual[key], childPath, failures);
        continue;
      }
      if (!exists) {
        failures.push({ path: childPath, message: `キーが存在しません（期待値: ${show(expectedValue)}）` });
        continue;
      }
      evaluateNode(expectedValue, actual[key], childPath, failures);
    }
    return;
  }

  // プリミティブの深い等価
  if (!Object.is(expected, actual)) {
    failures.push({
      path,
      message: `${show(expected)} を期待しましたが ${show(actual)} でした`,
    });
  }
}

/** expect 木を実データに照合し、失敗を全件返す。空配列 = パス。 */
export function evaluate(expected: unknown, actual: unknown): MatchFailure[] {
  const failures: MatchFailure[] = [];
  evaluateNode(expected, actual, "", failures);
  return failures;
}
