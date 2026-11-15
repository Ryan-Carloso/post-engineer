-- ============================================================================
-- 063 — Existing-media columns on scheduled_posts (issue #384).
--
-- A scheduled post no longer has to be born from a generation: the
-- publish-existing flow schedules media that already exists (a ready
-- signed-upload video, or a plain image) by writing its reference on the
-- slot instead of an engine task id. A generated video keeps using
-- task_id (no media columns); the engine publisher only consults the
-- media columns when task_id is null.
--
-- media_kind: 'upload' (a ready video_uploads row, claimed by the engine
-- at publish time) or 'image' (bytes stored by the web in the `uploads`
-- bucket, downloaded by the engine at publish time). media_ref carries
-- the upload id or the storage path; media_content_type is the verified
-- content type the engine dispatches with. All three stay NULL on
-- generation-born slots, so the columns change nothing for them.
-- Idempotent (guarded constraint swap, CREATE-style add-if-missing).
-- ============================================================================

alter table public.scheduled_posts
  add column if not exists media_kind text,
  add column if not exists media_ref text,
  add column if not exists media_content_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_media_kind_check') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_media_kind_check
      check (media_kind is null or media_kind in ('upload', 'image'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_media_ref_check') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_media_ref_check
      check (media_kind is null or media_ref is not null);
  end if;
end $$;
