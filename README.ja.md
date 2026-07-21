# mcpest

**A delightful test runner for MCP servers.**

MCP（Model Context Protocol）サーバーのための、宣言的 YAML + スナップショットベースのテストランナー。既存の `mcp.json` を指すだけで接続し、`tools/list` / `tools/call` のアサーション・スキーマ検証・スキーマドリフト検知を CI で回せます。

> jest → vitest → pest → **mcpest**

## なぜ mcpest か

- **Inspector で手動確認から卒業する。** アサーションを書いて `mcpest test` 一発。CI に置ける。
- **接続ボイラープレートゼロ。** サーバー起動・initialize/initialized ハンドシェイク・後始末は mcpest がやる。stdio / Streamable HTTP 両対応。
- **書かなくても賢く検証。** `tools/call` の引数は `inputSchema` に、`structuredContent` は `outputSchema` に対して自動検証（オフにも出来ます）。
- **スキーマドリフトを止める。** `tools/list` のスナップショットが、意図しないツール定義の変更を PR の CI で検知。
- **失敗したら丸ごと見える。** 失敗テストは JSON-RPC 全往復のトレース（JSONL）が残る。

## Quick Start

```console
$ npm install -D mcpest
$ npx mcpest init        # mcp.json とサンプルテストを生成
$ npx mcpest test
```

既に `mcp.json`（Claude / Cursor 等で使う `mcpServers` 形式）があるならそれがそのまま使えます。

### テストを書く

```yaml
# weather.mcpt.yaml
server: weather            # mcp.json の mcpServers キー
tests:
  - name: ツール一覧が壊れていない
    tools/list:
      snapshot: true       # スキーマ含め全体をスナップショット比較

  - name: 天気が構造化データで返る
    tools/call:
      tool: get_weather
      args: { location: "Tokyo" }
      expect:
        isError: false
        structuredContent:
          temperature: { $type: number }   # 非決定値はタイプマッチャで
          conditions: { $regex: "Tokyo" }

  - name: 未知のロケーションはツールエラー
    tools/call:
      tool: get_weather
      args: { location: "nowhere-xyz" }
      expect:
        isError: true
        content: { $contains: "not found" }
```

### コマンド

| コマンド | 説明 |
|---|---|
| `mcpest test` | テスト実行（`--grep` / `--server` / `--bail` / `-u` / `--reporter junit\|json` / `--trace`） |
| `mcpest list` | 接続してツール一覧を表示 |
| `mcpest call <server> <tool> --args '{...}'` | 単発呼び出し |
| `mcpest init` | 設定とサンプルテストの生成 |

exit code: `0` 全パス / `1` テスト失敗 / `2` 設定・接続エラー。

### マッチャ

`$type` / `$regex` / `$contains` / `$length` / `$gte` `$lte` `$gt` `$lt` / `$any` / `$absent`。オブジェクトは部分一致（書いたキーだけ検証）、配列は位置対応。JSON-RPC エラーは `expect.error: { code, message }` で照合。

### CI での利用

```yaml
- run: npx mcpest test --reporter junit --output results.xml
```

`CI=true` ではスナップショット未存在を失敗として扱います（ローカルで生成してコミットしてください）。

## 開発

```console
$ npm install
$ npm test          # Vitest（fixtures の実 MCP サーバーに対する統合テスト含む）
$ npm run build
```

## License

MIT
