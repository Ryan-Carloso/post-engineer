import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

//---------------
// scheduled_posts.faceless_material — written by generate-and-schedule at
// slot creation and read by the engine batch pipeline. The insert key must
// exist in the schema, and the CHECK must allow exactly the values the API
// accepts, or a valid "images" post fails its slot insert. Migration 054
// (issue #542) backfilled every stored row to 'images' and narrowed the
// check to that one value.
//---------------
const root = findRepoRoot(import.meta.url);
const migration = readFileSync(join(root, 'supabase/migrations/029_scheduled-posts-material.sql'), 'utf8');
// 054 drops and re-adds the 043 check with 'images' only (issue #542).
const imagesMigration = readFileSync(join(root, 'supabase/migrations/054_scheduled-posts-images-only-material.sql'), 'utf8');
const route = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/route.ts'), 'utf8');
const slotRows = readFileSync(join(root, 'apps/web/app/api/videos/generate-and-schedule/slot-rows.ts'), 'utf8');

describe('scheduled_posts.faceless_material', () => {
  it('is added to scheduled_posts with a broll default', () => {
    expect(migration).toContain('alter table public.scheduled_posts');
    expect(migration).toContain("add column if not exists faceless_material text not null default 'broll'");
  });

  it('allows exactly the values the API accepts', () => {
    expect(imagesMigration).toContain('drop constraint if exists scheduled_posts_faceless_material_check');
    expect(imagesMigration).toContain("check (faceless_material in ('images'))");
    // The material is no longer a user choice: pin the narrowed list and
    // the literal the route sends, so a one-sided change still fails here.
    const materials = readFileSync(join(root, 'apps/web/lib/generation/faceless-materials.ts'), 'utf8');
    expect(materials).toContain("export const FACELESS_MATERIALS = ['images'] as const;");
    expect(route).toContain("faceless_material: 'images',");
  });

  it('is written on every slot insert', () => {
    expect(slotRows).toContain("faceless_material: 'images',");
    expect(route).toContain('buildSlotRows({');
  });
});
