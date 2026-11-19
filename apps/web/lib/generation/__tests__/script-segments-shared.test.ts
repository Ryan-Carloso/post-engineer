/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const SHARED_RELATIVE = join('shared', 'script-segments', 'script-segments.ts');
const GENERATED_RELATIVE = join('apps', 'web', 'lib', 'generation', 'script-segments.ts');
const SIBLINGS = ['segment-media.ts', 'segment-text.ts'];
const SIBLING_EXPORTS: Record<string, string> = {
  'segment-media.ts': 'export const CLIP_DENSITY_ITEMS',
  'segment-text.ts': 'export function hasForbiddenContent',
};

function toWebCopy(sourceText: string): string {
  return sourceText.replace(/from '(\.\/[^']+)\.js'/g, "from '$1'");
}

describe('script-segments shared source', () => {
  it('matches the shared source of truth, minus the .js import suffixes', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('export const MAX_SEGMENTS');
    expect(generated).toBe(toWebCopy(shared));
  });

  it('imports its sibling helpers without a .js suffix (Next.js webpack cannot resolve it)', () => {
    const root = findRepoRoot(import.meta.url);
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(generated).toContain("from './segment-media'");
    expect(generated).toContain("from './segment-text'");
    expect(generated).not.toContain('./segment-media.js');
    expect(generated).not.toContain('./segment-text.js');
  });

  it.each(SIBLINGS)('keeps the %s helper copy byte-identical to shared', (name) => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, 'shared', 'script-segments', name), 'utf8');
    const generated = readFileSync(join(root, 'apps', 'web', 'lib', 'generation', name), 'utf8');
    expect(shared).toContain(SIBLING_EXPORTS[name]);
    expect(generated).toBe(shared);
  });
});
