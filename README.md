# mcpest

**A delightful test runner for MCP servers.**

[![CI](https://github.com/toritori0318/mcpest/actions/workflows/ci.yml/badge.svg)](https://github.com/toritori0318/mcpest/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcpest)](https://www.npmjs.com/package/mcpest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Declarative YAML tests + snapshot-based drift detection for [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) servers. Point it at your existing `mcp.json` and run assertions against `tools/list` / `tools/call` in CI.

> jest → vitest → pest → **mcpest**

日本語版 README は [README.ja.md](README.ja.md) にあります。

## Why mcpest?

- **Graduate from manual Inspector clicking.** Write assertions once, run `mcpest test` — in your terminal and in CI.
- **Zero connection boilerplate.** Server spawning, the initialize/initialized handshake, and teardown are handled for you. Works with stdio and Streamable HTTP transports.
- **Smart validation by default.** Tool call arguments are checked against `inputSchema`, and `structuredContent` against `outputSchema` — without writing a single assertion (opt-out per test).
- **Catch schema drift.** Snapshot your `tools/list` (schemas included) and let CI flag unintended tool definition changes before your users' LLMs do.
- **See everything on failure.** Failing tests keep a full JSON-RPC trace (JSONL) of the session.

## Quick Start

```console
$ npm install -D mcpest
$ npx mcpest init        # generates mcp.json + a sample test
$ npx mcpest test
```

Already have an `mcp.json` (the standard `mcpServers` format used by Claude, Cursor, etc.)? mcpest reads it as-is.

### Writing tests

```yaml
# weather.mcpt.yaml
server: weather            # key in mcp.json's mcpServers
tests:
  - name: tool list has not drifted
    tools/list:
      snapshot: true       # snapshot the whole list, schemas included

  - name: weather comes back structured
    tools/call:
      tool: get_weather
      args: { location: "Tokyo" }
      expect:
        isError: false
        structuredContent:
          temperature: { $type: number }   # matchers for non-deterministic values
          conditions: { $regex: "Tokyo" }

  - name: unknown location is a tool error
    tools/call:
      tool: get_weather
      args: { location: "nowhere-xyz" }
      expect:
        isError: true
        content: { $contains: "not found" }
```

```console
$ npx mcpest test

  weather  connected in 216ms (protocol 2025-11-25)

  ✓ tool list has not drifted (1ms)
  ✓ weather comes back structured (15ms)
  ✗ unknown location is a tool error (2ms)
      isError: true を期待しましたが false でした
      Trace: .mcpest/traces/weather-1.jsonl

  Tests: 1 failed, 2 passed (3)  232ms
```

### Commands

| Command | Description |
|---|---|
| `mcpest test` | Run tests (`--grep` / `--server` / `--bail` / `-u` / `--reporter junit\|json` / `--trace`) |
| `mcpest list` | Connect and list available tools |
| `mcpest call <server> <tool> --args '{...}'` | One-shot tool call |
| `mcpest init` | Generate config and a sample test |

Exit codes: `0` all passed / `1` test failures / `2` config or connection errors.

### Matchers

`$type` / `$regex` / `$contains` / `$length` / `$gte` `$lte` `$gt` `$lt` / `$any` / `$absent`. Objects match partially (only the keys you write are checked); arrays match by position. Match JSON-RPC protocol errors with `expect.error: { code, message }`.

### CI

```yaml
- run: npx mcpest test --reporter junit --output results.xml
```

With `CI=true`, a missing snapshot is treated as a failure (generate locally and commit it).

## Development

```console
$ npm install
$ npm test          # Vitest, including integration tests against real MCP fixture servers
$ npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
