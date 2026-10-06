-- ============================================================================
-- Migration 010 — Scheduled post progress history
-- ----------------------------------------------------------------------------
-- WHY: generation progress for a scheduled post is read live from the
-- engine task, so a progress regression (e.g. 40% -> 0% when a kwargs-only
-- update_task() call reset progress to its default) left no trace anywhere.
-- This table records every observed (progress, stage) transition per post,
-- so the Posts page can show what actually happened over time.
--
-- WRITES: best-effort, change-only — GET /api/schedule/status inserts one
-- row per post only when the observed (progress, stage) differs from the
-- last recorded one, so a generation leaves ~10-15 rows, not one per poll.
-- Rows die with their post (ON DELETE CASCADE).
-- ============================================================================

create table if not exists public.scheduled_post_progress_history (
  id uuid not null default gen_random_uuid() primary key,
  post_id uuid not null,
  user_id uuid not null,
  progress integer not null,
  stage text,
  recorded_at timestamptz not null default now()
);

-- FK declared in a guarded do-block: inline `references` on
-- `create table if not exists` never fires when the table already exists
-- (pattern: section 1b of migrations/002_persona-images.sql).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_progress_history_post'
  ) then
    alter table public.scheduled_post_progress_history
      add constraint fk_progress_history_post
      foreign key (post_id) references public.scheduled_posts (id)
      on delete cascade;
  end if;
end $$;

create index if not exists scheduled_post_progress_history_post_id_idx
  on public.scheduled_post_progress_history (post_id, recorded_at desc);

-- RLS: owner-only, mirroring public.persona_images. The policy also verifies
-- the referenced post itself belongs to the caller, so a forged post_id can
-- never attach history to someone else's post.
alter table public.scheduled_post_progress_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'scheduled_post_progress_history'
      and policyname = 'progress_history_owner_all'
  ) then
    create policy "progress_history_owner_all"
      on public.scheduled_post_progress_history
      for all
      using (
        auth.uid() = user_id
        and exists (
          select 1 from public.scheduled_posts p
          where p.id = scheduled_post_progress_history.post_id
            and p.user_id = auth.uid()
        )
      )
      with check (
        auth.uid() = user_id
        and exists (
          select 1 from public.scheduled_posts p
          where p.id = scheduled_post_progress_history.post_id
            and p.user_id = auth.uid()
        )
      );
  end if;
end $$;
