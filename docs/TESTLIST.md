# mcpest テストリスト

t_wada 流 TDD の作業台。ここから1つ選んでテストに翻訳 → Red → Green → Refactor。
気づいたシナリオは随時追記する。`[x]` = テスト化して Green 済み。

## T6: assert/matchers（マッチャ DSL 評価器）

- [ ] プレーン値の深い等価（一致 / 不一致）
- [ ] オブジェクトは部分一致（expect に無い実キーは無視）
- [ ] ネストしたオブジェクトの失敗パスが `a.b.c` 形式で返る
- [ ] 配列は位置対応で厳密比較（長さ不一致は失敗）
- [ ] `$type`: number/string/boolean/object/array/null の判定
- [ ] `$regex`: 部分一致・非文字列に適用したら失敗
- [ ] `$contains`: 文字列部分一致 / 配列要素包含
- [ ] `$contains`: content 配列特例（いずれかの item.text に部分一致）
- [ ] `$length`: 数値指定 / `{$gte,$lte,$eq}` 指定
- [ ] `$gte/$lte/$gt/$lt`: 数値比較・非数値は失敗
- [ ] `$any`: 存在すれば型を問わずパス、キー欠落は失敗
- [ ] `$absent`: キーが無ければパス、あれば失敗
- [ ] 複数の失敗を全件収集する（最初で止めない）

## T7: assert/schema-check（ajv 検証）

- [ ] inputSchema 適合の args はパス
- [ ] inputSchema 不適合（型違い・required 欠落）はエラーメッセージつきで失敗
- [ ] outputSchema 適合の structuredContent はパス
- [ ] outputSchema 不適合は失敗
- [ ] draft 2020-12 のスキーマを受理する

## T3: config/loader（mcp.json）

- [ ] mcpServers 形式をパースし stdio 設定を得る
- [ ] `type` 省略時: command → stdio / url → streamable-http と推論
- [ ] command と url 両方あればエラー（両キー名を含むメッセージ）
- [ ] `${VAR}` 環境変数展開（env・headers・url 内）
- [ ] 探索順: --config 指定 → mcp.json → .mcp.json
- [ ] 見つからない場合は明確なエラー
- [ ] "http" を "streamable-http" の同義として受理

## T4: discovery（テストファイル発見と正規化）

- [ ] `**/*.mcpt.yaml` を発見（node_modules 除外）
- [ ] YAML → TestCase[] 正規化（既定値: timeout 30000, validateInput/Output true, snapshot false）
- [ ] tools/call で tool 欠落はスキーマエラー（ファイル名つき）
- [ ] 同一ファイル内の name 重複はエラー
- [ ] server キー未知（mcp.json に無い）はエラーで候補一覧を出す

## T8: assert/snapshot

- [ ] 初回実行でスナップショットファイル生成 & パス
- [ ] 同一結果で再実行 → パス
- [ ] 結果変化 → 失敗＋diff
- [ ] `-u` で上書き更新
- [ ] CI モード（未存在 = 失敗）
- [ ] 正規化: キーソート・nextCursor 除外

## T5/T9: connector + runner（fixtures サーバー統合）

- [ ] stdio fixtures に接続し tools/list が 4 ツールを返す
- [ ] tools/call echo が期待どおり
- [ ] get_weather の structuredContent が outputSchema 自動検証をパス
- [ ] bad fixtures（outputSchema 不適合）は expect なしでも失敗（受け入れ 4）
- [ ] inputSchema 不適合 args は呼び出し前に失敗、トレースに tools/call が無い（受け入れ 5）
- [ ] slow_tool + timeout 1000 → 失敗(timeout)、後続テスト継続（受け入れ 6）
- [ ] streamable-http fixtures で同様に動作、headers が付与される（受け入れ 7）
- [ ] 接続失敗（コマンド不存在）→ error 分類 + stderr 表示（受け入れ 10）
- [ ] tools/list ページング追跡（複数ページ fixtures）
- [ ] 失敗時トレース JSONL に initialize〜tools/call が方向つきで記録（受け入れ 9）
- [ ] shutdown: 終了後に子プロセスが残らない

## T10: report

- [ ] pretty: パス/失敗数・失敗パス・diff を含む（非 TTY で色なし）
- [ ] junit: testsuite の tests/failures が結果と一致（受け入れ 8）
- [ ] json: RunResult がそのままシリアライズされる

## T11/T12: commands（CLI E2E）

- [ ] `mcpest test` 正常系 exit 0（受け入れ 1）
- [ ] expect 不一致 exit 1 + 失敗パス表示（受け入れ 2）
- [ ] スナップショットの生成→変更検知→ `-u` 更新（受け入れ 3）
- [ ] `mcpest call` 結果 JSON / isError でも exit 0 / プロトコルエラー exit 1（受け入れ 11）
- [ ] `mcpest list` 表形式 + exit 0 / 接続失敗 exit 2（受け入れ 13）
- [ ] `mcpest init` 非対話でデフォルト生成（受け入れ 12）
- [ ] 不正 YAML / 未知 server キー → exit 2（受け入れ 10）
- [ ] `--grep` / `--server` / `--bail` のフィルタ動作

## 非機能

- [ ] fixtures 10 テストスイートが 10 秒以内（接続再利用の確認）
- [ ] env 値がレポート・トレースで `***` にマスクされる
