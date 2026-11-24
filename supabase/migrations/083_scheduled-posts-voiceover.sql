-- ============================================================================
-- 083 — The 'faceless' video mode is now 'voiceover'.
--
-- "Faceless" described the images, not the render: the mode only means the
-- persona is not lip-synced on camera. The agent images may show people, and
-- agents read "faceless" as "never use a photo with a face". The mode is now
-- named for what it renders: the persona's voice over the agent images.
--
-- 1. scheduled_posts.video_type: 'faceless' rows become 'voiceover' and the
--    check pins the new value set (NOT VALID + VALIDATE, migration 056).
-- 2. scheduled_posts.faceless -> voiceover (same boolean, same default).
-- 3. scheduled_posts.faceless_material -> voiceover_material, and its check
--    is renamed to scheduled_posts_voiceover_material_check.
-- No SQL function reads these columns, so no function body changes.
-- Idempotent: every rename is guarded, the update is a no-op on rerun.
-- ============================================================================

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_video_type_check;

update public.scheduled_posts
  set video_type = 'voiceover'
  where video_type = 'faceless';

alter table public.scheduled_posts
  add constraint scheduled_posts_video_type_check
  check (video_type in ('full_lipsync', 'hook_lipsync', 'voiceover')) not valid;

alter table public.scheduled_posts
  validate constraint scheduled_posts_video_type_check;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scheduled_posts'
      and column_name = 'faceless'
  ) then
    alter table public.scheduled_posts rename column faceless to voiceover;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scheduled_posts'
      and column_name = 'faceless_material'
  ) then
    alter table public.scheduled_posts
      rename column faceless_material to voiceover_material;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'scheduled_posts_faceless_material_check'
      and conrelid = 'public.scheduled_posts'::regclass
  ) then
    alter table public.scheduled_posts
      rename constraint scheduled_posts_faceless_material_check
      to scheduled_posts_voiceover_material_check;
  end if;
end $$;
