-- ============================================================================
-- 067 — Signed uploads carry images too.
--
-- A signed upload (video_uploads, migration 060) was video-only. The image
-- networks (Instagram, Bluesky, LinkedIn, Threads, Facebook, Pinterest) now
-- post JPEG/PNG images, and the remote MCP server sends an image through
-- the same signed upload instead of base64 in a tool argument. The web caps
-- an image upload at 8 MB and verifies its real type by magic bytes, like
-- a video.
--
-- Widens both content-type checks to the four types the web accepts
-- (UPLOAD_CONTENT_TYPES in shared/contracts/upload-types.ts, pinned by
-- migration-check-constraints-sync.test.ts). Idempotent: each constraint
-- is dropped if it exists, then re-created.
-- ============================================================================

alter table public.video_uploads
  drop constraint if exists video_uploads_declared_content_type_check;
alter table public.video_uploads
  add constraint video_uploads_declared_content_type_check
    check (declared_content_type is null or declared_content_type in ('video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'));

alter table public.video_uploads
  drop constraint if exists video_uploads_detected_content_type_check;
alter table public.video_uploads
  add constraint video_uploads_detected_content_type_check
    check (detected_content_type is null or detected_content_type in ('video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'));
