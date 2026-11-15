import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  getRetentionCurve as getRetentionCurveContract,
  listMetrics as listMetricsContract,
  metricsSearchParams,
} from './contracts/metrics.js';
import type { SocialProvider } from './contracts/metrics.js';
import { getPost as getPostContract } from './contracts/posts.js';
import { listPostsInRange as listPostsInRangeContract } from './contracts/schedule.js';
import { scoreDraft as scoreDraftContract } from './contracts/videos.js';
import type { ResponseOf } from './contracts/endpoint.js';

//---------------
// Unified post detail (GET /api/posts/[id], issue #208), per-video
// metrics (GET /api/metrics) and the YouTube retention curve
// (GET /api/metrics/retention-curve) — HTTP calls.
//
// Standalone functions (not client methods) because client.ts is
// grandfathered over the 500-line cap and may not grow.
//---------------

export interface PostMetricsQuery {
  window: '24h' | '7d' | '28d';
  persona?: string;
  account?: string;
  provider?: SocialProvider;
  angle?: string;
}

export async function getPost(client: PostEngineerClient, id: string): Promise<ResponseOf<typeof getPostContract>> {
  const raw = await client.request(
    `/api/posts/${encodeURIComponent(id)}`,
    { method: 'GET', headers: client.getHeaders() },
    'get post',
  );
  return parseContractResponse(getPostContract, raw);
}

export async function getPostMetrics(
  client: PostEngineerClient,
  query: PostMetricsQuery,
): Promise<ResponseOf<typeof listMetricsContract>> {
  // Same parameter names as the route's parseMetricsQuery; omitted filters
  // are not sent (the route rejects empty parameters).
  const params = metricsSearchParams({
    window: query.window,
    personaId: query.persona ?? null,
    accountId: query.account ?? null,
    provider: query.provider ?? null,
    angle: query.angle ?? null,
  });
  const raw = await client.request(
    `/api/metrics?${params.toString()}`,
    { method: 'GET', headers: client.getHeaders() },
    'get post metrics',
  );
  return parseContractResponse(listMetricsContract, raw);
}

export async function getYouTubeRetentionCurve(
  client: PostEngineerClient,
  query: { account: string; video: string },
): Promise<ResponseOf<typeof getRetentionCurveContract>> {
  const params = new URLSearchParams({ account: query.account, video: query.video });
  const raw = await client.request(
    `/api/metrics/retention-curve?${params.toString()}`,
    { method: 'GET', headers: client.getHeaders() },
    'get YouTube retention curve',
  );
  return parseContractResponse(getRetentionCurveContract, raw);
}

export interface ScoreDraftInput {
  draft: string;
  network?: string;
  personaId?: string;
  kind?: string;
}

export async function scoreDraft(
  client: PostEngineerClient,
  input: ScoreDraftInput,
): Promise<ResponseOf<typeof scoreDraftContract>> {
  // Same parameter names as the route's body; omitted optionals are not
  // sent (the route rejects empty parameters).
  const body: Record<string, unknown> = { draft: input.draft };
  if (input.network !== undefined) body.network = input.network;
  if (input.personaId !== undefined) body.personaId = input.personaId;
  if (input.kind !== undefined) body.kind = input.kind;
  const raw = await client.request(
    '/api/videos/score-draft',
    { method: 'POST', headers: client.getHeaders(), body: JSON.stringify(body) },
    'score draft',
  );
  return parseContractResponse(scoreDraftContract, raw);
}

// GET /api/schedule/status in range mode (?from=&to=): every post, any status,
// with slot_at in [from, to). limit is never sent: the route rejects it
// together with a range.
export async function listPostsInRange(
  client: PostEngineerClient,
  range: { from: string; to: string },
): Promise<ResponseOf<typeof listPostsInRangeContract>> {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  const raw = await client.request(
    `/api/schedule/status?${params.toString()}`,
    { method: 'GET', headers: client.getHeaders() },
    'list posts',
  );
  return parseContractResponse(listPostsInRangeContract, raw);
}
