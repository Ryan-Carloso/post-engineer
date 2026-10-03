# Supabase migrations

Apply the files in this directory in **numeric order** (lowest number first).
The `NNN_` prefix is the order — you never need to guess or read docs to
know what comes next:

| #   | File                             | What it does                                        |
| --- | -------------------------------- | --------------------------------------------------- |
| 001 | `001_schema.sql`                 | Base schema: tables, types, defaults (snapshot)     |
| 002 | `002_persona-images.sql`         | Persona image library: constraints, trigger, RPCs   |
| 003 | `003_engine-task-state.sql`      | Engine task state (only for `MPT_STATE_BACKEND=supabase`) |

## How to apply

For each file, in order: Supabase Dashboard → SQL Editor → New query →
paste the file → run. See each file's header for prerequisites and details
(some dashboard-only steps like RLS policies, FK checks and the `personas`
storage bucket are listed there too).

All statements are idempotent, so re-running the whole sequence is always
safe.

## Adding a new migration (maintainers)

- **Append** a new numbered file (`004_....sql`, `005_....sql`, …). Never
  edit an already-shipped number — existing self-hosters must be able to
  apply only the new files.
- Keep every statement idempotent (`create table if not exists`,
  `add column if not exists`, `create or replace`, `drop ... if exists`
  before recreate). Inline `references` in `create table` does NOT fire on
  an existing table — add FKs on existing tables in an explicit do-block
  (see section 1b of `002_persona-images.sql` for the pattern).
- If the migration adds behavior the app depends on, add a static sync
  test that parses the SQL file and asserts the literals (see the
  `supabase/002_persona-images.sql literals` describe block in
  `apps/web/lib/__tests__/persona-images.test.ts` for the pattern).
- Update the table above and `docs/SELF_HOSTING.md`.
