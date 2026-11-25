-- ============================================================================
-- 085 — scheduled_posts.hook_title: the on-screen headline of a slot's video.
--
-- A scheduled slot is rendered later by the engine, so the optional hook title
-- (a short headline over the first seconds, issue #768) must be stored with
-- the slot. NULL means no title. The check mirrors HOOK_TITLE_MAX_CHARS in
-- shared/script-segments/hook-title.ts (60); a file-parsing test pins both.
-- Idempotent: the column is guarded by IF NOT EXISTS, the check by pg_constraint.
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists hook_title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_hook_title_length_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      add constraint scheduled_posts_hook_title_length_check
      check (hook_title is null or char_length(hook_title) between 1 and 60);
  end if;
end $$;
