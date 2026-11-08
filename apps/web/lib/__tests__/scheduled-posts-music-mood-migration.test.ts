import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// scheduled_posts.music_mood — written by generate-and-schedule at slot
// creation and read by the engine batch pipeline (fill_schedule
// .slot_music_mood) when a tick-dispatched or requeued slot is rebuilt.
// The insert key must exist in the schema or a valid post fails its slot
// insert; the engine reader must forward it or the slot silently renders
// the engine's default mood instead of the requested one.
//---------------
const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/045_scheduled-posts-music-mood.sql'), 'utf8');
const slotRows = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/slot-rows.ts'), 'utf8');
const route = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/route.ts'), 'utf8');
const support = readFileSync(join(root, 'apps/engine/app/services/fill_schedule/support.py'), 'utf8');
const generate = readFileSync(join(root, 'apps/engine/app/services/fill_schedule/generate.py'), 'utf8');

describe('scheduled_posts.music_mood', () => {
  it('is added to scheduled_posts as a nullable text column', () => {
    expect(migration).toContain('alter table public.scheduled_posts');
    expect(migration).toContain('add column if not exists music_mood text');
  });

  it('is written on every slot insert', () => {
    expect(slotRows).toContain('music_mood: input.musicMood ?? null,');
    expect(route).toContain('musicMood: validatedOptions.musicMood,');
  });

  it('is read back by the engine batch pipeline', () => {
    expect(support).toContain('def slot_music_mood(slot');
    expect(generate).toContain('music_mood=slot_music_mood(slot),');
  });
});
