# Supabase migrations

Numbered, append-only migration files live in `supabase/migrations/`.
Apply them in **numeric order** (lowest number first). The `NNN_` prefix is
the order — you never need to guess or read docs to know what comes next:

| #   | File                                        | What it does                                        |
| --- | ------------------------------------------- | --------------------------------------------------- |
| 001 | `migrations/001_schema.sql`                 | Base schema: tables, types, defaults (snapshot)     |
| 002 | `migrations/002_persona-images.sql`         | Persona image library: constraints, trigger, RPCs   |
| 003 | `migrations/003_engine-task-state.sql`      | Engine task state (only for `MPT_STATE_BACKEND=supabase`) |
| 004 | `migrations/004_billing_reconcile.sql`        | Billing reconciliation: zombie/stuck detectors, daily pg_cron trigger (fully automatic, no review queue) |
| 005 | `migrations/005_persona-visual-identity.sql` | CHECK: a persona never has both `photo_path` and `avatar_url` |
| 006 | `migrations/006_test-deploy-supabase.sql`    | Test-deploy schema verification (CI/dev only)    |
| 007 | `migrations/007_personas-drop-face-mix.sql`  | `scheduled_posts.faceless` (per-post "no face") + `drop column personas.face_mix_percent`: personas are always faced. **Destructive** — needs the `db:destructive-approved` PR label |
| 008 | `migrations/008_video-generations-engine-task-id-idx.sql` | Index `video_generations.engine_task_id`: generation_id ↔ task_id correlation for debugging. No FK (engine_task_state is ephemeral) |

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

## `personas` storage bucket (private) — object layout

Objects live under the user's folder, then the persona's:

```
personas/{userId}/{personaId}/photo.{jpg|png}        the persona's single visual identity
personas/{userId}/{personaId}/images/{uuid}.{ext}    the image library (0-10 items)
```

The persona folder is for **debugging in this dashboard** (you can tell whose
file it is without opening the database). It is not a second security gate:

- `personas_storage_own_all` checks ONLY the first segment —
  `(storage.foldername(name))[1] = auth.uid()`. A deeper path keeps working
  untouched, and the objects written before this layout (flat
  `{userId}/{uuid}.{ext}`) stay valid: the DB stores the full path in
  `personas.photo_path` / `persona_images.image_path`, so no backfill exists or
  is needed.
- Real ownership is enforced on the TABLE (`personas.user_id`,
  `persona_images.user_id`), re-checked by every route, and the bucket is
  private behind signed URLs.

Do not "harden" the policy to require two segments: that locks every legacy
object out of its owner with no way to recover the files.
`apps/web/lib/persona-images.ts` (`personaAssetPath`) is the only place that
builds these paths, and the tests pin the shape per writer.

## Adding a new migration (maintainers)

- **Append** a new numbered file (`migrations/005_....sql`,
  `migrations/006_....sql`, …). Never edit an already-shipped number —
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
# Roda na sua máquina (não no CI nem na VPS), uma única vez, antes do
# primeiro deploy automático. Marca como aplicadas no histórico as migrations
# que já foram aplicadas manualmente pelo dashboard, sem rodar o SQL delas.
# Não precisa de `supabase link` nem de access token para este passo.
# (Versões são argumentos posicionais — não existe flag --version no repair.)
supabase migration repair --status applied 001 002 003 004 005 \
  --db-url "postgresql://postgres:<DB_PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres"
```
- `<DB_PASSWORD>`: Supabase Dashboard → Project Settings → Database
  (se perdeu, dá para resetar lá). Se a senha tiver caracteres especiais
  (`@`, `/`, `:`…), use a forma percent-encoded na URL (`@` → `%40`).
- `<PROJECT_REF>`: Dashboard → Project Settings → General → Reference ID
  (o `<ref>` de `https://<ref>.supabase.co`).

(All statements are idempotent, so skipping the repair is safe — the first
push would just re-apply everything as no-ops.)
