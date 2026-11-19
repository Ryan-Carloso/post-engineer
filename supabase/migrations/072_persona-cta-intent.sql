-- ============================================================================
-- Migration 072 — Per-persona CTA, intent only (issue #639)
-- ----------------------------------------------------------------------------
-- WHY: the old stored-text CTA (personas.cta_text, migration 024) held a
-- fixed phrase written at persona creation — but the agent has more
-- context at video time, so a hardcoded phrase is wrong for most videos.
-- The persona now stores INTENT only: cta_type (follow | comment | share
-- | save | link | buy | other) plus facts — a URL for link/buy, a free-text
-- instruction for other. The agent writes the CTA wording per video from
-- that video's topic and story.
--
-- WHAT: personas.cta_type (NOT NULL DEFAULT 'follow': a persona without a
-- CTA behaves as follow — no backfill needed), cta_url (<= 2048 chars),
-- cta_instruction (<= 500 chars), mirrored as post_cta_* snapshot columns
-- on schedules (migration 012 pattern: editing the persona later cannot
-- rewrite an already-scheduled video). The old stored-text columns
-- (personas.cta_text, schedules.post_cta_text) are dropped — BETA rule:
-- delete the old path, never keep both.
--
-- The cta_type list is pinned to the TS source of truth
-- (shared/contracts/personas.ts PERSONA_CTA_TYPES) by
-- persona-cta-types-migration.test.ts.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / pg_constraint-guarded checks).
-- ============================================================================

alter table public.personas add column if not exists cta_type text not null default 'follow';
alter table public.personas add column if not exists cta_url text;
alter table public.personas add column if not exists cta_instruction text;

alter table public.schedules add column if not exists post_cta_type text not null default 'follow';
alter table public.schedules add column if not exists post_cta_url text;
alter table public.schedules add column if not exists post_cta_instruction text;

alter table public.personas drop column if exists cta_text;
alter table public.schedules drop column if exists post_cta_text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'personas_cta_type_check'
  ) then
    alter table public.personas
      add constraint personas_cta_type_check
      check (cta_type in ('follow', 'comment', 'share', 'save', 'link', 'buy', 'other'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_post_cta_type_check'
  ) then
    alter table public.schedules
      add constraint schedules_post_cta_type_check
      check (post_cta_type in ('follow', 'comment', 'share', 'save', 'link', 'buy', 'other'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'personas_cta_url_length_check'
  ) then
    alter table public.personas
      add constraint personas_cta_url_length_check
      check (cta_url is null or char_length(cta_url) <= 2048);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'personas_cta_instruction_length_check'
  ) then
    alter table public.personas
      add constraint personas_cta_instruction_length_check
      check (cta_instruction is null or char_length(cta_instruction) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_post_cta_url_length_check'
  ) then
    alter table public.schedules
      add constraint schedules_post_cta_url_length_check
      check (post_cta_url is null or char_length(post_cta_url) <= 2048);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_post_cta_instruction_length_check'
  ) then
    alter table public.schedules
      add constraint schedules_post_cta_instruction_length_check
      check (post_cta_instruction is null or char_length(post_cta_instruction) <= 500);
  end if;
end $$;
