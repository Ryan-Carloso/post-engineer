/**
 * @vitest-environment node
 */

// prompt-base shared-source guard: the web hub must import
// shared/prompt-base/prompt-base.ts directly — there must be no web
// copy of it at apps/web/lib/generation/prompt-base.ts anymore.
// This test fails loudly if a copy ever reappears, instead of letting
// the hub silently serve stale text.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  DAILY_NEWS_PROMPT,
  FULL_SETUP_PROMPT,
  GITHUB_PRS_PROMPT,
} from '@/app/recipes/prompts';
import * as sharedModule from '../../../../../shared/prompt-base/prompt-base';

const COPY_RELATIVE = join('apps', 'web', 'lib', 'generation', 'prompt-base.ts');

describe('prompt-base shared source', () => {
  it('has no web copy of the shared prompt base', () => {
    const root = findRepoRoot(import.meta.url);
    expect(existsSync(join(root, COPY_RELATIVE))).toBe(false);
  });

  it('serves the shared source at runtime, unchanged', () => {
    expect(sharedModule.SHARED_PROMPT_BASE.length).toBeGreaterThan(0);
    expect(DAILY_NEWS_PROMPT).toBe(sharedModule.DAILY_NEWS_PROMPT);
    expect(FULL_SETUP_PROMPT).toBe(sharedModule.FULL_SETUP_PROMPT);
    expect(GITHUB_PRS_PROMPT).toBe(sharedModule.GITHUB_PRS_PROMPT);
  });
});
