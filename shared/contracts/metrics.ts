import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';
import { SOCIAL_PROVIDERS, isSocialProvider, type SocialProvider } from './providers.js';

export const METRICS_WINDOWS = ['24h', '7d', '28d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];

export const METRICS_NONE = '^@none';

export const METRICS_FILTER_MAX_LENGTH = 200;


export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const ANALYTICS_STATUSES = ['ok', 'scope_missing', 'not_owned', 'no_data'] as const;
export type AnalyticsStatus = (typeof ANALYTICS_STATUSES)[number];

export function isAnalyticsStatus(value: unknown): value is AnalyticsStatus {
  return typeof value === 'string' && (ANALYTICS_STATUSES as readonly string[]).includes(value);
}

export const COVERAGE_REASONS = ['pending', 'retrying', 'missed', 'no-target', 'publish-failed'] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

export function isCoverageReason(value: unknown): value is CoverageReason {
  return typeof value === 'string' && (COVERAGE_REASONS as readonly string[]).includes(value);
}

export function isMetricsWindow(value: unknown): value is MetricsWindow {
  return typeof value === 'string' && (METRICS_WINDOWS as readonly string[]).includes(value);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KNOWN_PARAMS = new Set(['window', 'persona', 'account', 'provider', 'angle']);

export interface MetricsQuery {
  window: MetricsWindow;
  personaId: string | null;
  accountId: string | null;
  provider: SocialProvider | null;
  angle: string | null;
}

type MetricsParseResult = { ok: true; query: MetricsQuery } | { ok: false; error: string };

function readOptional(params: URLSearchParams, key: string): string | null | { error: string } {
  const all = params.getAll(key);
  if (all.length === 0) return null;
  if (all.length > 1) return { error: `Duplicate ${key} parameter.` };
  const value = all[0];
  if (value === '') return { error: `Empty ${key} parameter.` };
  if (value.length > METRICS_FILTER_MAX_LENGTH) return { error: `${key} is too long.` };
  return value;
}

export function parseMetricsQuery(params: URLSearchParams): MetricsParseResult {
  for (const key of params.keys()) {
    if (!KNOWN_PARAMS.has(key)) return { ok: false, error: `Unknown parameter: ${key}.` };
  }
  const window = readOptional(params, 'window');
  const persona = readOptional(params, 'persona');
  const account = readOptional(params, 'account');
  const provider = readOptional(params, 'provider');
  const angle = readOptional(params, 'angle');
  for (const value of [window, persona, account, provider, angle]) {
    if (typeof value === 'object' && value !== null) return { ok: false, error: value.error };
  }
  if (!isMetricsWindow(window)) return { ok: false, error: 'window must be 24h, 7d or 28d.' };
  if (typeof persona === 'string' && persona !== METRICS_NONE && !UUID.test(persona)) {
    return { ok: false, error: `persona must be a uuid or ${METRICS_NONE}.` };
  }
  if (typeof provider === 'string' && !isSocialProvider(provider)) {
    return { ok: false, error: 'Unknown provider.' };
  }
  return {
    ok: true,
    query: {
      window,
      personaId: typeof persona === 'string' ? persona : null,
      accountId: typeof account === 'string' ? account : null,
      provider: typeof provider === 'string' && isSocialProvider(provider) ? provider : null,
      angle: typeof angle === 'string' ? angle : null,
    },
  };
}

export function metricsSearchParams(query: MetricsQuery): URLSearchParams {
  const params = new URLSearchParams({ window: query.window });
  if (query.personaId !== null) params.set('persona', query.personaId);
  if (query.accountId !== null) params.set('account', query.accountId);
  if (query.provider !== null) params.set('provider', query.provider);
  if (query.angle !== null) params.set('angle', query.angle);
  return params;
}

export function parseRetentionCurveQuery(
  params: URLSearchParams,
): { account: string; video: string } | { error: string } {
  for (const key of params.keys()) {
    if (key !== 'account' && key !== 'video') return { error: `Unknown parameter: ${key}.` };
  }
  const account = params.getAll('account');
  const video = params.getAll('video');
  if (account.length !== 1 || video.length !== 1) return { error: 'account and video are each required once.' };
  if (account[0] === '' || account[0].length > METRICS_FILTER_MAX_LENGTH) return { error: 'Invalid account.' };
  if (!YOUTUBE_VIDEO_ID.test(video[0])) return { error: 'Invalid video.' };
  return { account: account[0], video: video[0] };
}

export const MetricsQueryParamsSchema = z.strictObject({
  window: z.string().optional(),
  persona: z.string().optional(),
  account: z.string().optional(),
  provider: z.string().optional(),
  angle: z.string().optional(),
});

export const RetentionCurveQuerySchema = z.strictObject({
  account: z.string(),
  video: z.string(),
});

export const MetricsRowSchema = z.object({
  postId: z.string(),
  personaId: z.string().nullable(),
  provider: z.enum(SOCIAL_PROVIDERS),
  accountId: z.string(),
  externalId: z.string(),
  scriptAngle: z.string().nullable(),
  publishedAt: z.string(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  saves: z.number().nullable(),
  analyticsViews: z.number().nullable(),
  engagedViews: z.number().nullable(),
  stayedToWatchPct: z.number().nullable(),
  averageViewDurationSeconds: z.number().nullable(),
  averageViewPercentage: z.number().nullable(),
  contentType: z.string().nullable(),
  analyticsStatus: z.enum(ANALYTICS_STATUSES).nullable(),
  provisional: z.boolean(),
  collectedAt: z.string(),
});
export type MetricsRowView = z.infer<typeof MetricsRowSchema>;

export const CoverageItemSchema = z.object({
  postId: z.string(),
  personaId: z.string().nullable(),
  provider: z.enum(SOCIAL_PROVIDERS),
  accountId: z.string(),
  externalId: z.string().nullable(),
  scriptAngle: z.string().nullable(),
  reason: z.enum(COVERAGE_REASONS),
  publishedAt: z.string(),
  windowOpensAt: z.string(),
  windowClosesAt: z.string(),
});
export type CoverageItem = z.infer<typeof CoverageItemSchema>;

export const MetricsResponseSchema = z.object({
  success: z.literal(true),
  rows: z.array(MetricsRowSchema),
  truncated: z.boolean(),
  coverage: z.array(CoverageItemSchema),
  coverageTruncated: z.boolean(),
  asOf: z.string().nullable(),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const RetentionPointSchema = z.object({
  ratio: z.number(),
  audienceWatchRatio: z.number(),
  relativeRetentionPerformance: z.number().nullable(),
});
export type RetentionPoint = z.infer<typeof RetentionPointSchema>;

export const RetentionCurveResponseSchema = z.object({
  success: z.literal(true),
  points: z.array(RetentionPointSchema),
  startDate: z.string(),
  endDate: z.string(),
  provisional: z.boolean(),
});
export type RetentionCurveResponse = z.infer<typeof RetentionCurveResponseSchema>;

export const listMetrics = defineEndpoint({
  method: 'GET',
  path: '/api/metrics',
  query: MetricsQueryParamsSchema,
  response: MetricsResponseSchema,
});

export const getRetentionCurve = defineEndpoint({
  method: 'GET',
  path: '/api/metrics/retention-curve',
  query: RetentionCurveQuerySchema,
  response: RetentionCurveResponseSchema,
});
