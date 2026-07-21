/**
 * TTY reporter. Optimized so that "what to do next" is readable at a glance
 * when a test fails: failure path, message, diff, and trace path together.
 */
import pc from "picocolors";
import type { RunResult } from "./types.js";

export interface PrettyOptions {
  color: boolean;
}

export function renderPretty(result: RunResult, options: PrettyOptions): string {
  const c = options.color
    ? pc
    : {
        green: (s: string) => s,
        red: (s: string) => s,
        yellow: (s: string) => s,
        dim: (s: string) => s,
        bold: (s: string) => s,
      };

  const lines: string[] = [];

  for (const server of result.servers) {
    if (server.connection.ok) {
      const proto = server.connection.protocolVersion ?? "?";
      const ms = server.connection.connectMs ?? 0;
      lines.push(
        c.bold(`  ${server.server}`) + c.dim(`  connected in ${ms}ms (protocol ${proto})`),
      );
    } else {
      lines.push(c.bold(`  ${server.server}`) + c.red("  connection failed"));
      if (server.connection.error) lines.push(c.red(`    ${server.connection.error}`));
      if (server.connection.stderrTail) {
        lines.push(c.dim("    --- server stderr ---"));
        for (const l of server.connection.stderrTail.split("\n")) {
          lines.push(c.dim(`    ${l}`));
        }
      }
    }
    lines.push("");

    for (const r of server.results) {
      const mark =
        r.status === "passed" ? c.green("✓") : r.status === "failed" ? c.red("✗") : c.yellow("!");
      lines.push(`  ${mark} ${r.test.name} ${c.dim(`(${r.durationMs}ms)`)}`);

      for (const f of r.failures) {
        const where = f.path === "" ? "" : `${f.path}: `;
        lines.push(c.red(`      ${where}${f.message}`));
        if (f.diff) {
          for (const dl of f.diff.split("\n")) lines.push(`      ${dl}`);
        }
      }
      if (r.tracePath) {
        lines.push(c.dim(`      Trace: ${r.tracePath}`));
      }
    }
    lines.push("");
  }

  const { passed, failed, errored, total } = result.counts;
  const parts: string[] = [];
  if (failed > 0) parts.push(c.red(`${failed} failed`));
  if (errored > 0) parts.push(c.yellow(`${errored} errored`));
  parts.push(c.green(`${passed} passed`));
  lines.push(`  Tests: ${parts.join(", ")} (${total})  ${c.dim(`${result.durationMs}ms`)}`);

  return lines.join("\n");
}
