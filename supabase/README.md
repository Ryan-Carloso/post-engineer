# Supabase migrations

Numbered, append-only migration files live in `supabase/migrations/`.
Apply them in **numeric order** (lowest number first). The `NNN_` prefix is
the order — you never need to guess or read docs to know what comes next:

| #   | File                                        | What it does                                        |
| --- | ------------------------------------------- | --------------------------------------------------- |
| 001 | `migrations/001_schema.sql`                 | Base schema: tables, types, defaults (snapshot)     |
| 002 | `migrations/002_persona-images.sql`         | Persona image library: constraints, trigger, RPCs   |
| 003 | `migrations/003_engine-task-state.sql`      | Engine task state (only for `MPT_STATE_BACKEND=supabase`) |

## How to apply

**Production (this repo's hosted project):** fully automated — never apply
manually. After a PR merges to `main`:

1. CI (`.github/workflows/ci.yml`, job `supabase-migrations`) has already
   validated the migration chain on the PR: numbering is unique and
   strictly increasing, destructive DDL (`DROP COLUMN`, `TRUNCATE`,
   unconditional `DROP TABLE`) is blocked unless the PR carries the
   `db:destructive-approved` label, and the whole chain applies cleanly to
   a fresh Postgres.
2. The Deploy workflow (`.github/workflows/deploy.yml`) runs
   `supabase db push --linked`, which applies **only pending migrations**
   (tracked in `supabase_migrations.schema_migrations`).
3. The web app itself is deployed to our own VPS
   (`apps/web/docker-compose.yml`, via `deploy.sh` on the host) — migrations
   land first, then the host is redeployed.

**Self-hosters / local:** for each file, in order: Supabase Dashboard →
SQL Editor → New query → paste the file → run — or, from the repo root,
`supabase db push --db-url "<connection-string>"` (reads
`supabase/migrations/`). See each file's header for prerequisites and
details (some dashboard-only steps like RLS policies, FK checks and the
`personas` storage bucket are listed there too).

All statements are idempotent, so re-running the whole sequence is always
safe.

## Adding a new migration (maintainers)

- **Append** a new numbered file (`migrations/004_....sql`,
  `migrations/005_....sql`, …). Never edit an already-shipped number —
  existing databases must be able to apply only the new files.
- Keep every statement idempotent (`create table if not exists`,
  `add column if not exists`, `create or replace`, `drop ... if exists`
  before recreate). Inline `references` in `create table` does NOT fire on
  an existing table — add FKs on existing tables in an explicit do-block
  (see section 1b of `migrations/002_persona-images.sql` for the pattern).
- Avoid destructive DDL. `DROP COLUMN`, `TRUNCATE`, and unconditional
  `DROP TABLE` are blocked in CI unless the PR carries the
  `db:destructive-approved` label — data loss must be an explicit,
  reviewed decision.
- If the migration adds behavior the app depends on, add a static sync
  test that parses the SQL file and asserts the literals (see the
  `supabase/migrations/002_persona-images.sql literals` describe block in
  `apps/web/lib/__tests__/persona-images.test.ts` for the pattern).
- Update the table above and `docs/SELF_HOSTING.md`.

## Pipeline secrets (repo settings → Secrets and variables → Actions)

| Secret                   | Used for                                              |
| ------------------------ | ----------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | `supabase link` authentication                        |
| `SUPABASE_PROJECT_ID`    | `supabase link --project-ref`                         |
| `SUPABASE_DB_PASSWORD`   | Direct Postgres connection used by `supabase db push` |

One-time production bootstrap (run once locally, before the first automated
deploy) — marks the previously dashboard-applied migrations as applied so
the first `db push` only picks up genuinely new files:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_ID"
supabase migration repair --status applied --version 001
supabase migration repair --status applied --version 002
supabase migration repair --status applied --version 003
```

(All statements are idempotent, so skipping the repair is safe — the first
push would just re-apply everything as no-ops.)
