import { isSocialProvider, type SocialProvider } from '@/lib/providers/registry';
import type { MetricsWindow } from './post-metrics';

//---------------
// metrics-query — the GET /api/metrics contract, shared by the route and
// the dashboard. Dependency-free so the client can import it.
//
// Filters are optional and exact-match. METRICS_NONE selects the rows
// whose persona / angle is null (faceless posts, posts without an angle).
//---------------

export const METRICS_ROW_LIMIT = 500;
export const METRICS_FILTER_MAX_LENGTH = 200;
// Null-filter sentinel. Not a plain word: script angles are unvalidated
// engine-generated text, so a literal like 'none' could be a real angle
// and would become unfilterable (selecting it would filter for null rows
// instead). Persona ids are uuids, so the sentinel is safe for them too.
export const METRICS_NONE = '^@none';

export const METRICS_WINDOWS = ['24h', '7d', '28d'] as const satisfies readonly MetricsWindow[];

function isMetricsWindow(value: unknown): value is MetricsWindow {
  return typeof value === 'string' && (METRICS_WINDOWS as readonly string[]).includes(value);
}

// post_metrics.analytics_status (migration 039 check, pinned by a sync test).
export const ANALYTICS_STATUSES = ['ok', 'scope_missing', 'not_owned', 'no_data'] as const;
export type AnalyticsStatus = (typeof ANALYTICS_STATUSES)[number];

export function isAnalyticsStatus(value: unknown): value is AnalyticsStatus {
  return typeof value === 'string' && (ANALYTICS_STATUSES as readonly string[]).includes(value);
}

// YouTube Analytics data is provisional for ~48-72h: a snapshot whose range
// ends within this many days of its collection may still change.
export const ANALYTICS_PROVISIONAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

//---------------
// stayedToWatchPct — DERIVED, not a native API metric: engaged views /
// views * 100, one decimal. Null when either is unknown or views is 0
// (no views is "no signal", never 0%).
//---------------
export function stayedToWatchPct(engagedViews: number | null, views: number | null): number | null {
  if (engagedViews === null || views === null || views === 0) return null;
  return Math.round((engagedViews / views) * 1000) / 10;
}

// Postgres numeric arrives from PostgREST as a number or a decimal string.
export function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

//---------------
// isProvisional — the Analytics range ends less than
// ANALYTICS_PROVISIONAL_DAYS before the snapshot was collected. The '28d'
// window queries up to collection - 3 days, so its rows are final.
//---------------
export function isProvisional(endDate: string | null, collectedAt: string): boolean {
  if (endDate === null) return false;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const collected = Date.parse(`${collectedAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(collected)) return false;
  return end > collected - ANALYTICS_PROVISIONAL_DAYS * DAY_MS;
}

export interface MetricsQuery {
  window: MetricsWindow;
  personaId: string | null;
  accountId: string | null;
  provider: SocialProvider | null;
  angle: string | null;
}

export interface MetricsRowView {
  postId: string;
  personaId: string | null;
  provider: SocialProvider;
  accountId: string;
  externalId: string;
  scriptAngle: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  // YouTube Analytics (own videos only); null on other providers or when
  // not collected. analyticsStatus 'scope_missing' = reconnect YouTube.
  analyticsViews: number | null;
  engagedViews: number | null;
  stayedToWatchPct: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  contentType: string | null;
  analyticsStatus: AnalyticsStatus | null;
  provisional: boolean;
  collectedAt: string;
}

export interface MetricsResponse {
  success: true;
  rows: MetricsRowView[];
  truncated: boolean;
}

// Exported for the metrics route, which validates stored API-key
// persona ids with the same pattern before interpolating them into a
// PostgREST filter string.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_PARAMS = new Set(['window', 'persona', 'account', 'provider', 'angle']);

type ParseResult = { ok: true; query: MetricsQuery } | { ok: false; error: string };

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
export function parseMetricsQuery(params: URLSearchParams): ParseResult {
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
