import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from '../limits.js';

// The experiment tools validate locally with the same limits the web
// routes enforce (apps/web/lib/experiments/limits.ts, itself pinned to the
// database checks). Nothing is shared across the packages, so a one-sided
// edit would make the MCP reject what the route accepts. Change both sides.
const here = dirname(fileURLToPath(import.meta.url));
const webLimits = readFileSync(join(here, '..', '..', '..', 'web', 'lib', 'experiments', 'limits.ts'), 'utf8');

describe('experiment tool limits sync with apps/web/lib/experiments/limits.ts', () => {
  it.each([
    ['EXPERIMENT_TARGET_PAIRS_MIN', EXPERIMENT_TARGET_PAIRS_MIN],
    ['EXPERIMENT_TARGET_PAIRS_MAX', EXPERIMENT_TARGET_PAIRS_MAX],
    ['EXPERIMENT_NAME_MAX_LENGTH', EXPERIMENT_NAME_MAX_LENGTH],
    ['EXPERIMENT_VARIANT_NAME_MAX_LENGTH', EXPERIMENT_VARIANT_NAME_MAX_LENGTH],
    ['EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH', EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH],
  ])('%s matches', (name, value) => {
    expect(webLimits).toContain(`export const ${name} = ${value};`);
  });

  it('uses the same variant slug pattern', () => {
    expect(webLimits).toContain(`export const EXPERIMENT_VARIANT_ID_PATTERN = ${EXPERIMENT_VARIANT_ID_PATTERN.toString()};`);
  });
});
