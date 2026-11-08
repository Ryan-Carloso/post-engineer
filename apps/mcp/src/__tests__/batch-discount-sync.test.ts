import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BATCH_FREE_EVERY,
  BATCH_KEY_MAX_LENGTH,
  BATCH_KEY_PATTERN,
  BATCH_WINDOW_MINUTES,
  MAX_BATCH_VIDEOS,
} from '../limits.js';

//---------------
// The MCP batch tool mirrors the web batch discount rules (issue #487).
// Nothing shares a module across the two apps, so each literal is pinned to
// its web source here.
//---------------

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const rules = readFileSync(join(root, 'apps/web/lib/billing/batch-discount.ts'), 'utf8');
const route = readFileSync(join(root, 'apps/web/app/api/videos/batch-discount/route.ts'), 'utf8');

describe('batch discount limits stay in sync with the web', () => {
  it('mirrors MAX_BATCH_VIDEOS, BATCH_FREE_EVERY and the batch window', () => {
    expect(rules).toContain(`export const MAX_BATCH_VIDEOS = ${MAX_BATCH_VIDEOS};`);
    expect(rules).toContain(`export const BATCH_FREE_EVERY = ${BATCH_FREE_EVERY};`);
    expect(rules).toContain(`export const BATCH_WINDOW_MS = ${BATCH_WINDOW_MINUTES} * 60 * 1000;`);
  });

  it('mirrors the batchKey rule of the route', () => {
    expect(route).toContain(`.max(${BATCH_KEY_MAX_LENGTH})`);
    expect(route).toContain(`.regex(${BATCH_KEY_PATTERN.toString()},`);
  });
});
