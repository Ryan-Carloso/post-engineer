// prompt-base shared-source guard: apps/mcp/src/prompt-base.ts must
// be a symlink to shared/prompt-base/prompt-base.ts, never a
// hand-maintained second copy and never a generated copy. This test
// fails loudly if the symlink is replaced by a real file, even one
// with identical content, because a real file can drift silently.
import { describe, expect, it } from 'vitest';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
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
import * as generatedModule from '../prompt-base.js';

const SHARED_RELATIVE = join('shared', 'prompt-base', 'prompt-base.ts');
const GENERATED_RELATIVE = join('apps', 'mcp', 'src', 'prompt-base.ts');

describe('prompt-base shared source', () => {
  it('is a symlink to the shared source of truth, not a copy', () => {
    const root = findRepoRoot(import.meta.url);
    expect(lstatSync(join(root, GENERATED_RELATIVE)).isSymbolicLink()).toBe(true);
  });

  it('is byte-identical to the shared source of truth', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const generated = readFileSync(join(root, GENERATED_RELATIVE), 'utf8');
    expect(shared).toContain('DO NOT EDIT this copy directly');
    expect(generated).toBe(shared);
  });

  it('exports the same values as the shared source at runtime', async () => {
    const root = findRepoRoot(import.meta.url);
    const sharedModule: Record<string, unknown> = await import(/* @vite-ignore */ join(root, SHARED_RELATIVE));
    expect({ ...sharedModule }).toEqual({ ...generatedModule });
    expect(generatedModule.SHARED_PROMPT_BASE.length).toBeGreaterThan(0);
  });
});
