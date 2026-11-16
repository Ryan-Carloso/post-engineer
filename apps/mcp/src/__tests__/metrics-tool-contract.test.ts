import { describe, expect, it } from 'vitest';
import {
  metricsSearchParams,
  parseMetricsQuery,
  parseRetentionCurveQuery,
  type SocialProvider,
} from '../contracts/metrics.js';
import { METRICS_NONE } from '../limits.js';
import { GetPostMetricsSchema, GetYouTubeRetentionCurveSchema } from '../tools-posts.js';

//---------------
// metrics tool schemas vs the shared contract — the MCP tools validate
// their arguments locally with the same rules the routes enforce
// (parseMetricsQuery / parseRetentionCurveQuery in the contract). A
// one-sided edit would make the MCP reject what the route accepts (or
// forward what it rejects), so the two must agree on every case.
//
// Deliberate difference: the tool schemas do not reject unknown keys
// (the MCP framework only ever passes the advertised fields), while the
// route parsers reject unknown query params — that difference is
// route-side only and is covered by the web route tests.
//---------------

const PERSONA = '0b7c2c55-4a3e-4c55-9d7e-1f2a3b4c5d6e';

type MetricsCase = { args: Record<string, string>; accept: boolean };

const METRICS_CASES: MetricsCase[] = [
  { args: { window: '7d' }, accept: true },
  {
    args: { window: '24h', persona: PERSONA, account: 'UC-1', provider: 'youtube', angle: 'hot take' },
    accept: true,
  },
  { args: { window: '28d', persona: METRICS_NONE }, accept: true },
  { args: { window: '28d', angle: METRICS_NONE }, accept: true },
  { args: { window: '7d', angle: 'a'.repeat(200) }, accept: true },
  { args: { window: '30d' }, accept: false },
  { args: { window: '7d', persona: 'not-a-uuid' }, accept: false },
  { args: { window: '7d', provider: 'tiktok' }, accept: false },
  { args: { window: '7d', account: '' }, accept: false },
  { args: { window: '7d', angle: 'a'.repeat(201) }, accept: false },
];

function metricsParams(args: Record<string, string>): URLSearchParams {
  // The same mapping getPostMetrics does: tool field names are the route
  // parameter names, so the params are built straight from the args. The
  // cast only satisfies the type: reject cases carry an invalid provider
  // on purpose, and the contract must reject the runtime value.
  return metricsSearchParams({
    window: args.window as '24h' | '7d' | '28d',
    personaId: args.persona ?? null,
    accountId: args.account ?? null,
    provider: (args.provider ?? null) as SocialProvider | null,
    angle: args.angle ?? null,
  });
}

describe('get_post_metrics tool schema agrees with the shared contract', () => {
  it.each(METRICS_CASES)('tool and contract agree on $args', ({ args, accept }) => {
    expect(GetPostMetricsSchema.safeParse(args).success).toBe(accept);
    expect(parseMetricsQuery(metricsParams(args)).ok).toBe(accept);
  });

  it('a missing window is rejected by both', () => {
    expect(GetPostMetricsSchema.safeParse({}).success).toBe(false);
    expect(parseMetricsQuery(new URLSearchParams()).ok).toBe(false);
  });
});

type RetentionCase = { args: Record<string, string>; accept: boolean };

const RETENTION_CASES: RetentionCase[] = [
  { args: { account: 'UC1', video: 'abc-_9' }, accept: true },
  { args: { account: 'UC1', video: 'a'.repeat(64) }, accept: true },
  { args: { account: 'UC1', video: 'a'.repeat(65) }, accept: false },
  { args: { account: '', video: 'abc' }, accept: false },
  { args: { account: 'a'.repeat(201), video: 'abc' }, accept: false },
  { args: { account: 'UC1', video: 'a;b' }, accept: false },
];

describe('retention_curve tool schema agrees with the shared contract', () => {
  it.each(RETENTION_CASES)('tool and contract agree on $args', ({ args, accept }) => {
    expect(GetYouTubeRetentionCurveSchema.safeParse(args).success).toBe(accept);
    const parsed = parseRetentionCurveQuery(new URLSearchParams(args));
    expect('error' in parsed).toBe(!accept);
  });

  it('a missing video is rejected by both', () => {
    expect(GetYouTubeRetentionCurveSchema.safeParse({ account: 'UC1' }).success).toBe(false);
    const parsed = parseRetentionCurveQuery(new URLSearchParams({ account: 'UC1' }));
    expect('error' in parsed).toBe(true);
  });
});
