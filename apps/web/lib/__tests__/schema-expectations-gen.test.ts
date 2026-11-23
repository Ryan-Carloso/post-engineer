// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { REQUIRED_COLUMNS } from '../schema-expectations.gen';

const root = findRepoRoot(import.meta.url);

describe('schema-expectations.gen.ts', () => {
  it('matches the generator output for the current migrations', async () => {
    const generator = await import(join(root, 'apps/web/scripts/generate-schema-expectations.mjs'));
    const committed = readFileSync(join(root, 'apps/web/lib/schema-expectations.gen.ts'), 'utf8');
    expect(committed).toBe(generator.generateSchemaExpectations());
  });

  it('lists the columns whose absence caused the 2026-10 production errors', () => {
    expect(REQUIRED_COLUMNS.scheduled_posts).toContain('voiceover_material');
    expect(REQUIRED_COLUMNS.personas).toContain('cta_type');
    expect(REQUIRED_COLUMNS.post_metrics).toContain('script_angle');
  });

  it('does not list a table that migration 078 dropped', () => {
    expect(REQUIRED_COLUMNS.experiments).toBeUndefined();
  });
});
