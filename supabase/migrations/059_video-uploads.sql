-- ============================================================================
-- 059 — Signed video uploads for publish-by-id (issue #561).
-- A remote (HTTP) MCP caller cannot send a local video path, so it first
-- mints a short-lived signed upload: one row per upload, bound to its
-- owner, holding the storage path in the private `videos` bucket
-- ({user_id}/direct-uploads/{upload_id}.{ext} — the first-segment prefix
-- is what the bucket RLS policies from 014 match on). The caller PUTs the
-- bytes straight to storage with the signed URL, the web app verifies the
-- real content (magic bytes) and marks the row `ready`, and publish-by-id
-- consumes the row exactly once (status `ready` -> `consumed` in one
-- conditional update, so a replay or a concurrent second publish loses).
-- Rows are never reused after consumption; an abandoned `pending` row
-- expires at `expires_at` and its object is best-effort removed by the
-- publish/complete paths. Idempotent.
-- ============================================================================

create table if not exists public.video_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  storage_path text not null unique,
  declared_content_type text,
  detected_content_type text,
  size_bytes bigint,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint video_uploads_status_check
    check (status in ('pending', 'ready', 'consumed')),
  constraint video_uploads_declared_content_type_check
    check (declared_content_type is null or declared_content_type in ('video/mp4', 'video/quicktime')),
  constraint video_uploads_detected_content_type_check
    check (detected_content_type is null or detected_content_type in ('video/mp4', 'video/quicktime')),
  constraint video_uploads_size_bytes_check
    check (size_bytes is null or size_bytes > 0)
);

create index if not exists video_uploads_user_status_idx
  on public.video_uploads (user_id, status, expires_at);

alter table public.video_uploads enable row level security;

-- Owner-read only. All writes go through the service role (which bypasses
-- RLS); the policy keeps direct user-JWT reads scoped to the owner, the
-- same shape as the other owner tables.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'video_uploads' and policyname = 'video_uploads_select_own'
  ) then
    create policy "video_uploads_select_own"
    on public.video_uploads for select
    using (user_id = auth.uid());
  end if;
end $$;
