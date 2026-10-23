-- ============================================================================
-- Migration 024 — Per-persona call to action
-- ----------------------------------------------------------------------------
-- WHY: every script now ends with a call to action. By default the engine
-- picks a generic one (follow / comment / save); a persona that always wants
-- the same ask ("link na bio", "segue @canal") needs a place to store it.
--
-- WHAT: personas.cta_text holds the persona's call to action (null = generic).
-- schedules.post_cta_text is its creation-time snapshot, like every other
-- post_* column (migration 012): editing the persona later cannot change an
-- already-scheduled post. Both capped at 200 characters, mirrored by the web
-- (PERSONA_CTA_MAX_LENGTH) and the engine (MAX_SCRIPT_CTA_LENGTH).
--
-- Idempotent: safe to re-run (IF NOT EXISTS / pg_constraint-guarded checks).
-- ============================================================================

alter table public.personas add column if not exists cta_text text;

alter table public.schedules add column if not exists post_cta_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'personas_cta_text_length_check'
  ) then
    alter table public.personas
      add constraint personas_cta_text_length_check
      check (cta_text is null or char_length(cta_text) <= 200);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_post_cta_text_length_check'
  ) then
    alter table public.schedules
      add constraint schedules_post_cta_text_length_check
      check (post_cta_text is null or char_length(post_cta_text) <= 200);
  end if;
end $$;
