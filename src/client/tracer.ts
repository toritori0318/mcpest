/**
 * In-memory recording of every JSON-RPC message, written out as JSONL.
 * Traces exist so that "when a test fails, you can see exactly what was sent
 * and what came back". Secrets (env / header values) are replaced with ***
 * at write time — trace files tend to be shared as CI artifacts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface TraceEntry {
  dir: "send" | "recv";
  ts: string;
  message: unknown;
}

export class TraceRecorder {
  private entries: TraceEntry[] = [];
  private secrets: string[] = [];

  setSecrets(values: string[]): void {
    // Masking very short values causes false positives, so only mask >= 4 chars
    this.secrets = values.filter((v) => v.length >= 4);
  }

  record(dir: "send" | "recv", message: unknown): void {
    this.entries.push({ dir, ts: new Date().toISOString(), message });
  }

  /** Write all entries so far as JSONL (secrets masked) */
  writeTo(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const lines = this.entries.map((e) => {
      let line = JSON.stringify(e);
      for (const secret of this.secrets) {
        line = line.split(secret).join("***");
      }
      return line;
    });
    writeFileSync(path, `${lines.join("\n")}\n`);
  }

  /** Extract the negotiated protocol version from the initialize response */
  findNegotiatedProtocolVersion(): string | undefined {
    for (const e of this.entries) {
      if (e.dir !== "recv") continue;
      const msg = e.message as { result?: { protocolVersion?: unknown } };
      if (typeof msg?.result?.protocolVersion === "string") {
        return msg.result.protocolVersion;
      }
    }
    return undefined;
  }
}
