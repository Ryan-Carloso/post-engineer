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
  if (window !== '24h' && window !== '7d') return { ok: false, error: 'window must be 24h or 7d.' };
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
