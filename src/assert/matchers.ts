/**
 * Evaluator for expect trees. Recursively compares expected values against
 * actual data, collecting every failure (it never stops at the first one).
 * An object whose keys all start with `$` is interpreted as a matcher.
 * Non-matcher objects match partially (only the keys written are checked)
 * so that YAML tests can mix literals and the DSL without extra syntax.
 */

export interface MatchFailure {
  path: string;
  message: string;
}

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
  // JSON.stringify drops undefined, so spell it out
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

/** Numeric comparison operators (used both inside $length and on values) */
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
        failures.push({ path, message: `${op} bound is not a number: ${show(bound)}` });
        continue;
      }
      if (!cmp(actual, bound)) {
        failures.push({
          path,
          message: `${subject} ${actual} does not satisfy ${op}: ${bound}`,
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
  // $any / $absent verify key presence, which the parent (the object branch of
  // evaluateNode) already handled. Reaching here means the key exists.
  if (matcher["$any"] === true) return;
  if (matcher["$absent"] === true) {
    failures.push({
      path,
      message: `expected key to be absent, but found ${show(actual)}`,
    });
    return;
  }

  if ("$type" in matcher) {
    const expected = matcher["$type"];
    const actualType = typeOf(actual);
    if (actualType !== expected) {
      failures.push({
        path,
        message: `expected type ${String(expected)}, received ${actualType} (${show(actual)})`,
      });
    }
  }

  if ("$regex" in matcher) {
    const pattern = String(matcher["$regex"]);
    if (typeof actual !== "string") {
      failures.push({
        path,
        message: `$regex can only be applied to strings (received: ${show(actual)})`,
      });
    } else if (!new RegExp(pattern).test(actual)) {
      failures.push({
        path,
        message: `does not match /${pattern}/ (received: ${show(actual)})`,
      });
    }
  }

  if ("$contains" in matcher) {
    const needle = matcher["$contains"];
    if (typeof actual === "string") {
      if (typeof needle !== "string" || !actual.includes(needle)) {
        failures.push({
          path,
          message: `does not contain ${show(needle)} (received: ${show(actual)})`,
        });
      }
    } else if (Array.isArray(actual)) {
      const hit = actual.some(
        (item) =>
          deepEqual(item, needle) ||
          // content-array special case: substring match against item.text
          (typeof needle === "string" &&
            isPlainObject(item) &&
            typeof item["text"] === "string" &&
            item["text"].includes(needle)),
      );
      if (!hit) {
        failures.push({ path, message: `no array element contains ${show(needle)}` });
      }
    } else {
      failures.push({
        path,
        message: `$contains can only be applied to strings or arrays (received: ${show(actual)})`,
      });
    }
  }

  if ("$length" in matcher) {
    const spec = matcher["$length"];
    const len =
      typeof actual === "string" || Array.isArray(actual) ? actual.length : undefined;
    if (len === undefined) {
      failures.push({
        path,
        message: `$length can only be applied to strings or arrays (received: ${show(actual)})`,
      });
    } else if (typeof spec === "number") {
      if (len !== spec) {
        failures.push({ path, message: `expected length ${spec}, received ${len}` });
      }
    } else if (isPlainObject(spec)) {
      evaluateNumericOps(spec, len, path, failures, "length");
    }
  }

  const hasNumericOp = ["$gte", "$lte", "$gt", "$lt"].some((op) => op in matcher);
  if (hasNumericOp) {
    if (typeof actual !== "number") {
      failures.push({
        path,
        message: `numeric comparison can only be applied to numbers (received: ${show(actual)})`,
      });
    } else {
      evaluateNumericOps(matcher, actual, path, failures, "value");
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
      failures.push({
        path,
        message: `expected an array, received ${typeOf(actual)} (${show(actual)})`,
      });
      return;
    }
    if (expected.length !== actual.length) {
      failures.push({
        path,
        message: `expected array length ${expected.length}, received ${actual.length}`,
      });
      return;
    }
    expected.forEach((item, i) => evaluateNode(item, actual[i], joinPath(path, i), failures));
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      failures.push({
        path,
        message: `expected an object, received ${typeOf(actual)} (${show(actual)})`,
      });
      return;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      const childPath = joinPath(path, key);
      const exists = key in actual && actual[key] !== undefined;
      // Key-presence matchers must be handled before recursing into values
      if (isMatcher(expectedValue)) {
        if (expectedValue["$absent"] === true) {
          if (exists) {
            failures.push({
              path: childPath,
              message: `expected key to be absent, but found ${show(actual[key])}`,
            });
          }
          continue;
        }
        if (!exists) {
          failures.push({ path: childPath, message: "key is missing" });
          continue;
        }
        evaluateMatcher(expectedValue, actual[key], childPath, failures);
        continue;
      }
      if (!exists) {
        failures.push({
          path: childPath,
          message: `key is missing (expected: ${show(expectedValue)})`,
        });
        continue;
      }
      evaluateNode(expectedValue, actual[key], childPath, failures);
    }
    return;
  }

  // Deep equality for primitives
  if (!Object.is(expected, actual)) {
    failures.push({
      path,
      message: `expected ${show(expected)}, received ${show(actual)}`,
    });
  }
}

/** Match an expect tree against actual data, returning every failure. Empty array = pass. */
export function evaluate(expected: unknown, actual: unknown): MatchFailure[] {
  const failures: MatchFailure[] = [];
  evaluateNode(expected, actual, "", failures);
  return failures;
}
