//---------------
// Threads — API client to connect accounts (OAuth 2.0) and publish videos.
//
// Documentation (2026): https://developers.facebook.com/docs/threads
// Publishing is container-based: POST /{user}/threads with a public video_url,
// wait for the container to reach FINISHED, then POST /{user}/threads_publish.
// The long-lived token expires in 60 days (refreshed on reconnect).
//---------------

import { ThreadsError } from '@/lib/errors';

// The documented text ceiling; the scorer and the engine pin the same value.
export const THREADS_TEXT_MAX_CHARS = 500;
export const THREADS_VIDEO_MAX_BYTES = 1024 * 1024 * 1024; // 1GB

export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_insights'] as const;

const THREADS_AUTHORIZE_URL = 'https://threads.com/oauth/authorize';
const THREADS_API = 'https://graph.threads.com';
const THREADS_GRAPH = `${THREADS_API}/v1.0`;
const REQUEST_TIMEOUT_MS = 15_000;
const CONTAINER_POLL_INTERVAL_MS = 10_000;
const CONTAINER_POLL_MAX_ATTEMPTS = 30;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ThreadsError(`THREADS_ENV_MISSING: ${name} is not defined`, 500);
  }
  return value;
}

// Bodies are parsed defensively: a proxy can answer with HTML, and only
// Meta's own error.message is safe to surface (never the request URL, which
// would carry the access token).
async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function describeFailure(body: Record<string, unknown>, status: number): string {
  const error = body.error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  if (typeof body.error_message === 'string' && body.error_message !== '') return body.error_message;
  return `status ${status}`;
}

async function threadsFetch(code: string, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await readBody(response);
  if (!response.ok) {
    throw new ThreadsError(`${code}: ${describeFailure(body, response.status)}`, response.status);
  }
  return body;
}

function formPost(params: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  };
}

function requireId(code: string, body: Record<string, unknown>): string {
  if (typeof body.id !== 'string' || body.id === '') {
    throw new ThreadsError(`${code}: missing id`, 502);
  }
  return body.id;
}

//---------------
// buildThreadsAuthorizationUrl — OAuth consent URL
//---------------
// Threads and Instagram are products on one Meta app. The App ID and App
// Secret are INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET; only the redirect
// URI is Threads-specific.
export function buildThreadsAuthorizationUrl(state: string, redirectUriOverride?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('INSTAGRAM_CLIENT_ID'),
    redirect_uri: redirectUriOverride ?? requireEnv('THREADS_REDIRECT_URI'),
    state,
    scope: THREADS_SCOPES.join(','),
  });
  return `${THREADS_AUTHORIZE_URL}?${params.toString()}`;
}

//---------------
// exchangeThreadsCodeForToken — code → short-lived token (1h) → long-lived
// token (60 days). The short-lived token is never stored.
//---------------
export interface ThreadsToken {
  access_token: string;
  expires_in: number;
}

export async function exchangeThreadsCodeForToken(code: string, redirectUriOverride?: string): Promise<ThreadsToken> {
  const clientSecret = requireEnv('INSTAGRAM_CLIENT_SECRET');
  const shortLived = await threadsFetch(
    'THREADS_TOKEN_FAILED',
    `${THREADS_API}/oauth/access_token`,
    formPost({
      client_id: requireEnv('INSTAGRAM_CLIENT_ID'),
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriOverride ?? requireEnv('THREADS_REDIRECT_URI'),
      code,
    }),
  );
  if (typeof shortLived.access_token !== 'string' || shortLived.access_token === '') {
    throw new ThreadsError('THREADS_TOKEN_FAILED: missing access_token', 502);
  }
  const params = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: clientSecret,
    access_token: shortLived.access_token,
  });
  const longLived = await threadsFetch('THREADS_TOKEN_FAILED', `${THREADS_API}/access_token?${params.toString()}`);
  if (typeof longLived.access_token !== 'string' || longLived.access_token === '') {
    throw new ThreadsError('THREADS_TOKEN_FAILED: missing long-lived access_token', 502);
  }
  return {
    access_token: longLived.access_token,
    expires_in: typeof longLived.expires_in === 'number' ? longLived.expires_in : 5_184_000,
  };
}

//---------------
// fetchThreadsProfile — the profile the token belongs to
//---------------
export interface ThreadsProfile {
  id: string;
  username: string | null;
  profilePictureUrl: string | null;
}

export async function fetchThreadsProfile(accessToken: string): Promise<ThreadsProfile> {
  const params = new URLSearchParams({
    fields: 'id,username,threads_profile_picture_url',
    access_token: accessToken,
  });
  const body = await threadsFetch('THREADS_PROFILE_FAILED', `${THREADS_GRAPH}/me?${params.toString()}`);
  return {
    id: requireId('THREADS_PROFILE_FAILED', body),
    username: typeof body.username === 'string' ? body.username : null,
    profilePictureUrl:
      typeof body.threads_profile_picture_url === 'string' ? body.threads_profile_picture_url : null,
  };
}

//---------------
// publishThreadsVideo — container → wait until FINISHED → publish. The sleep
// is injected so tests never wait on the real poll interval. The permalink
// read is best-effort: the post is already live when it runs, so its failure
// must not turn a published post into a failed one.
//---------------
export interface ThreadsPublishResult {
  postId: string;
  permalink: string | null;
}

export interface PublishThreadsVideoInput {
  accessToken: string;
  userId: string;
  videoUrl: string;
  text: string;
  sleep?: (ms: number) => Promise<void>;
  onPermalinkError?: (error: unknown) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForContainer(
  containerId: string,
  accessToken: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const params = new URLSearchParams({ fields: 'status,error_message', access_token: accessToken });
  for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt += 1) {
    const body = await threadsFetch(
      'THREADS_CONTAINER_FAILED',
      `${THREADS_GRAPH}/${encodeURIComponent(containerId)}?${params.toString()}`,
    );
    if (body.status === 'FINISHED') return;
    if (body.status === 'ERROR' || body.status === 'EXPIRED') {
      throw new ThreadsError(`THREADS_CONTAINER_FAILED: ${describeFailure(body, 502)}`, 502);
    }
    await sleep(CONTAINER_POLL_INTERVAL_MS);
  }
  throw new ThreadsError('THREADS_CONTAINER_TIMEOUT: container did not finish processing', 504);
}

export async function publishThreadsVideo(input: PublishThreadsVideoInput): Promise<ThreadsPublishResult> {
  const { accessToken, userId, videoUrl, text } = input;
  const graphUser = `${THREADS_GRAPH}/${encodeURIComponent(userId)}`;
  const container = await threadsFetch(
    'THREADS_CONTAINER_FAILED',
    `${graphUser}/threads`,
    formPost({ media_type: 'VIDEO', video_url: videoUrl, text, access_token: accessToken }),
  );
  const containerId = requireId('THREADS_CONTAINER_FAILED', container);
  await waitForContainer(containerId, accessToken, input.sleep ?? realSleep);
  const published = await threadsFetch(
    'THREADS_PUBLISH_FAILED',
    `${graphUser}/threads_publish`,
    formPost({ creation_id: containerId, access_token: accessToken }),
  );
  const postId = requireId('THREADS_PUBLISH_FAILED', published);

  let permalink: string | null = null;
  try {
    const params = new URLSearchParams({ fields: 'permalink', access_token: accessToken });
    const media = await threadsFetch(
      'THREADS_PERMALINK_FAILED',
      `${THREADS_GRAPH}/${encodeURIComponent(postId)}?${params.toString()}`,
    );
    permalink = typeof media.permalink === 'string' ? media.permalink : null;
  } catch (error) {
    input.onPermalinkError?.(error);
  }
  return { postId, permalink };
}

//---------------
// getThreadsInsights — metric name → value for one post. Throws on HTTP
// errors so the metrics collector logs and retries on the next run.
//---------------
export async function getThreadsInsights(accessToken: string, mediaId: string): Promise<Record<string, number>> {
  const params = new URLSearchParams({ metric: 'views,likes,replies', access_token: accessToken });
  const body = await threadsFetch(
    'THREADS_INSIGHTS_FAILED',
    `${THREADS_GRAPH}/${encodeURIComponent(mediaId)}/insights?${params.toString()}`,
  );
  const insights: Record<string, number> = {};
  for (const entry of Array.isArray(body.data) ? body.data : []) {
    const record = entry as { name?: unknown; values?: Array<{ value?: unknown }> };
    const value = record.values?.[0]?.value;
    if (typeof record.name === 'string' && typeof value === 'number') insights[record.name] = value;
  }
  return insights;
}
