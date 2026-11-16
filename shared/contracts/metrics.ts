//---------------
// metrics — the GET /api/metrics + GET /api/metrics/retention-curve
// contract, shared by the web routes and the MCP insights tools.
//
// The query parsing (parseMetricsQuery / parseRetentionCurveQuery) lives
// here, not in the routes: the MCP tools validate their arguments locally
// against the same rules, so a one-sided edit would make the MCP reject
// what the route accepts (or forward what it rejects). The route keeps
// the same 400 messages — the parsers moved verbatim out of
// apps/web/lib/metrics/metrics-query.ts and
// apps/web/app/api/metrics/retention-curve/route.ts.
//---------------

import { z } from 'zod';
import { defineEndpoint } from './endpoint.js';
import { METRICS_WINDOWS, type MetricsWindow } from './experiments.js';

// The window values live in the experiments contract (its results read
// takes the same ?window=); re-exported so the metrics query contract
// is the one place the MCP and the web read them from.
export { METRICS_WINDOWS };

// Null-filter sentinel. Not a plain word: script angles are unvalidated
// engine-generated text, so a literal like 'none' could be a real angle
// and would become unfilterable (selecting it would filter for null rows
// instead). Persona ids are uuids, so the sentinel is safe for them too.
export const METRICS_NONE = '^@none';

export const METRICS_FILTER_MAX_LENGTH = 200;

/** The networks a metrics row can belong to. Mirrors
 * apps/web/lib/providers/registry.ts (SOCIAL_PROVIDERS). */
export const SOCIAL_PROVIDERS = [
  'youtube',
  'instagram',
  'bluesky',
  'linkedin',
  'threads',
  'facebook',
  'pinterest',
  '3speak',
  'rumble',
  'fanvue',
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** YouTube video id (11 chars, base64url). Mirrors
 * apps/web/lib/youtube-analytics.ts (VIDEO_ID). */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

// post_metrics.analytics_status (migration 039 check, pinned by a sync test).
export const ANALYTICS_STATUSES = ['ok', 'scope_missing', 'not_owned', 'no_data'] as const;
export type AnalyticsStatus = (typeof ANALYTICS_STATUSES)[number];

export function isAnalyticsStatus(value: unknown): value is AnalyticsStatus {
  return typeof value === 'string' && (ANALYTICS_STATUSES as readonly string[]).includes(value);
}

// Coverage reasons (issue #525): why a published video has no snapshot
// for the selected window. pending = the window has not opened yet;
// retrying = the window is open and the collector keeps trying; missed =
// the window closed while collection kept failing; no-target = the window
// closed and the collector finished the post without ever seeing this
// video (it was published late, after the post was marked done);
// publish-failed = the publish outcome is 'failed', so there is no video
// id to measure.
export const COVERAGE_REASONS = ['pending', 'retrying', 'missed', 'no-target', 'publish-failed'] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

export function isCoverageReason(value: unknown): value is CoverageReason {
  return typeof value === 'string' && (COVERAGE_REASONS as readonly string[]).includes(value);
}

export function isMetricsWindow(value: unknown): value is MetricsWindow {
  return typeof value === 'string' && (METRICS_WINDOWS as readonly string[]).includes(value);
}

// Exported for the metrics route, which validates stored API-key
// persona ids with the same pattern before interpolating them into a
// PostgREST filter string.
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

//---------------
// parseMetricsQuery — strict: unknown, duplicate, empty, over-length or
// malformed params are rejected (400), never ignored or coerced.
//---------------
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

//---------------
// metricsSearchParams — the inverse, for the client fetch.
//---------------
export function metricsSearchParams(query: MetricsQuery): URLSearchParams {
  const params = new URLSearchParams({ window: query.window });
  if (query.personaId !== null) params.set('persona', query.personaId);
  if (query.accountId !== null) params.set('account', query.accountId);
  if (query.provider !== null) params.set('provider', query.provider);
  if (query.angle !== null) params.set('angle', query.angle);
  return params;
}

/** `?account=&video=` for the retention-curve read: each exactly once,
 * a non-empty account within the filter length, a YouTube video id. */
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

//---------------
// Query params as the routes receive them (raw strings; the parsers
// above are the validators). The endpoints declare them so the MCP
// client and the route share one shape.
//---------------
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

//---------------
// Response views, mirroring apps/web/lib/metrics/metrics-query.ts
// (MetricsRowView / CoverageItem) and apps/web/lib/youtube-analytics.ts
// (RetentionPoint). The MCP reads these rows; app field names are the
// contract one rename away from breaking both typechecks.
//---------------
export const MetricsRowSchema = z.object({
  postId: z.string(),
  personaId: z.string().nullable(),
  provider: z.enum(SOCIAL_PROVIDERS),
  accountId: z.string(),
  externalId: z.string(),
  scriptAngle: z.string().nullable(),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  saves: z.number().nullable(),
  // YouTube Analytics (own videos only); null on other providers or when
  // not collected. analyticsStatus 'scope_missing' = reconnect YouTube.
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
  // Null for publish-failed items: a failed publish records no video id.
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
  // The newest snapshot in the response: the page dates its data by it.
  asOf: z.string().nullable(),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

export const RetentionPointSchema = z.object({
  // elapsedVideoTimeRatio: exclusive end of the interval, 0.01..1.0.
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

//---------------
// Endpoints.
//---------------
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
