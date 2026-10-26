import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// scheduled_posts.faceless_material — written by generate-and-schedule at
// slot creation and read by the engine batch pipeline. The insert key must
// exist in the schema, and the CHECK must allow exactly the values the API
// accepts, or a valid "svg" post fails its slot insert.
//---------------
const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/029_scheduled-posts-material.sql'), 'utf8');
const route = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/route.ts'), 'utf8');

describe('scheduled_posts.faceless_material', () => {
  it('is added to scheduled_posts with a broll default', () => {
    expect(migration).toContain('alter table public.scheduled_posts');
    expect(migration).toContain("add column if not exists faceless_material text not null default 'broll'");
  });

  it('allows exactly the values the API accepts', () => {
    expect(migration).toContain("check (faceless_material in ('broll', 'svg'))");
    expect(route).toContain("facelessMaterial: z.enum(['broll', 'svg']).optional()");
  });

  it('is written on every slot insert', () => {
    expect(route).toContain('faceless_material: validatedOptions.facelessMaterial,');
  });
});
