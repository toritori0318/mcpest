# CLAUDE.md

## Language policy

**Everything in this repository is written in English**: source code, code comments, user-facing CLI and error messages, test names and comments, documentation, and commit messages.

Exceptions:

- `README.ja.md` — the Japanese translation of the README.
- `deliverables/` — local-only internal planning docs (gitignored, never published).

## Development methodology

- **Test-driven (t_wada style).** Maintain the scenario list in `docs/TESTLIST.md`; pick one scenario, translate it into a failing test, make it pass, refactor. Only mark `[x]` when the test is green.
- **Where information goes:** code = How / tests = What / commit messages = Why / code comments = Why not.
- Integration tests run against the real MCP fixture servers in `fixtures/server/`. If a change affects protocol behavior, extend a fixture instead of mocking.

## Quality gates

Run before committing: `npm run typecheck && npm test`.
`prepublishOnly` enforces typecheck + tests + build before any npm publish.
