-- ============================================================================
-- 056 — video_type on scheduled_posts (issue #542 follow-up).
--
-- The one video mode replaces the faceless / full_lipsync / lipsync_enabled
-- boolean combination everywhere in the request contract (web zod, MCP
-- shapes, engine VideoParams). generate-and-schedule writes it on every
-- slot and the engine's batch pipeline (fill_schedule) reads it back when
-- a tick-dispatched or requeued slot is rebuilt. The old boolean columns
-- stay as derived storage (their defaults still apply and the web keeps
-- writing them from video_type, because the batch-discount billing reads
-- them) — they are no longer part of any request contract.
--
-- Backfill: every stored row derives its mode from the booleans it was
-- created with (faceless -> 'faceless', full_lipsync -> 'full_lipsync',
-- anything else -> 'hook_lipsync', the historical default). The column is
-- NOT NULL with the same 'hook_lipsync' default and a check pinning the
-- three values. Idempotent: rerunning re-adds the same column, check, and
-- backfill (a row already carrying the derived value keeps it).
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists video_type text not null default 'hook_lipsync';

update public.scheduled_posts
  set video_type = case
    when faceless then 'faceless'
    when full_lipsync then 'full_lipsync'
    else 'hook_lipsync'
  end;

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_video_type_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_video_type_check
  check (video_type in ('full_lipsync', 'hook_lipsync', 'faceless'));
