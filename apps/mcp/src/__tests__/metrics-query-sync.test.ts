import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_PROVIDERS,
  METRICS_WINDOWS,
  YOUTUBE_VIDEO_ID,
} from '../limits.js';

const here = dirname(fileURLToPath(import.meta.url));
const webLib = join(here, '..', '..', '..', 'web', 'lib');
const metricsQuery = readFileSync(join(webLib, 'metrics', 'metrics-query.ts'), 'utf8');
const contract = readFileSync(join(here, '..', '..', '..', '..', 'shared', 'contracts', 'metrics.ts'), 'utf8');
const registry = readFileSync(join(webLib, 'providers', 'registry.ts'), 'utf8');
const youtubeAnalytics = readFileSync(join(webLib, 'youtube-analytics.ts'), 'utf8');

describe('get_post_metrics contract sync with GET /api/metrics', () => {
  it('uses the same filter max length', () => {
    expect(contract).toContain(`export const METRICS_FILTER_MAX_LENGTH = ${METRICS_FILTER_MAX_LENGTH};`);
  });

  it('uses the same null-filter sentinel', () => {
    expect(contract).toContain(`export const METRICS_NONE = '${METRICS_NONE}';`);
  });

  it('accepts the same windows', () => {
    const list = METRICS_WINDOWS.map((w) => `'${w}'`).join(', ');
    expect(metricsQuery).toContain(`export const METRICS_WINDOWS = [${list}] as const`);
    expect(contract).toContain('if (!isMetricsWindow(window))');
  });

  it('validates retention-curve video ids with the same pattern', () => {
    expect(youtubeAnalytics).toContain(`const VIDEO_ID = /${YOUTUBE_VIDEO_ID.source}/;`);
  });

  it('accepts the same providers: both read the one shared list', () => {
    expect(METRICS_PROVIDERS).toContain('fanvue');
    expect(registry).toContain("import { SOCIAL_PROVIDERS, isSocialProvider, type SocialProvider } from '@/lib/contracts/providers';");
  });
});
