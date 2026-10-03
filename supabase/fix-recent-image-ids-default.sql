-- Manual-apply SQL — run once in the Supabase dashboard (SQL editor).
--
-- PR #62 restored `default '{}'` to `personas.recent_image_ids` in the
-- canonical `supabase/schema.sql`, but that only covers fresh installs:
-- `create table if not exists` never alters an existing table, and
-- re-running `persona-images.sql` is a no-op here (`add column if not
-- exists` on a column that already exists never re-attaches the default).
-- DBs created from the pre-fix consolidated schema (including production,
-- which proved this with a 23502 on every persona insert) therefore still
-- have no default on this NOT NULL column.
--
-- The app insert always supplies the column explicitly, so this is
-- belt-and-suspenders: it converges deployed DBs with the migration chain,
-- so a future writer that omits the column can't 500 on those databases.
--
-- Idempotent: safe to re-run.

alter table public.personas
  alter column recent_image_ids set default '{}';
