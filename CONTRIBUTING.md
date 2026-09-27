# Contributing to Post Engineer

Thanks for wanting to contribute! This document covers how we work. By
participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

1. Read the [README](README.md) and follow the local setup from scratch.
2. Pick or open an issue describing the change. Small, focused changes are
   easier to review than large ones.

## Branch and PR conventions

- **Never push directly to `main`.** All changes go through a pull request.
- Create a branch from `main` with a descriptive name:
  `feat/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
- Keep PRs small and focused; one logical change per PR.
- Fill in the PR template: what changed, why, how it was tested.
- A PR is merged only when CI is green, review threads are resolved, and a
  maintainer approves. The maintainers merge — please do not merge your own PR
  unless explicitly asked.

## TDD and quality gates

- **TDD by default:** every code change (feature, fix, refactor) ships with
  new or updated tests. Write the failing test first, then the code.
- Before opening a PR, run the relevant gates and keep them green:

  ```bash
  pnpm test        # web (Vitest) + engine (pytest)
  pnpm lint        # ESLint + ruff
  pnpm typecheck   # TypeScript strict + Python compile check
  ```

- Per-app commands: `pnpm dev:web` (Next.js on :3434), `pnpm dev:engine`
  (FastAPI on :8080). See [apps/web/README.md](apps/web/README.md) and
  [apps/engine/README.md](apps/engine/README.md).

## Code conventions

- **All code comments in English.** If you touch a file that has non-English
  comments, convert them to English as part of your change.
- TypeScript: strict mode, no `any` (use `unknown` + type guards), no silent
  fallbacks for environment variables — fail explicitly when a required
  variable is missing.
- Server actions must use the `"use server"` directive; keep OAuth, fetching,
  and state management out of presentational components under
  `apps/web/components/ui/`.
- Python: follow the engine rules in [apps/engine/AGENTS.md](apps/engine/AGENTS.md)
  — video-generation behavior is controlled by `config.toml`, never overridden
  inside tests.
- Never log or print secrets, tokens, or API keys. Never commit real
  credentials — the three env files (`apps/web/.env`, `apps/engine/.env`,
  `apps/engine/config.toml`) are gitignored by design.

## Reporting issues

Use the issue templates (bug report / feature request) in
`.github/ISSUE_TEMPLATE/`. Include reproduction steps, expected vs. actual
behavior, and the relevant logs (redact any secrets). Security issues go
through [SECURITY.md](SECURITY.md), not public issues.
