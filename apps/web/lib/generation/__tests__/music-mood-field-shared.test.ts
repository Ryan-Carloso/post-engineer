/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const SHARED_RELATIVE = join('shared', 'music-mood-field', 'music-mood-field.ts');
const GENERATED_RELATIVE = join('apps', 'web', 'lib', 'generation', 'music-mood-field.ts');

describe('music-mood-field shared source', () => {
  it('is byte-identical to the shared source of truth', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('export const musicMoodField');
    expect(generated).toBe(shared);
  });
});
