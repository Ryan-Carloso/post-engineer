import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BATCH_FREE_EVERY,
  BATCH_KEY_MAX_LENGTH,
  BATCH_KEY_PATTERN,
  BATCH_WINDOW_MINUTES,
  MAX_BATCH_VIDEOS,
} from '../limits.js';

const root = findRepoRoot(import.meta.url);
const rules = readFileSync(join(root, 'apps/web/lib/billing/batch-discount.ts'), 'utf8');
const contract = readFileSync(join(root, 'shared/contracts/videos.ts'), 'utf8');

describe('batch discount limits stay in sync with the web', () => {
  it('mirrors MAX_BATCH_VIDEOS, BATCH_FREE_EVERY and the batch window', () => {
    expect(MAX_BATCH_VIDEOS).toBe(12);
    expect(contract).toContain('export const MAX_BATCH_VIDEOS = 12;');
    expect(rules).toContain(`export const BATCH_FREE_EVERY = ${BATCH_FREE_EVERY};`);
    expect(rules).toContain(`export const BATCH_WINDOW_MS = ${BATCH_WINDOW_MINUTES} * 60 * 1000;`);
  });

  it('mirrors the batchKey rule of the route', () => {
    expect(BATCH_KEY_MAX_LENGTH).toBe(100);
    expect(BATCH_KEY_PATTERN).toEqual(/^[A-Za-z0-9_-]+$/);
    expect(contract).toContain('.max(BATCH_KEY_MAX_LENGTH)');
    expect(contract).toContain('.regex(BATCH_KEY_PATTERN,');
    expect(contract).toContain('export const BATCH_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;');
  });
});
