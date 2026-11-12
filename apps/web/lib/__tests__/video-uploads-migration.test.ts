import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// supabase/migrations/060_video-uploads.sql — signed video uploads for
// publish-by-id (issue #561): one owner-bound row per upload with a
// single-use status, pinned here so the migration, the TS status list
// (lib/videos/signed-upload.ts) and supabase/README.md cannot drift.
//---------------

const repoRoot = findRepoRoot(import.meta.url);
const migration = readFileSync(
  join(repoRoot, 'supabase', 'migrations', '060_video-uploads.sql'),
  'utf8',
);
const readme = readFileSync(join(repoRoot, 'supabase', 'README.md'), 'utf8');

describe('supabase/migrations/060_video-uploads.sql', () => {
  it('creates the video_uploads table idempotently', () => {
    expect(migration).toContain('create table if not exists public.video_uploads');
    expect(migration).toContain("status text not null default 'pending'");
  });

  it('pins the single-use status list the TS state machine uses', () => {
    expect(migration).toContain("check (status in ('pending', 'ready', 'consumed'))");
  });

  it('pins the accepted video content types on both type columns', () => {
    expect(migration).toContain("declared_content_type in ('video/mp4', 'video/quicktime')");
    expect(migration).toContain("detected_content_type in ('video/mp4', 'video/quicktime')");
  });

  it('enables owner-read RLS', () => {
    expect(migration).toContain('alter table public.video_uploads enable row level security');
    expect(migration).toContain('video_uploads_select_own');
    expect(migration).toContain('user_id = auth.uid()');
  });

  it('is listed in supabase/README.md', () => {
    expect(readme).toContain('060_video-uploads.sql');
  });
});
