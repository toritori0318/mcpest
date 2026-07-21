/**
 * JSON レポータ。機械可読な RunResult をそのまま出す（他ツール連携・自作ダッシュボード用）。
 */
import type { RunResult } from "./types.js";

export function renderJson(result: RunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
