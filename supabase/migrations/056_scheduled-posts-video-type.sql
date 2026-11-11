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
-- created with (faceless -> 'faceless', full_lipsync -> 'full_lipsync').
-- The else branch is photo-aware, not a plain 'hook_lipsync': before this
-- PR the batch filler never checked for a photo, so a persona without one
-- simply had its lip-sync intro skipped (persona_lipsync_active false)
-- and the video rendered from the agent images. Mapping such a row to
-- hook_lipsync would fail it pre-dispatch with no refund, so it stays
-- faceless unless the schedule's persona currently has a photo (live
-- personas row; a deleted persona or a photo-less one means the row
-- rendered images-only before). A full_lipsync row keeps its mode even
-- without a photo: full lip-sync requires a face by design, and the
-- filler refunds that failure (see generate.py) instead of silently
-- downgrading the requested mode. The column is NOT NULL with the same
-- 'hook_lipsync' default and a check pinning the three values.
-- Idempotent: rerunning re-adds the same column, check, and backfill
-- (a row already carrying the derived value keeps it).
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists video_type text not null default 'hook_lipsync';

update public.scheduled_posts sp
  set video_type = case
    when sp.faceless then 'faceless'
    when sp.full_lipsync then 'full_lipsync'
    when exists (
      select 1
      from public.schedules s
      join public.personas p on p.id = s.persona_id
      where s.id = sp.schedule_id
        and (p.photo_path is not null or p.avatar_url is not null)
    ) then 'hook_lipsync'
    else 'faceless'
  end;

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_video_type_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_video_type_check
  check (video_type in ('full_lipsync', 'hook_lipsync', 'faceless'));
