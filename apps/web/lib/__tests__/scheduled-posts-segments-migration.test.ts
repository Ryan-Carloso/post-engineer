import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// scheduled_posts.segments — written by generate-and-schedule at slot
// creation and read by the engine batch pipeline. Without the column,
// a requeued slot (engine restart mid-generation) or a tick-dispatched
// pending slot regenerates from the topic alone: the script differs
// and every user photo disappears with no warning.
//---------------
const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/030_scheduled-posts-segments.sql'), 'utf8');
const route = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/route.ts'), 'utf8');
const slotRows = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/slot-rows.ts'), 'utf8');

describe('scheduled_posts.segments', () => {
  it('is added to scheduled_posts as a nullable jsonb column', () => {
    expect(migration).toContain('alter table public.scheduled_posts');
    expect(migration).toContain('add column if not exists segments jsonb');
  });

  it('is written on every slot insert', () => {
    expect(slotRows).toContain('segments: input.segments ?? null,');
    expect(route).toContain('buildSlotRows({');
  });
});
