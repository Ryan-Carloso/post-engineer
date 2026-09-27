import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import {
  countBlueskyGraphemes,
  loginToBlueskySession,
  truncateBlueskyCaption,
  validateVideoForBluesky,
} from '@/lib/bluesky';

//---------------
// handleBlueskyUpload — publishes the video to the user's Bluesky account.
// AT Protocol flow: service auth → upload to video.bsky.app → poll the
// job up to the BlobRef → post with a video embed. The app password comes
// encrypted blob in social_accounts (encrypted_tokens).
// FormData (multipart, coming from the engine or the UI):
//   provider=bluesky, video (File mp4), caption, did (repetido),
//   userId (internal engine call only).
//---------------

const VIDEO_SERVICE = 'https://video.bsky.app';
const BSKY_SERVICE = 'https://bsky.social';
const POLL_INTERVAL_MS = 1_000;
const POLL_MAX_MS = 60_000;

interface BlueskyAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  error?: string;
}

export interface BlueskyUploadResponse {
  success: boolean;
  results: BlueskyAccountResult[];
}

//---------------
// minimal shape of the post body (app.bsky.feed.post)
//---------------
interface BlueskyPostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  langs: string[];
  embed: {
    $type: 'app.bsky.embed.video';
    video: unknown;
    aspectRatio?: { width: number; height: number };
  };
}

export async function handleBlueskyUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<BlueskyUploadResponse> {
  const dids = getAccountIdsFromFormData(formData, 'did');
  const captionRaw = formData.get('caption');
  const rawFile = formData.get('video');

  if (dids.length === 0) {
    return { success: false, results: [{ accountId: '', success: false, error: 'At least one Bluesky did is required' }] };
  }
  if (typeof captionRaw !== 'string' || captionRaw.trim() === '') {
    return { success: false, results: [{ accountId: '', success: false, error: 'Caption is required' }] };
  }
  if (!(rawFile instanceof File)) {
    return { success: false, results: [{ accountId: '', success: false, error: 'Video file is required' }] };
  }

  const buffer = Buffer.from(await rawFile.arrayBuffer());
  const validation = validateVideoForBluesky({
    sizeBytes: buffer.length,
    // duration cannot be inferred from the buffer without decoding; the engine
    // validates it before calling. Here we only enforce the static limits.
    durationSeconds: Number(formData.get('durationSeconds') ?? 0),
    mimeType: rawFile.type || 'video/mp4',
  });
  if (!validation.ok) {
    return { success: false, results: [{ accountId: '', success: false, error: validation.reason }] };
  }

  const caption = truncateBlueskyCaption(captionRaw.trim());

  const supabase = createSupabaseServiceClient();
  const results: BlueskyAccountResult[] = [];

  for (const did of dids) {
    try {
      // Ownership: resolves only the user's own accounts.
      const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'bluesky', did);
      const appPassword = tokens.access_token;
      const handle = typeof tokens.handle === 'string' ? tokens.handle : did;
      if (typeof appPassword !== 'string' || appPassword === '') {
        results.push({ accountId: did, success: false, error: 'Bluesky credential not found' });
        continue;
      }

      const postId = await publishVideoToBluesky({ appPassword, handle, did, caption, buffer, mimeType: rawFile.type || 'video/mp4' });

      await touchSocialAccount(supabase, ownerUserId, 'bluesky', did);
      results.push({ accountId: did, success: true, postId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId: did, success: false, error: message });
    }
  }

  return { success: results.some((result) => result.success), results };
}

//---------------
// getServiceToken — short-lived token (aud=video service) for the upload
//---------------
async function getServiceToken(accessJwt: string): Promise<string> {
  const url = new URL(`${BSKY_SERVICE}/xrpc/com.atproto.server.getServiceAuth`);
  url.searchParams.set('aud', 'did:web:video.bsky.app');
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

//---------------
// uploadVideoBlob — uploads the MP4 to video.bsky.app and polls the job
// until the BlobRef is ready. already_exists returns the previous blob.
//---------------
async function uploadVideoBlob(
  args: { accessJwt: string; did: string; buffer: Buffer; mimeType: string; filename: string },
): Promise<unknown> {
  const serviceToken = await getServiceToken(args.accessJwt);

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

  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as { jobId?: string };
  if (!uploadResponse.ok || !uploadBody.jobId) {
    throw new Error(`Bluesky video upload failed (${uploadResponse.status})`);
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

//---------------
// publishVideoToBluesky — orchestrates session → upload → post
//---------------
async function publishVideoToBluesky(args: {
  appPassword: string;
  handle: string;
  did: string;
  caption: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const session = await loginToBlueskySession(args.handle, args.appPassword);
  const blob = await uploadVideoBlob({
    accessJwt: session.accessJwt,
    did: session.did,
    buffer: args.buffer,
    mimeType: args.mimeType,
    filename: 'video.mp4',
  });

  const record: BlueskyPostRecord = {
    $type: 'app.bsky.feed.post',
    text: args.caption.slice(0, Math.min(args.caption.length, countBlueskyGraphemes(args.caption) + 1)),
    createdAt: new Date().toISOString(),
    langs: ['pt'],
    embed: {
      $type: 'app.bsky.embed.video',
      video: blob,
    },
  };

  const postUrl = new URL(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`);
  postUrl.searchParams.set('repo', session.did);
  postUrl.searchParams.set('collection', 'app.bsky.feed.post');
  const postResponse = await fetch(postUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(record),
  });
  if (!postResponse.ok) {
    throw new Error(`Bluesky post failed (${postResponse.status})`);
  }
  const postBody = (await postResponse.json()) as { uri?: string };
  return postBody.uri ?? `at://${session.did}/app.bsky.feed.post/unknown`;
}
