# mcpest test list

The working bench for t_wada-style TDD: pick one scenario, translate it into a
failing test, make it pass (Red → Green → Refactor). Add newly discovered
scenarios as you go. `[x]` = turned into a test and green.

## T6: assert/matchers (matcher DSL evaluator)

- [x] deep equality for plain values (match / mismatch)
- [x] objects match partially (extra actual keys are ignored)
- [x] nested failures report `a.b.c`-style paths
- [x] arrays compare positionally (length mismatch fails)
- [x] `$type`: number/string/boolean/object/array/null
- [x] `$regex`: partial match; fails on non-strings
- [x] `$contains`: substring on strings / element inclusion on arrays
- [x] `$contains`: content-array special case (substring on any item.text)
- [x] `$length`: numeric form / `{$gte,$lte,$eq}` form
- [x] `$gte/$lte/$gt/$lt`: numeric comparison; fails on non-numbers
- [x] `$any`: passes on any value if the key exists; missing key fails
- [x] `$absent`: passes when the key is missing, fails when present
- [x] collects every failure (never stops at the first)

## T7: assert/schema-check (ajv validation)

- [x] conforming args pass against inputSchema
- [x] non-conforming args (type mismatch / missing required) fail with messages
- [x] conforming structuredContent passes against outputSchema
- [x] non-conforming structuredContent fails
- [x] accepts draft 2020-12 schemas
- [x] accepts draft-07 schemas (what the TypeScript SDK emits)

## T3: config/loader (mcp.json)

- [x] parses the mcpServers format into stdio configs
- [x] infers type when omitted: command → stdio / url → streamable-http
- [x] both command and url is an error naming both keys
- [x] `${VAR}` expansion (in env, headers, and url)
- [x] lookup order: --config → mcp.json → .mcp.json
- [x] clear error when no config is found
- [x] accepts "http" as an alias of "streamable-http"

## T4: discovery (finding and normalizing test files)

- [x] finds `**/*.mcpt.yaml` (excluding node_modules)
- [x] normalizes YAML → TestCase[] (defaults: timeout 30000, validateInput/Output true, snapshot false)
- [x] tools/call without tool is a schema error naming the file
- [x] duplicate test names within a file are an error
- [x] unknown server key is an error listing candidates

## T8: assert/snapshot

- [x] first run creates the snapshot file and passes
- [x] re-run with identical data passes
- [x] changed data fails with a diff
- [x] `-u` overwrites
- [x] CI mode (missing = failure)
- [x] normalization: sorted keys, nextCursor excluded

## T5/T9: connector + runner (integration against fixture servers)

- [x] connects to the stdio fixture; tools/list returns 4 tools
- [x] tools/call echo behaves as expected
- [x] get_weather structuredContent passes outputSchema auto-validation
- [x] bad fixture (outputSchema violation) fails even without expect (acceptance 4)
- [x] args violating inputSchema fail before the call; no tools/call in the trace (acceptance 5)
- [x] slow_tool + timeout 1000 → fails as timeout; later tests continue (acceptance 6)
- [x] works over streamable-http; headers are attached (acceptance 7)
- [x] connection failure (missing command) → error classification + stderr shown (acceptance 10)
- [x] tools/list pagination followed across pages
- [x] failure trace JSONL records initialize through tools/call with directions (acceptance 9)
- [ ] shutdown: no child process left behind (not yet tested: needs a portable process-liveness check)

## T10: report

- [x] pretty: pass/fail counts, failure paths, diffs (no color when not a TTY)
- [x] junit: testsuite tests/failures match the results (acceptance 8)
- [x] json: RunResult serialized as-is

## T11/T12: commands (CLI end-to-end)

- [x] `mcpest test` happy path exits 0 (acceptance 1)
- [x] expect mismatch exits 1 and prints the failure path (acceptance 2)
- [x] snapshots: create → detect change → `-u` update (acceptance 3)
- [x] `mcpest call`: result JSON / exit 0 even on isError / exit 1 on protocol errors (acceptance 11)
- [x] `mcpest list`: table output + exit 0 / exit 2 on connection failure (acceptance 13)
- [x] `mcpest init`: non-interactive generation with defaults (acceptance 12)
- [x] invalid YAML / unknown server key → exit 2 (acceptance 10)
- [x] `--reporter junit --output` writes JUnit XML with matching counts (acceptance 8)
- [x] `--grep` filtering
- [ ] `--server` / `--bail` filtering (not yet tested)

## Non-functional

- [ ] a 10-test fixture suite finishes within 10 seconds (no automated measurement yet; the current 16-test integration suite completes in ~7s)
- [x] env values are masked as `***` in reports and traces
