// script-segments shared-source guard: the MCP copy of the segments
// validation must be a generated copy of shared/script-segments/
// script-segments.ts, never a hand-maintained second copy. This test
// fails loudly (instead of silently testing stale code) whenever the
// generated copy drifts from the shared source: run
// `node scripts/sync-script-segments.mjs` from the repo root to resync.
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

describe('script-segments shared source', () => {
  it('is byte-identical to the shared source of truth', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('DO NOT EDIT this copy directly');
    expect(generated).toBe(shared);
  });
});
