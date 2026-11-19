import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    }
    dir = parent;
  }
}

const SHARED_RELATIVE = join('shared', 'script-segments', 'script-segments.ts');
const GENERATED_RELATIVE = join('apps', 'mcp', 'src', 'script-segments.ts');
const SIBLINGS = ['segment-media.ts', 'segment-text.ts'];
const SIBLING_EXPORTS: Record<string, string> = {
  'segment-media.ts': 'export const CLIP_DENSITY_ITEMS',
  'segment-text.ts': 'export function hasForbiddenContent',
};

describe('script-segments shared source', () => {
  it('is byte-identical to the shared source of truth', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('export const MAX_SEGMENTS');
    expect(generated).toBe(shared);
  });

  it.each(SIBLINGS)('keeps the %s helper copy byte-identical to shared', (name) => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, 'shared', 'script-segments', name), 'utf8');
    const generated = readFileSync(join(root, 'apps', 'mcp', 'src', name), 'utf8');
    expect(shared).toContain(SIBLING_EXPORTS[name]);
    expect(generated).toBe(shared);
  });
});
