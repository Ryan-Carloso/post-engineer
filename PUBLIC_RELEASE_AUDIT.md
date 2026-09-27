# Public Release Audit

Status: audit complete; two fix waves implemented on branch
`audit/public-release` (uncommitted). Findings below are from 8 parallel
read-only audits (secrets, backend, frontend, integrations, infra/CI, deps,
quality, OSS readiness) plus a dedicated RLS/CI-workflow audit, all against
the current working tree only (no git history).

## Owner decisions (resolved)

- HIGH fixes: implemented in wave 2 (see below).
- Dev tooling (`AGENTS.md`, `CLAUDE.md`, `opencode.json`, `.githooks/`):
  scanned for personal/private data — none found; safe to publish as-is.
  `.opencode/` and `.playwright-mcp/` are untracked local artifacts; exclude
  from export (contains local session logs/snapshots with personal UI data).
- License: keep Apache-2.0 root + vendored MIT (`apps/engine`) per `NOTICE`.
- RLS: no SQL migrations exist in the repo (schema unversioned by design) —
  release blocker A0 below.

## Implemented fixes (wave 2)

| # | Fix | Files |
|---|-----|-------|
| 9 | **H1** YouTube refresh persisted after `refreshAccessToken` | `apps/web/lib/upload/handlers.ts` |
| 10 | **H2** `material.save_video` routed through SSRF-guarded `download_public_file` (per-hop validation, 200 MB cap, video/* content-type); `download_public_file` gained optional `headers`/`proxies` | `apps/engine/app/services/material.py`, `apps/engine/app/utils/ssrf.py` |
| 11 | **H3** Signed/public media URLs and token lengths removed from logs (hashed instead) | `apps/web/lib/upload/handlers.ts`, `apps/web/lib/instagram.ts` |
| 12 | **B1 (HIGH)** Script injection via PR title/number in `opencode-review.yml` eliminated — PR context now passes only through `env:` | `.github/workflows/opencode-review.yml` |
| 13 | **B2** `secrets.ZAI_API_KEY` no longer interpolated in `run:` (env-guard pattern) | `.github/workflows/opencode-review.yml` |
| 14 | **B3** `permissions: contents: read` added to `web`/`engine` CI jobs | `.github/workflows/ci.yml` |
| 15 | Review-input cleanup extended to `*.pem`, `*.key`, `secrets/`, `private/` | `.github/workflows/opencode-review.yml` |
| 16 | Regression tests: SSRF rejection for private targets (169.254.x) | `apps/engine/test/services/test_material.py` |

## Remaining findings (triaged, not yet fixed)

### HIGH

- **H1 — YouTube refresh token never persisted** (`apps/web/lib/upload/handlers.ts:82-88`):
  refresh result kept in memory only; every upload re-refreshes and users get
  spurious reconnect prompts. Fix: call `updateSocialAccountTokens` after refresh.
- **H2 — `material.save_video` bypasses SSRF guard** (`apps/engine/app/services/material.py:327-358`):
  raw `requests.get().content`, no `assert_public_url`, no byte cap. Fix: route
  through `ssrf.download_public_file`.
- **H3 — Signed bearer URLs in logs** (`apps/web/lib/upload/handlers.ts:398-442`,
  `apps/web/lib/instagram.ts:329`): 1-hour Supabase signed URLs logged. Fix: log
  storage path + URL hash only.

### MEDIUM

- **M1 — `PATCH /api/persona` update lacks `.eq('user_id')`** (defense-in-depth
  IDOR; `apps/web/app/api/persona/route.ts:168-171`). Mirror the DELETE pattern.
- **M2 — PATCH validation weaker than POST** (same file:208-263): reuse
  `personaFormSchema` caps; add `name` max 100.
- **M3 — `avatarUrl` stored unvalidated** (`apps/web/lib/persona-schema.ts:30`):
  allow only https/data-image URLs, max 2048.
- **M4 — Missing rate limits** on `video-status`, `video-task`, `video-download`,
  `persona/list`, `voices`, `schedule/*`, `billing/tokens|transactions`,
  `persona/avatar` (per-user profiles).
- **M5 — YouTube/LinkedIn OAuth callbacks don't allowlist `redirect_uri`**
  (Instagram pattern exists; copy it).
- **M6 — Engine binds `0.0.0.0` by default** (`apps/engine/app/config/config.py:182`):
  default to `127.0.0.1`; require ≥32-byte `MONEYPRINT_API_SECRET` at boot;
  log auth failures.
- **M7 — No security headers verification / `Vary: Origin` on API CORS**
  (`apps/web/next.config.ts`): OPTIONS short-circuit for preflights.

### LOW

- L1 `safeNext` in `app/login/page.tsx:41-44` missing `\\` check (downstream
  `safeNextPath` neutralizes today).
- L2 Verbose client logging (`lib/api.ts:47-59`, `login/page.tsx:115`) and
  Instagram error bodies unredacted (`lib/instagram.ts:114-123`).
- L3 Bluesky reconnect `.insert` duplicates rows (should upsert).
- L4 `data:image/` decode uncapped in engine (`app/services/task.py:700-706`).
- L5 `timezone` unvalidated in schedule POST/PATCH.
- L6 Static CORS origin on `/api/*` may break preview/localhost callers.
- L7 Generation ledger updates keyed only by `generation_id` (add `user_id`).
- L8 Portuguese comments/strings remain in a few files (`infinitetalk_bench.py`
  summary strings, `.gitignore` comment) — repo rule says English.

### Needs verification (owner/infra)

- Supabase RLS policies on `social_accounts`, `oauth_states`, `user_api_keys`,
  `personas`, `stripe_webhook_events` (migrations not yet reviewed).
- Storage bucket policies (private buckets, signed-URL TTLs).
- `Vercel preview relay` suffix correctness (`lib/vercel-preview-host.ts`).
- Redis private binding + password in prod.

## Verification results

- Engine pytest (full suite): **598 passed, 8 skipped**; 1 pre-existing failure
  (`TestFontContainment` — also fails on unmodified `main`; local font
  environment issue, unrelated to the audit).
- Web vitest (full suite): **1346 passed**; `tsc --noEmit` clean; `pnpm lint`
  0 errors (8 pre-existing warnings).
- Engine `ruff check` on all changed files: clean.
- Workflow validators: `validate-opencode-review.py` and
  `validate-ocr-review.py` all checks passed; YAML parses cleanly.
- Gitleaks `--no-git` (tracked tree): **0 real secrets** (23 false positives triaged).
- Not run (blocked, no real env files on disk): Cypress E2E, full web test
  suite against real Supabase, production build with real envs.
- Git history not audited by design (fresh repo planned). Any secret that ever
  existed in the old repo must still be rotated before publishing.

## Release blockers before publishing

1. **A0 (CRITICAL)** — Supabase schema/RLS is not versioned in the repo and
   could not be verified. Either commit sanitized migrations (`supabase db
   diff`) or run the RLS checklist in this report against the live project
   and record the result. Self-hosters currently cannot recreate the schema.
2. **Rotation** — rotate any credential that ever existed in the private
   repo's history (`MONEYPRINT_API_SECRET`, `TOKEN_ENCRYPTION_KEY`,
   `ZAI_API_KEY`, Supabase service key, OAuth client secrets) before or
   immediately after the new repo goes public.
3. **MEDIUM items M1–M7 and LOW items** below — recommended before release,
   not strictly blocking.
