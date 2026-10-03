-- ============================================================================
-- Migration 005 — Persona visual identity: never two faces
-- ----------------------------------------------------------------------------
-- HOW TO APPLY: Supabase Dashboard > SQL Editor > New query > paste & run,
-- after 004_billing_reconcile.sql. Safe to re-run (idempotent).
--
-- WHY: a persona renders its face from EITHER an uploaded photo (photo_path,
-- private storage) OR a chosen character / AI avatar (avatar_url). Both set
-- is ambiguous — the UI silently prefers avatar_url, so a photo persona that
-- kept its photo_path after switching to a character would show the WRONG
-- face with no error anywhere. Production had a hand-made constraint for this
-- ("exactly one"), but the migration chain did not, so self-hosters ran with
-- no invariant at all.
--
-- SCOPE — deliberately "never both", not "exactly one": a faceless persona
-- (face_mix_percent = 0, no photo, no character) is legitimate and is
-- creatable through the API/MCP. An "exactly one" constraint would 500 those
-- creations; production carries that stricter form from before this file and
-- keeps working because the web UI always sends a face. Do not tighten it
-- here without making the route require a face for faceless personas.
--
-- The app depends on the invariant: PATCH /api/persona swaps identities in a
-- single update (sets one column, nulls the other).
-- ============================================================================

-- 1. Repair first: a row with both set has no single source of truth. The
--    photo wins — it is the user's own upload, and the character is the
--    leftover from the switch that should have cleared it.
update public.personas
   set avatar_url = null
 where photo_path is not null
   and avatar_url is not null;

-- 2. The invariant, added only when missing (re-running is a no-op).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.personas'::regclass
      and conname = 'personas_visual_identity_check'
  ) then
    -- NOT VALID: the repair above is best-effort and a huge table should not
    -- be fully scanned during a migration; new and updated rows are checked
    -- from here on.
    alter table public.personas
      add constraint personas_visual_identity_check
      check (photo_path is null or avatar_url is null) not valid;
  end if;
end
$$;
