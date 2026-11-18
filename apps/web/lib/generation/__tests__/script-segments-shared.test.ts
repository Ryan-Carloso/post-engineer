/**
 * @vitest-environment node
 */

// script-segments shared-source guard: the web copy of the segments
// validation must be a generated copy of shared/script-segments/
// script-segments.ts, never a hand-maintained second copy. This test
// fails loudly (instead of silently testing stale code) whenever the
// generated copy drifts from the shared source: run
// `node scripts/sync-script-segments.mjs` from the repo root to resync.
// The web copy is the shared text with the `.js` suffix stripped from
// its relative sibling imports: Next.js webpack resolves an explicit
// `.js` extension literally and fails the production build on it (see
// PR #659), while the MCP's NodeNext tsc requires the suffix.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';

const SHARED_RELATIVE = join('shared', 'script-segments', 'script-segments.ts');
const GENERATED_RELATIVE = join('apps', 'web', 'lib', 'generation', 'script-segments.ts');
// The segments validator imports its clip and text helpers from sibling
// shared modules; their generated copies must match the shared source
// too, or the web copy validates against stale helpers.
const SIBLINGS = ['segment-media.ts', 'segment-text.ts'];

// The web copy the sync script generates: shared text with `.js`
// stripped from relative sibling imports. (No replaceAll here: the
// web tsconfig lib predates ES2021, so String.replaceAll does not
// typecheck; the /g regex replace is equivalent.)
function toWebCopy(sourceText: string): string {
  return sourceText.replace(/from '(\.\/[^']+)\.js'/g, "from '$1'");
}

describe('script-segments shared source', () => {
  it('matches the shared source of truth, minus the .js import suffixes', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('DO NOT EDIT this copy directly');
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
    expect(shared).toContain('DO NOT EDIT this copy directly');
    expect(generated).toBe(shared);
  });
});
