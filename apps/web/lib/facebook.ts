//---------------
// Facebook — API client to connect Facebook Pages (OAuth 2.0 via
// Facebook Login) and publish videos to them.
//
// Documentation (2026): https://developers.facebook.com/docs/facebook-login
// and https://developers.facebook.com/docs/graph-api/reference/page/videos
// Flow: dialog/oauth -> short-lived user token -> long-lived user token
// (fb_exchange_token) -> GET /me/accounts lists the Pages the user
// manages, each with its own Page access token. A Page token derived from
// a long-lived user token has no expiry of its own, so publishing uses the
// stored Page token directly and the account stores no expiry date.
// Publishing posts the video by URL (graph-video file_url), the same
// signed-URL pattern the Threads and Instagram handlers use.
//
// Secrets stay out of URLs: the app secret travels in a POST body and
// access tokens in the Authorization header, so neither can surface in a
// logged request URL.
//---------------

import { FacebookError } from '@/lib/errors';

// Facebook's documented feed-post ceiling; a video description rides the
// same field. lib/draft-scoring.ts and the engine pin the same value.
export const FACEBOOK_TEXT_MAX_CHARS = 63206;
export const FACEBOOK_VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4GB

export const FACEBOOK_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;

const FACEBOOK_API_VERSION = 'v23.0';
const FACEBOOK_DIALOG_URL = `https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`;
const FACEBOOK_GRAPH_ORIGIN = 'https://graph.facebook.com';
const FACEBOOK_GRAPH = `${FACEBOOK_GRAPH_ORIGIN}/${FACEBOOK_API_VERSION}`;
const FACEBOOK_GRAPH_VIDEO = `https://graph-video.facebook.com/${FACEBOOK_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 15_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new FacebookError(`FACEBOOK_ENV_MISSING: ${name} is not defined`, 500);
  }
  return value;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(body: JsonRecord, key: string): JsonRecord | null {
  const value = body[key];
  return isRecord(value) ? value : null;
}

function readOptionalString(body: JsonRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readOptionalCount(body: JsonRecord, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Only Meta's own error.message is surfaced, never the request itself.
function describeFailure(body: JsonRecord | null, status: number): string {
  const error = body === null ? null : readRecord(body, 'error');
  const message = error === null ? null : readOptionalString(error, 'message');
  return message ?? `status ${status}`;
}

//---------------
// facebookFetch — one Graph call. Non-2xx, a non-JSON body (a proxy can
// answer with HTML) and a non-object body are all failures; the error
// message is "CODE: detail" so callers and telemetry read a stable code.
//---------------
async function facebookFetch(code: string, url: string, init: RequestInit = {}): Promise<JsonRecord> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const parsed: unknown = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  if (!response.ok) {
    throw new FacebookError(`${code}: ${describeFailure(body, response.status)}`, response.status);
  }
  if (body === null) {
    throw new FacebookError(`${code}: invalid response body`, 502);
  }
  return body;
}

function bearer(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function formPost(params: Record<string, string>, accessToken?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
    },
    body: new URLSearchParams(params).toString(),
  };
}

function graphUrl(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${FACEBOOK_GRAPH}/${path}${query === '' ? '' : `?${query}`}`;
}

function requireAccessToken(code: string, body: JsonRecord): string {
  const token = readOptionalString(body, 'access_token');
  if (token === null) throw new FacebookError(`${code}: missing access_token`, 502);
  return token;
}

//---------------
// buildFacebookAuthorizationUrl — OAuth consent URL (Facebook Login for
// Pages). Facebook has its own app credentials (FACEBOOK_CLIENT_ID /
// FACEBOOK_CLIENT_SECRET), separate from the Instagram and Threads use
// cases of the Meta app.
//---------------
export function buildFacebookAuthorizationUrl(state: string, redirectUriOverride?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('FACEBOOK_CLIENT_ID'),
    redirect_uri: redirectUriOverride ?? requireEnv('FACEBOOK_REDIRECT_URI'),
    state,
    scope: FACEBOOK_SCOPES.join(','),
  });
  return `${FACEBOOK_DIALOG_URL}?${params.toString()}`;
}

//---------------
// exchangeFacebookCodeForToken — code -> short-lived user token (~1h) ->
// long-lived user token. Only the long-lived token is returned; the
// short-lived one is never stored. The user token itself is never stored
// either: only the Page tokens derived from it (fetchFacebookPages).
//---------------
export async function exchangeFacebookCodeForToken(
  code: string,
  redirectUriOverride?: string,
): Promise<string> {
  const clientId = requireEnv('FACEBOOK_CLIENT_ID');
  const clientSecret = requireEnv('FACEBOOK_CLIENT_SECRET');
  const shortLived = await facebookFetch(
    'FACEBOOK_TOKEN_FAILED',
    graphUrl('oauth/access_token'),
    formPost({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUriOverride ?? requireEnv('FACEBOOK_REDIRECT_URI'),
      code,
    }),
  );
  const longLived = await facebookFetch(
    'FACEBOOK_TOKEN_FAILED',
    graphUrl('oauth/access_token'),
    formPost({
      grant_type: 'fb_exchange_token',
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: requireAccessToken('FACEBOOK_TOKEN_FAILED', shortLived),
    }),
  );
  return requireAccessToken('FACEBOOK_TOKEN_FAILED', longLived);
}

//---------------
// FacebookPage — one Page the user manages, with the Page access token
// /me/accounts returns for it. Each Page becomes its own social account
// (providerAccountId = Page id), mirroring LinkedIn organizations.
//---------------
export interface FacebookPageProfile {
  id: string;
  name: string | null;
  category: string | null;
  pictureUrl: string | null;
  followersCount: number | null;
}

export interface FacebookPage extends FacebookPageProfile {
  pageAccessToken: string;
}

function readPicture(body: JsonRecord): string | null {
  const picture = readRecord(body, 'picture');
  const data = picture === null ? null : readRecord(picture, 'data');
  return data === null ? null : readOptionalString(data, 'url');
}

function readProfile(body: JsonRecord, id: string): FacebookPageProfile {
  return {
    id,
    name: readOptionalString(body, 'name'),
    category: readOptionalString(body, 'category'),
    pictureUrl: readPicture(body),
    followersCount: readOptionalCount(body, 'fan_count'),
  };
}

// Graph's own cursor URL, followed only when it stays on the Graph host.
function readNextPage(body: JsonRecord): string | null {
  const paging = readRecord(body, 'paging');
  const next = paging === null ? null : readOptionalString(paging, 'next');
  if (next === null) return null;
  try {
    return new URL(next).origin === FACEBOOK_GRAPH_ORIGIN ? next : null;
  } catch {
    return null;
  }
}

//---------------
// fetchFacebookPages — every Page the token owner manages, bounded:
// at most MAX_PAGE_LIST_PAGES Graph pages are followed, so a huge account
// cannot fan out forever. An entry without an id or Page token is skipped
// (the user did not grant that Page), never stored half-formed.
//---------------
export const MAX_PAGE_LIST_PAGES = 5;
const PROFILE_FIELDS = 'id,name,category,picture{url},fan_count';

export async function fetchFacebookPages(userAccessToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let nextUrl: string | null = graphUrl('me/accounts', { fields: `${PROFILE_FIELDS},access_token` });

  for (let index = 0; index < MAX_PAGE_LIST_PAGES && nextUrl !== null; index += 1) {
    const body: JsonRecord = await facebookFetch('FACEBOOK_PAGES_FAILED', nextUrl, bearer(userAccessToken));
    const entries: unknown[] = Array.isArray(body.data) ? body.data : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = readOptionalString(entry, 'id');
      const pageAccessToken = readOptionalString(entry, 'access_token');
      if (id === null || pageAccessToken === null) continue;
      pages.push({ ...readProfile(entry, id), pageAccessToken });
    }
    nextUrl = readNextPage(body);
  }
  return pages;
}

//---------------
// fetchFacebookPageProfile — fresh name/picture for one Page, read with
// its Page token (the account-profile resync).
//---------------
export async function fetchFacebookPageProfile(
  pageId: string,
  pageAccessToken: string,
): Promise<FacebookPageProfile> {
  const body = await facebookFetch(
    'FACEBOOK_PROFILE_FAILED',
    graphUrl(encodeURIComponent(pageId), { fields: PROFILE_FIELDS }),
    bearer(pageAccessToken),
  );
  const id = readOptionalString(body, 'id');
  if (id === null) throw new FacebookError('FACEBOOK_PROFILE_FAILED: missing id', 502);
  return readProfile(body, id);
}

//---------------
// publishFacebookVideo — posts the video to the Page by URL and returns
// the video id plus its permalink. The permalink read is best-effort: the
// video is already live when it runs, so its failure must not turn a
// published post into a failed one (same contract as Threads).
//---------------
export interface FacebookPublishResult {
  postId: string;
  permalink: string | null;
}

export interface PublishFacebookVideoInput {
  pageAccessToken: string;
  pageId: string;
  videoUrl: string;
  description: string;
  onPermalinkError: (error: unknown) => void;
}

function absolutePermalink(raw: string): string {
  if (raw.startsWith('https://')) return raw;
  return `https://www.facebook.com${raw.startsWith('/') ? '' : '/'}${raw}`;
}

export async function publishFacebookVideo(
  input: PublishFacebookVideoInput,
): Promise<FacebookPublishResult> {
  const published = await facebookFetch(
    'FACEBOOK_PUBLISH_FAILED',
    `${FACEBOOK_GRAPH_VIDEO}/${encodeURIComponent(input.pageId)}/videos`,
    formPost({ file_url: input.videoUrl, description: input.description }, input.pageAccessToken),
  );
  const postId = readOptionalString(published, 'id');
  if (postId === null) throw new FacebookError('FACEBOOK_PUBLISH_FAILED: missing id', 502);

  let permalink: string | null = null;
  try {
    const media = await facebookFetch(
      'FACEBOOK_PERMALINK_FAILED',
      graphUrl(encodeURIComponent(postId), { fields: 'permalink_url' }),
      bearer(input.pageAccessToken),
    );
    const raw = readOptionalString(media, 'permalink_url');
    permalink = raw === null ? null : absolutePermalink(raw);
  } catch (error) {
    input.onPermalinkError(error);
  }
  return { postId, permalink };
}

//---------------
// getFacebookVideoInsights — views from video_insights plus like/comment
// totals from the video node summaries. Throws on HTTP errors so the
// metrics collector logs and retries on the next run.
//---------------
function readSummaryTotal(body: JsonRecord, key: string): number | null {
  const node = readRecord(body, key);
  const summary = node === null ? null : readRecord(node, 'summary');
  return summary === null ? null : readOptionalCount(summary, 'total_count');
}

export async function getFacebookVideoInsights(
  pageAccessToken: string,
  videoId: string,
): Promise<Record<string, number>> {
  const insights: Record<string, number> = {};
  const id = encodeURIComponent(videoId);

  const viewsBody = await facebookFetch(
    'FACEBOOK_INSIGHTS_FAILED',
    graphUrl(`${id}/video_insights`, { metric: 'total_video_views' }),
    bearer(pageAccessToken),
  );
  const entries: unknown[] = Array.isArray(viewsBody.data) ? viewsBody.data : [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const name = readOptionalString(entry, 'name');
    const values: unknown[] = Array.isArray(entry.values) ? entry.values : [];
    const first = values[0];
    const value = isRecord(first) ? readOptionalCount(first, 'value') : null;
    if (name !== null && value !== null) insights[name] = value;
  }

  const summaryBody = await facebookFetch(
    'FACEBOOK_INSIGHTS_FAILED',
    graphUrl(id, { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)' }),
    bearer(pageAccessToken),
  );
  const likes = readSummaryTotal(summaryBody, 'likes');
  if (likes !== null) insights.likes = likes;
  const comments = readSummaryTotal(summaryBody, 'comments');
  if (comments !== null) insights.comments = comments;
  return insights;
}
