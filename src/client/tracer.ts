/**
 * JSON-RPC 全往復のインメモリ記録と JSONL 書き出し。
 * トレースは「失敗したとき、何を送って何が返ったかを丸ごと見られる」ための機能。
 * secrets（env や headers の値）は書き出し時に *** へ置換する——
 * トレースファイルは CI のアーティファクトとして共有されがちなため。
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
    // 短すぎる値のマスクは誤爆が多いので 4 文字以上のみ対象
    this.secrets = values.filter((v) => v.length >= 4);
  }

  record(dir: "send" | "recv", message: unknown): void {
    this.entries.push({ dir, ts: new Date().toISOString(), message });
  }

  /** これまでの全エントリを JSONL で書き出す（secrets はマスク） */
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

  /** initialize レスポンスからネゴシエートされたプロトコルバージョンを拾う */
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
