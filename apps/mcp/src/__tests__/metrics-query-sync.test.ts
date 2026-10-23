import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  METRICS_FILTER_MAX_LENGTH,
  METRICS_NONE,
  METRICS_PROVIDERS,
  METRICS_WINDOWS,
} from '../limits.js';

// get_post_metrics validates its arguments locally with the same contract
// GET /api/metrics enforces (apps/web/lib/metrics/metrics-query.ts) and the
// provider list from apps/web/lib/providers/registry.ts. Nothing is shared
// across the two packages, so a one-sided edit would make the MCP reject
// what the route accepts (or forward what it rejects). Change both sides
// together.
const here = dirname(fileURLToPath(import.meta.url));
const webLib = join(here, '..', '..', '..', 'web', 'lib');
const metricsQuery = readFileSync(join(webLib, 'metrics', 'metrics-query.ts'), 'utf8');
const registry = readFileSync(join(webLib, 'providers', 'registry.ts'), 'utf8');

describe('get_post_metrics contract sync with GET /api/metrics', () => {
  it('uses the same filter max length', () => {
    expect(metricsQuery).toContain(
      `export const METRICS_FILTER_MAX_LENGTH = ${METRICS_FILTER_MAX_LENGTH};`,
    );
  });

  it('uses the same null-filter sentinel', () => {
    expect(metricsQuery).toContain(`export const METRICS_NONE = '${METRICS_NONE}';`);
  });

  it('accepts the same windows', () => {
    const [first, second] = METRICS_WINDOWS;
    expect(METRICS_WINDOWS).toHaveLength(2);
    expect(metricsQuery).toContain(`if (window !== '${first}' && window !== '${second}')`);
  });

  it('accepts the same providers', () => {
    const list = METRICS_PROVIDERS.map((p) => `'${p}'`).join(', ');
    expect(registry).toContain(`export const SOCIAL_PROVIDERS = [${list}] as const;`);
  });
});
