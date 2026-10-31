import type { PostEngineerClient } from './client.js';

//---------------
// Unified post detail (GET /api/posts/[id], issue #208) and per-video
// metrics (GET /api/metrics) — HTTP calls.
//
// Standalone functions (not client methods) because client.ts is
// grandfathered over the 500-line cap and may not grow.
//---------------

export interface PostMetricsQuery {
  window: '24h' | '7d';
  persona?: string;
  account?: string;
  provider?: string;
  angle?: string;
}

export async function getPost(client: PostEngineerClient, id: string): Promise<unknown> {
  return client.request(
    `/api/posts/${encodeURIComponent(id)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get post',
  );
}

export async function getPostMetrics(
  client: PostEngineerClient,
  query: PostMetricsQuery,
): Promise<unknown> {
  // Same parameter names as the route's parseMetricsQuery; omitted filters
  // are not sent (the route rejects empty parameters).
  const params = new URLSearchParams({ window: query.window });
  for (const key of ['persona', 'account', 'provider', 'angle'] as const) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  return client.request(
    `/api/metrics?${params.toString()}`,
    { method: 'GET', headers: client.getHeaders() },
    'get post metrics',
  );
}

export interface ScoreDraftInput {
  draft: string;
  provider?: string;
  personaId?: string;
}

export async function scoreDraft(
  client: PostEngineerClient,
  input: ScoreDraftInput,
): Promise<unknown> {
  // Same parameter names as the route's body; omitted optionals are not
  // sent (the route rejects empty parameters).
  const body: Record<string, unknown> = { draft: input.draft };
  if (input.provider !== undefined) body.provider = input.provider;
  if (input.personaId !== undefined) body.personaId = input.personaId;
  return client.request(
    '/api/videos/score-draft',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'score draft',
  );
}
