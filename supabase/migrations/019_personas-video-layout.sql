-- ============================================================================
-- Migration 019 — video_layout: compose the persona with the b-roll
-- ----------------------------------------------------------------------------
-- WHY: a persona hook is the only place the talking head meets the b-roll,
-- and until now there was exactly one way to do it — the avatar fills the
-- frame and replaces the opening seconds. "react" is the second: the frame
-- splits in half, avatar on top, b-roll below, which is the format most
-- short-form commentary uses. The hook itself is unchanged (same LongCat
-- render, same cost); only the ffmpeg filter that lays it over the b-roll
-- changes, so this is a presentation choice and not a pricing one.
-- ============================================================================
--
-- "standard" (NULL) keeps the historical behaviour. "react" splits the frame
-- in half — avatar on top, b-roll below.
--
-- NULL means standard, NOT "unknown": rows written before this migration have
-- no value here, and treating NULL as standard is what keeps every existing
-- persona rendering exactly as it did. No backfill, on purpose — rewriting
-- rows that already render the same way buys nothing.
--
-- schedules.post_video_layout mirrors the existing post_video_aspect
-- (migration 012): the per-post snapshot taken when a slot is created, so a
-- later persona edit cannot retroactively change an already-scheduled post.

alter table public.personas
  add column if not exists video_layout text;

alter table public.schedules
  add column if not exists post_video_layout text;

-- Guard: only the two documented values may be stored. The engine fails a
-- task loudly on anything else, so the database rejecting it at write time
-- turns a late render failure into an early, cheap validation error.
--
-- Personas created through the app go through the service-role API route,
-- which bypasses RLS, so this constraint is the only place a typo is caught
-- before a GPU second is spent on it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'personas_video_layout_check'
  ) then
    alter table public.personas
      add constraint personas_video_layout_check
      check (video_layout is null or video_layout in ('standard', 'react'));
  end if;
end $$;