/**
 * Snapshot storage, comparison, and updating.
 * Snapshots live next to the test file in __mcpest_snapshots__/<basename>.snap.json,
 * keyed by test name (discovery guarantees uniqueness).
 * nextCursor is excluded because pagination cursors are transport plumbing that
 * can change between runs — they are not part of the server's visible contract.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { diff as jestDiff } from "jest-diff";

export interface SnapshotCheckResult {
  status: "created" | "matched" | "mismatched" | "missing";
  diff?: string;
  snapshotPath: string;
}

interface SnapshotOptions {
  update: boolean;
  ci: boolean;
}

const EXCLUDED_KEYS = new Set(["nextCursor"]);

/** Canonical form: sorted keys, excluded keys dropped */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !EXCLUDED_KEYS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

export class SnapshotStore {
  private readonly path: string;
  private readonly options: SnapshotOptions;
  private entries: Record<string, unknown>;

  constructor(testFilePath: string, options: SnapshotOptions) {
    this.path = join(
      dirname(testFilePath),
      "__mcpest_snapshots__",
      `${basename(testFilePath)}.snap.json`,
    );
    this.options = options;
    this.entries = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as Record<string, unknown>)
      : {};
  }

  check(testName: string, data: unknown): SnapshotCheckResult {
    const normalized = normalize(data);
    const stored = this.entries[testName];

    if (stored === undefined) {
      if (this.options.ci && !this.options.update) {
        return { status: "missing", snapshotPath: this.path };
      }
      this.write(testName, normalized);
      return { status: "created", snapshotPath: this.path };
    }

    const matched = JSON.stringify(stored) === JSON.stringify(normalized);
    if (matched) return { status: "matched", snapshotPath: this.path };

    if (this.options.update) {
      this.write(testName, normalized);
      return { status: "matched", snapshotPath: this.path };
    }

    return {
      status: "mismatched",
      snapshotPath: this.path,
      diff:
        jestDiff(stored, normalized, {
          aAnnotation: "Snapshot",
          bAnnotation: "Received",
        }) ?? "(diff unavailable)",
    };
  }

  private write(testName: string, normalized: unknown): void {
    this.entries[testName] = normalized;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.entries, null, 2)}\n`);
  }
}
