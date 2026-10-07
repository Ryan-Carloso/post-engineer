-- ============================================================================
-- Migration 015 — Publish mode on the schedule (scheduled vs ASAP)
-- ----------------------------------------------------------------------------
-- Applied automatically: the deploy workflow runs `supabase db push` (pending
-- only) on every merge to main. Never apply by hand in the dashboard.
-- Safe to re-run (idempotent): every statement is guarded on the object it
-- needs.
--
-- WHY: POST /api/videos/generate-and-schedule gains an ASAP mode — the video
-- is published to the chosen accounts the moment generation finishes, with
-- no scheduled time. The schedule row needs to record which mode a post was
-- created with so the UI can render "publishes as soon as ready" instead of
-- a slot time, and so the two modes stay distinguishable in history.
--
-- NULL semantics: the column is NOT NULL DEFAULT 'scheduled' — every row
-- created before this migration is a scheduled post by construction (the API
-- refused anything else), so the default backfills the truth, not a guess.
-- A CHECK constraint pins the two spellings the API accepts.
-- ============================================================================

alter table public.schedules
  add column if not exists publish_mode text not null default 'scheduled';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schedules_publish_mode_check'
  ) then
    alter table public.schedules
      add constraint schedules_publish_mode_check
      check (publish_mode in ('scheduled', 'asap'));
  end if;
end $$;

comment on column public.schedules.publish_mode is
  'How the post publishes: scheduled (at the slot times) or asap (published the moment generation finishes, no scheduled time).';
