//---------------
// LinkedIn — API client to connect accounts (OAuth 2.0) and publish
// videos on the member's profile (w_member_social, via the "Share on
// LinkedIn" product). Profile/name come from OIDC (openid + profile, endpoint
// /v2/userinfo). Organization pages require the "Community
// Management API" (w_organization_social) — not yet approved in the app.
//
// Documentation (2026): Posts API (POST /rest/posts), Videos API
// (initializeUpload / parts / finalize). ALL endpoints require the
// headers Linkedin-Version: YYYYMM e X-Restli-Protocol-Version: 2.0.0.
// The access token expires in 60 days (refreshed on reconnect).
//---------------

import { LinkedInError as LinkedinError } from '@/lib/errors';
export { LinkedInError as LinkedinError } from '@/lib/errors';

export const LINKEDIN_API_VERSION = '202609';
export const LINKEDIN_VIDEO_MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

const LINKEDIN_API = 'https://api.linkedin.com';
const LINKEDIN_AUTH = 'https://www.linkedin.com/oauth/v2';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LinkedinError(`LINKEDIN_ENV_MISSING: ${name} is not defined`, 500);
  }
  return value;
}

function linkedinHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

//---------------
// buildLinkedInAuthorizationUrl — OAuth consent URL (post scopes for
// member and organization)
//---------------
export function buildLinkedInAuthorizationUrl(state: string, redirectUriOverride?: string): string {
  const clientId = requireEnv('LINKEDIN_CLIENT_ID');
  const redirectUri = redirectUriOverride ?? requireEnv('LINKEDIN_REDIRECT_URI');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(' '),
  });
  return `${LINKEDIN_AUTH}/authorization?${params.toString()}`;
}

//---------------
// exchangeLinkedInCodeForToken — exchanges the authorization code for the access token
// (expires in ~60 days; reconnecting renews it — same model as Instagram)
//---------------
export interface LinkedinToken {
  access_token: string;
  expires_in: number;
}

export async function exchangeLinkedInCodeForToken(code: string, redirectUriOverride?: string): Promise<LinkedinToken> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: requireEnv('LINKEDIN_CLIENT_ID'),
    client_secret: requireEnv('LINKEDIN_CLIENT_SECRET'),
    redirect_uri: redirectUriOverride ?? requireEnv('LINKEDIN_REDIRECT_URI'),
  });
  const response = await fetch(`${LINKEDIN_AUTH}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') {
    const description =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `status ${response.status}`;
    throw new LinkedinError(`LINKEDIN_TOKEN_FAILED: ${description}`, 401);
  }
  return {
    access_token: payload.access_token,
    expires_in: typeof payload.expires_in === 'number' ? payload.expires_in : 5_184_000,
  };
}

//---------------
// fetchLinkedInMemberProfile — member id (sub) and name; required for the
// author URN of the personal post
//---------------
export async function fetchLinkedInMemberProfile(accessToken: string): Promise<{ id: string; name: string | null }> {
  const response = await fetch(`${LINKEDIN_API}/v2/userinfo`, {
    headers: linkedinHeaders(accessToken),
  });
  if (!response.ok) {
    throw new LinkedinError(`LINKEDIN_PROFILE_FAILED: status ${response.status}`, response.status);
  }
  const body = (await response.json()) as { sub?: string; name?: string };
  if (!body.sub) {
    throw new LinkedinError('LINKEDIN_PROFILE_FAILED: missing sub', 502);
  }
  return { id: body.sub, name: body.name ?? null };
}

//---------------
// fetchLinkedInAdminOrganizations — organizations where the member is admin (for
// connect company pages). Returns the URN + localized name when available.
//---------------
export interface LinkedinOrganization {
  id: string;
  name: string | null;
}

export async function fetchLinkedInAdminOrganizations(accessToken: string): Promise<LinkedinOrganization[]> {
  const response = await fetch(
    `${LINKEDIN_API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(
      organizationalEntity,
      organizationName~localized
    ))`,
    { headers: linkedinHeaders(accessToken) },
  );
  if (!response.ok) {
    throw new LinkedinError(`LINKEDIN_ORGS_FAILED: status ${response.status}`, response.status);
  }
  const body = (await response.json()) as {
    elements?: Array<{
      organizationalEntity?: string;
      organizationName?: { localized?: Record<string, string> };
    }>;
  };
  return (body.elements ?? [])
    .filter((element): element is { organizationalEntity: string; organizationName?: { localized?: Record<string, string> } } =>
      typeof element.organizationalEntity === 'string')
    .map((element) => ({
      id: element.organizationalEntity,
      name:
        element.organizationName?.localized
          ? (Object.values(element.organizationName.localized)[0] ?? null)
          : null,
    }));
}

//---------------
// Videos API — initializeUpload → partes → finalizeUpload
//---------------

export interface LinkedinUploadInstruction {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
  partNumber: number;
}

export interface LinkedinVideoUpload {
  video: string;
  uploadToken: string;
  uploadInstructions: LinkedinUploadInstruction[];
}

export async function initializeLinkedInVideoUpload(
  accessToken: string,
  ownerUrn: string,
  sizeBytes: number,
  mimeType: string,
): Promise<LinkedinVideoUpload> {
  if (sizeBytes > LINKEDIN_VIDEO_MAX_BYTES) {
    throw new LinkedinError('LINKEDIN_VIDEO_TOO_LARGE: max 5GB', 400);
  }
  const response = await fetch(`${LINKEDIN_API}/rest/videos?action=initializeUpload`, {
    method: 'POST',
    headers: { ...linkedinHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initializeUploadRequest: { owner: ownerUrn, fileSizeBytes: sizeBytes, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  if (!response.ok) {
    throw new LinkedinError(`LINKEDIN_INIT_FAILED: status ${response.status}`, response.status);
  }
  const body = (await response.json()) as { value?: LinkedinVideoUpload };
  if (!body.value?.video || !body.value.uploadInstructions) {
    throw new LinkedinError('LINKEDIN_INIT_FAILED: missing value', 502);
  }
  void mimeType;
  return body.value;
}

export async function uploadLinkedInVideoParts(
  accessToken: string,
  instructions: LinkedinUploadInstruction[],
  parts: Uint8Array[],
): Promise<void> {
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    const part = parts[index];
    if (!part) {
      throw new LinkedinError(`LINKEDIN_PART_MISSING: part ${instruction.partNumber}`, 400);
    }
    const response = await fetch(instruction.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${instruction.firstByte}-${instruction.lastByte}/${parts.reduce((sum, current) => sum + current.length, 0)}`,
      },
      body: new Uint8Array(part),
    });
    if (!response.ok) {
      throw new LinkedinError(`LINKEDIN_PART_FAILED: part ${instruction.partNumber} status ${response.status}`, response.status);
    }
  }
}

export async function finalizeLinkedInVideoUpload(
  accessToken: string,
  videoUrn: string,
  uploadToken: string,
): Promise<void> {
  const response = await fetch(`${LINKEDIN_API}/rest/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: { ...linkedinHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      finalizeUploadRequest: { video: videoUrn, uploadToken },
    }),
  });
  if (!response.ok) {
    throw new LinkedinError(`LINKEDIN_FINALIZE_FAILED: status ${response.status}`, response.status);
  }
}

//---------------
// Posts API — createRecord with a video embed
//---------------

interface PostRequestBody {
  author: string;
  commentary: string;
  visibility: string;
  distribution: { feedDistribution: string; targetEntities: string[]; thirdPartyDistributionChannels: string[] };
  content: { media: { id: string; title?: string } };
  lifecycleState: string;
  isReshareDisabledByAuthor: boolean;
}

async function createPost(accessToken: string, requestBody: PostRequestBody): Promise<string> {
  const response = await fetch(`${LINKEDIN_API}/rest/posts`, {
    method: 'POST',
    headers: { ...linkedinHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new LinkedinError(
      `LINKEDIN_POST_FAILED: ${errorBody.message ?? `status ${response.status}`}`,
      response.status,
    );
  }
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  return body.id ?? response.headers.get('x-restli-id') ?? 'urn:li:share:unknown';
}

export async function createLinkedInMemberPost(
  accessToken: string,
  memberId: string,
  videoUrn: string,
  commentary: string,
): Promise<string> {
  return createPost(accessToken, {
    author: `urn:li:person:${memberId}`,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: { media: { id: videoUrn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
}

export async function createLinkedInOrganizationPost(
  accessToken: string,
  organizationUrn: string,
  videoUrn: string,
  commentary: string,
): Promise<string> {
  return createPost(accessToken, {
    author: organizationUrn,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: { media: { id: videoUrn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
}
