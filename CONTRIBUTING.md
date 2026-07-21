# Contributing to mcpest

Thanks for your interest! Issues and pull requests are welcome, in English or Japanese.

## Development setup

```console
$ npm install
$ npm test            # run all tests (unit + integration against fixture MCP servers)
$ npm run typecheck
$ npm run build
```

Node.js >= 20 is required.

## How this project is built

- **Test-driven.** Every feature starts from a scenario in `docs/TESTLIST.md`, becomes a failing test, then an implementation. Please keep this loop: add a test first, watch it fail, make it pass.
- **Integration tests run against real MCP servers** in `fixtures/server/` (stdio, Streamable HTTP, a spec-violating server, and a paginating server). If your change affects protocol behavior, add or extend a fixture.
- **Comments explain "why not".** The code explains how; tests explain what; commit messages explain why.

## Pull requests

1. Fork and create a branch.
2. Add tests for your change (`tests/*.test.ts`).
3. Make sure `npm test` and `npm run typecheck` pass.
4. Describe *why* the change is needed in the PR body.

## Reporting bugs

Please include:

- Your `mcp.json` entry (redact secrets) and the failing `*.mcpt.yaml`
- The trace file from `.mcpest/traces/` if one was produced
- mcpest version, Node.js version, and OS
