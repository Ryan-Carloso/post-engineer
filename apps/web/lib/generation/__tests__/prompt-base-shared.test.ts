/**
 * @vitest-environment node
 */

// prompt-base shared-source guard: apps/web/lib/generation/prompt-base.ts
// must be a symlink to shared/prompt-base/prompt-base.ts, never a
// hand-maintained second copy and never a generated copy. A direct
// import is not an option: tsc rootDir is apps/web (TS6059), and
// Stryker's sandbox copies only the app root, so a direct import of
// the shared file breaks mutation testing. The symlink is dereferenced
// by tsc, webpack, vitest, and Stryker, so every tool sees the shared
// content as a local file. This test fails loudly if the symlink is
// replaced by a real file, even one with identical content, because a
// real file can drift silently.
import { describe, expect, it } from 'vitest';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import * as linkedModule from '../prompt-base';

const SHARED_RELATIVE = join('shared', 'prompt-base', 'prompt-base.ts');
const LINKED_RELATIVE = join('apps', 'web', 'lib', 'generation', 'prompt-base.ts');

describe('prompt-base shared source', () => {
  it('is a symlink to the shared source of truth, not a copy', () => {
    const root = findRepoRoot(import.meta.url);
    expect(lstatSync(join(root, LINKED_RELATIVE)).isSymbolicLink()).toBe(true);
  });

  it('is byte-identical to the shared source of truth', () => {
    const root = findRepoRoot(import.meta.url);
    const shared = readFileSync(join(root, SHARED_RELATIVE), 'utf8');
    const linked = readFileSync(join(root, LINKED_RELATIVE), 'utf8');
    expect(shared).toContain('DO NOT EDIT this copy directly');
    expect(linked).toBe(shared);
  });

  it('exports the same values as the shared source at runtime', async () => {
    const root = findRepoRoot(import.meta.url);
    const sharedModule: Record<string, unknown> = await import(/* @vite-ignore */ join(root, SHARED_RELATIVE));
    expect({ ...sharedModule }).toEqual({ ...linkedModule });
    expect(linkedModule.SHARED_PROMPT_BASE.length).toBeGreaterThan(0);
  });
});
