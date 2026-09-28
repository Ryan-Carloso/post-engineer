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
