-- 015: raise the `videos` bucket file_size_limit.
--
-- Migration 014 created the bucket without an explicit file_size_limit, so
-- Supabase's platform default (50 MB) applied. Final videos regularly
-- exceed that, and the archive upload then fails with 400/413
-- EntityTooLarge ("The object exceeded the maximum allowed size") — the
-- video is never archived, and /stream/ + /download/ 404 after an engine
-- restart (observed in production 2026-10-07: "video_storage: upload failed
-- for .../final-1.mp4: 400 ... EntityTooLarge").
--
-- This raises the bucket-level limit to 5 GB. Standard single-request
-- uploads cap at 5 GB, so no resumable/tus chunking is needed for final
-- videos.
--
-- NOTE: the bucket-level limit can never exceed the project's Global file
-- size limit (Storage Settings). If the global limit is still at the 50 MB
-- default, it must be raised in the Supabase dashboard as well — that step
-- is outside this migration.

update storage.buckets
set file_size_limit = 5368709120
where id = 'videos';
