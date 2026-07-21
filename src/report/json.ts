/**
 * JSON reporter: the machine-readable RunResult as-is, for integrating with
 * other tools or custom dashboards.
 */
import type { RunResult } from "./types.js";

export function renderJson(result: RunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
