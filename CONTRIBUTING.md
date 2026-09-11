# Contributing to bugdeck

## Quick start

```bash
git clone https://github.com/aitofy-dev/bugdeck.git
cd bugdeck
pnpm install

pnpm typecheck   # tsc --noEmit in every package
pnpm test        # node --test through tsx
pnpm lint        # eslint
pnpm build       # tsc
```

All four must pass before you open a pull request. CI runs the same four on Node 20 and 22, and
scans every commit with gitleaks — install it locally with `brew install gitleaks`.

## Project structure

```
packages/
├── core/      # @bugdeck/core — pure: contract, blocks, titles, image sanitisation, rendering
├── server/    # @bugdeck/server — HTTP API, storage adapters, tracker wiring
└── widget/    # bugdeck — the React widget
examples/      # one runnable app per use case
```

`core` never imports `server` or `widget`. Anything that touches the filesystem, the network or a
clock lives outside it.

## Adding a tracker adapter: one file plus one registration line

An adapter implements `IssueTracker` from `@bugdeck/core` and lives in
`packages/core/src/adapters/<name>/index.ts`. Implement only the methods your tracker supports;
optional capabilities are optional methods.

## Tests

Tests are `node:test` run through `tsx`, next to the code they cover:

```bash
pnpm --filter @bugdeck/core test
```

Test behavior, not implementation. Every bug fix ships with the test that would have caught it.

## Code style

- TypeScript strict, no `any`. Prefer discriminated unions so illegal states cannot be expressed.
- 4-space indent in configuration, 2-space indent in source, single quotes, ES modules.
- Comments explain *why*, in English, at most two lines. No dates, names or history.
- Function under 30 lines, file under 300 lines.
- Everything in this repository is English: code, comments, docs and default UI strings. The widget
  takes a `strings` prop for translation.

## Pull requests

- Branch from `main`: `feat/...`, `fix/...`, `chore/...`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Under 400 lines of diff, one idea per PR.
- Docs change with the code, in the same PR: `README.md`, `llms.txt`, `CHANGELOG.md`.
- CI must be green before merge.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
