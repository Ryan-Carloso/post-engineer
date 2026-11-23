import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import {
  getLast24hMetrics as getLast24hMetricsContract,
  getRetentionCurve as getRetentionCurveContract,
  last24hSearchParams,
  listMetrics as listMetricsContract,
  metricsSearchParams,
} from './contracts/metrics.js';
import type { SocialProvider } from './contracts/providers.js';
import { getPost as getPostContract } from './contracts/posts.js';
import { listPostsInRange as listPostsInRangeContract } from './contracts/schedule.js';
import { scoreDraft as scoreDraftContract } from './contracts/videos.js';
import type { ResponseOf } from './contracts/endpoint.js';

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

export interface Last24hMetricsQuery {
  persona?: string;
  account?: string;
  provider?: SocialProvider;
}

export async function getLast24hMetrics(
  client: PostEngineerClient,
  query: Last24hMetricsQuery,
): Promise<ResponseOf<typeof getLast24hMetricsContract>> {
  const params = last24hSearchParams({
    personaId: query.persona ?? null,
    accountId: query.account ?? null,
    provider: query.provider ?? null,
  });
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  const raw = await client.request(
    `/api/metrics/last-24h${suffix}`,
    { method: 'GET', headers: client.getHeaders() },
    'get last 24 hours metrics',
  );
  return parseContractResponse(getLast24hMetricsContract, raw);
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
