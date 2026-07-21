/**
 * JUnit XML レポータ。CI（GitHub Actions / Jenkins 等）のテスト結果表示に食わせる用。
 * サーバー = testsuite、テスト = testcase に対応させる。
 */
import type { RunResult } from "./types.js";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderJunit(result: RunResult): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const totals = result.counts;
  lines.push(
    `<testsuites tests="${totals.total}" failures="${totals.failed}" errors="${totals.errored}" time="${(result.durationMs / 1000).toFixed(3)}">`,
  );

  for (const server of result.servers) {
    const tests = server.results.length;
    const failures = server.results.filter((r) => r.status === "failed").length;
    const errors = server.results.filter((r) => r.status === "error").length;
    lines.push(
      `  <testsuite name="${esc(server.server)}" tests="${tests}" failures="${failures}" errors="${errors}">`,
    );
    for (const r of server.results) {
      const time = (r.durationMs / 1000).toFixed(3);
      const name = esc(r.test.name);
      const classname = esc(r.test.sourceFile);
      if (r.status === "passed") {
        lines.push(`    <testcase name="${name}" classname="${classname}" time="${time}"/>`);
        continue;
      }
      const tag = r.status === "failed" ? "failure" : "error";
      const message = esc(r.failures.map((f) => `${f.path}: ${f.message}`).join(" / "));
      lines.push(`    <testcase name="${name}" classname="${classname}" time="${time}">`);
      lines.push(`      <${tag} message="${message}"/>`);
      lines.push("    </testcase>");
    }
    lines.push("  </testsuite>");
  }

  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}
