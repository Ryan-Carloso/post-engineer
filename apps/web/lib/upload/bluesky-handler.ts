import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import {
  BlueskyError,
  countBlueskyGraphemes,
  loginToBlueskySession,
  truncateBlueskyCaption,
  validateVideoForBluesky,
} from '@/lib/bluesky';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { sniffPublishMedia } from '@/lib/upload/publish-media-file';

const VIDEO_SERVICE = 'https://video.bsky.app';
const BSKY_SERVICE = 'https://bsky.social';
const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_MS = 60_000;
export const BLUESKY_IMAGE_MAX_BYTES = 1_000_000;

interface BlueskyAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  error?: string;
  errorCode?: string;
}

export interface BlueskyUploadResponse {
  success: boolean;
  results: BlueskyAccountResult[];
}

interface BlueskyPostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  langs: string[];
  embed:
    | {
      $type: 'app.bsky.embed.video';
      video: unknown;
      aspectRatio?: { width: number; height: number };
    }
    | { $type: 'app.bsky.embed.images'; images: { alt: string; image: unknown }[] };
}

export async function handleBlueskyUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<BlueskyUploadResponse> {
  const dids = getAccountIdsFromFormData(formData, 'did');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (dids.length === 0) {
    return { success: false, results: [accountFailure('', 'At least one Bluesky did is required', 'publish_rejected')] };
  }
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') {
    return { success: false, results: [accountFailure('', 'Caption is required', 'publish_rejected')] };
  }
  if (!(rawFile instanceof File)) {
    return { success: false, results: [accountFailure('', 'A video or image file is required', 'publish_rejected')] };
  }

  const buffer = Buffer.from(await rawFile.arrayBuffer());
  const sniffed = sniffPublishMedia(buffer, rawFile.type);
  const image = sniffed !== null && sniffed.kind === 'image' ? sniffed : null;
  if (image !== null && image.buffer.length > BLUESKY_IMAGE_MAX_BYTES) {
    return {
      success: false,
      results: [accountFailure('', 'Image exceeds the Bluesky 1 MB limit', 'publish_rejected')],
    };
  }
  const validation = image !== null ? { ok: true as const } : validateVideoForBluesky({
    sizeBytes: buffer.length,
    durationSeconds: Number(formData.get('durationSeconds') ?? 0),
    mimeType: rawFile.type || 'video/mp4',
  });
  if (!validation.ok) {
    return { success: false, results: [accountFailure('', validation.reason, 'publish_rejected')] };
  }

  const caption = truncateBlueskyCaption(captionRaw.trim());

  const supabase = createSupabaseServiceClient();
  const results: BlueskyAccountResult[] = [];

  for (const did of dids) {
    try {
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'bluesky', did);
      const appPassword = tokens.access_token;
      const handle = typeof tokens.handle === 'string' ? tokens.handle : did;
      if (typeof appPassword !== 'string' || appPassword === '') {
        rememberDeadCredential('bluesky', did, ownerUserId);
        results.push(accountFailure(did, 'Bluesky credential not found', 'token_missing'));
        continue;
      }

      const postId = await publishToBluesky({
        appPassword,
        handle,
        did,
        caption,
        buffer,
        mimeType: image !== null ? image.contentType : rawFile.type || 'video/mp4',
        kind: image !== null ? 'image' : 'video',
      });

      await touchSocialAccount(supabase, ownerUserId, 'bluesky', did);
      results.push({ accountId: did, success: true, postId });
    } catch (error) {
      reportAccountUnauthorized('bluesky', did, ownerUserId, error);
      results.push(accountFailure(did, error));
    }
  }

  return { success: results.some((result) => result.success), results };
}

async function getServiceToken(accessJwt: string, pdsHost: string): Promise<string> {
  const url = new URL(`${BSKY_SERVICE}/xrpc/com.atproto.server.getServiceAuth`);
  url.searchParams.set('aud', `did:web:${pdsHost}`);
  url.searchParams.set('lxm', 'com.atproto.repo.uploadBlob');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessJwt}` },
  });
  if (!response.ok) {
    throw new Error(`Bluesky service auth failed (${response.status})`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function uploadVideoBlob(
  args: {
    accessJwt: string;
    pdsHost: string;
    did: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  },
): Promise<unknown> {
  const serviceToken = await getServiceToken(args.accessJwt, args.pdsHost);

  const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set('did', args.did);
  uploadUrl.searchParams.set('name', args.filename);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      'Content-Type': args.mimeType,
      'Content-Length': String(args.buffer.length),
    },
    body: new Uint8Array(args.buffer),
  });

  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
    jobId?: string;
    error?: unknown;
  };
  if (!uploadResponse.ok || !uploadBody.jobId) {
    const errorName =
      typeof uploadBody.error === 'string' ? uploadBody.error.replace(/\s+/g, ' ').slice(0, 80) : '';
    throw new Error(
      `Bluesky video upload failed (${uploadResponse.status}${errorName ? `: ${errorName}` : ''})`,
    );
  }

  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const statusUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus`);
    statusUrl.searchParams.set('jobId', uploadBody.jobId);
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${args.accessJwt}` },
    });
    if (!statusResponse.ok) continue;
    const status = (await statusResponse.json()) as {
      jobStatus?: { state?: string; blob?: unknown };
    };
    const job = status.jobStatus;
    if (job?.blob) return job.blob;
    if (job?.state === 'JOB_STATE_FAILED') {
      throw new Error('Bluesky video processing failed');
    }
  }
  throw new Error('Bluesky video processing timed out');
}

async function uploadImageBlob(accessJwt: string, buffer: Buffer, mimeType: string): Promise<unknown> {
  const response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessJwt}`,
      'Content-Type': mimeType,
      'Content-Length': String(buffer.length),
    },
    body: new Uint8Array(buffer),
  });
  if (!response.ok) {
    throw new Error(`Bluesky image upload failed (${response.status})`);
  }
  const body = (await response.json().catch(() => ({}))) as { blob?: unknown };
  if (body.blob === undefined || body.blob === null) {
    throw new Error('Bluesky image upload returned no blob');
  }
  return body.blob;
}

async function publishToBluesky(args: {
  appPassword: string;
  handle: string;
  did: string;
  caption: string;
  buffer: Buffer;
  mimeType: string;
  kind: 'video' | 'image';
}): Promise<string> {
  const session = await loginToBlueskySession(args.handle, args.appPassword);
  if (session.emailConfirmed === false) {
    throw new BlueskyError('email_not_verified', 'Bluesky email is not verified.');
  }
  const embed: BlueskyPostRecord['embed'] = args.kind === 'image'
    ? {
      $type: 'app.bsky.embed.images',
      images: [{ alt: '', image: await uploadImageBlob(session.accessJwt, args.buffer, args.mimeType) }],
    }
    : {
      $type: 'app.bsky.embed.video',
      video: await uploadVideoBlob({
        accessJwt: session.accessJwt,
        pdsHost: session.pdsHost,
        did: session.did,
        buffer: args.buffer,
        mimeType: args.mimeType,
        filename: 'video.mp4',
      }),
    };

  const record: BlueskyPostRecord = {
    $type: 'app.bsky.feed.post',
    text: args.caption.slice(0, Math.min(args.caption.length, countBlueskyGraphemes(args.caption) + 1)),
    createdAt: new Date().toISOString(),
    langs: ['pt'],
    embed,
  };

  const postUrl = `${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`;
  const postResponse = await fetch(postUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });
  if (!postResponse.ok) {
    throw new Error(`Bluesky post failed (${postResponse.status})`);
  }
  const postBody = (await postResponse.json()) as { uri?: string };
  return postBody.uri ?? `at://${session.did}/app.bsky.feed.post/unknown`;
}
