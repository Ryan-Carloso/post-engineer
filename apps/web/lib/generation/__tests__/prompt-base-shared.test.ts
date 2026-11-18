/**
 * @vitest-environment node
 */

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
    expect(linked).toBe(shared);
  });

  it('exports the same values as the shared source at runtime', async () => {
    const root = findRepoRoot(import.meta.url);
    const sharedModule: Record<string, unknown> = await import(/* @vite-ignore */ join(root, SHARED_RELATIVE));
    expect({ ...sharedModule }).toEqual({ ...linkedModule });
    expect(linkedModule.SHARED_PROMPT_BASE.length).toBeGreaterThan(0);
  });
});
