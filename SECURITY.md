# Security Policy

Post Engineer is developed in the open. If you discover a security
vulnerability, please report it responsibly — do not open a public issue for
it.

- **Email:** [ryan@post-engineer.com](mailto:ryan@post-engineer.com)

Please include a description of the vulnerability, steps to reproduce, and the
impact you observed. We aim to acknowledge reports within a few business days.

## Scope

- This repository's code (apps/web, apps/engine, apps/mcp) and the hosted
  platform at [post-engineer.com](https://post-engineer.com).
- Out of scope: social-engineering, physical attacks, and denial of service.

## Ground rules

- Never commit real API keys, tokens, or credentials. The three env files
  (`apps/web/.env`, `apps/engine/.env`, `apps/engine/config.toml`) are
  gitignored by design — keep it that way.

## Dependency advisories

`pnpm audit` runs weekly and on every PR that touches the lockfile or a
manifest (`.github/workflows/dependency-audit.yml`). The advisories this
workspace knowingly ships live in
[`.github/audit/accepted-advisories.json`](.github/audit/accepted-advisories.json),
each with the reason it is tolerated and whether it reaches production
(`runtime`) or only a developer machine (`dev`).

`node .github/scripts/audit/verify-accepted.mjs` is the gate, and it fails in
both directions: an advisory that is not in the list, and a listed advisory that
npm no longer reports (the list must not rot). Accepting one GHSA never accepts
a sibling advisory on the same package.

Adding an entry is a security decision: state what unblocks it (the upstream
release, the upgrade that removes the package). If you can bump the dependency
instead, bump it.
