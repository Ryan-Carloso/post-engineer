// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { REQUIRED_COLUMNS } from '../schema-expectations.gen';

const root = findRepoRoot(import.meta.url);

//---------------
// The committed schema-expectations.gen.ts must match what the generator
// derives from supabase/migrations today. A migration that adds a column
// without regenerating the file fails here, so the boot check (#308) can
// never silently miss a new column.
//---------------
describe('schema-expectations.gen.ts', () => {
  it('matches the generator output for the current migrations', async () => {
    const generator = await import(join(root, 'apps/web/scripts/generate-schema-expectations.mjs'));
    const committed = readFileSync(join(root, 'apps/web/lib/schema-expectations.gen.ts'), 'utf8');
    expect(committed).toBe(generator.generateSchemaExpectations());
  });

  it('lists the columns whose absence caused the 2026-10 production errors', () => {
    expect(REQUIRED_COLUMNS.scheduled_posts).toContain('faceless_material');
    expect(REQUIRED_COLUMNS.personas).toContain('cta_text');
    expect(REQUIRED_COLUMNS.post_metrics).toContain('script_angle');
  });
});
