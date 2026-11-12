//---------------
// fanvue-media — the vault upload contract (verified against
// api.fanvue.com/docs/tutorials/uploading-media).
//
// A video reaches Fanvue in four steps:
//   1. POST /media/uploads               -> mediaUuid, uploadId, partSize,
//                                           maxParts, totalParts
//   2. GET  /media/uploads/{id}/parts/urls?from=1&to=N
//                                        -> signed URL per part
//   3. PUT  each part to its signed URL  -> ETag per part
//   4. PATCH /media/uploads/{id}         -> { parts: [{ PartNumber, ETag }] }
// Then poll GET /media/{mediaUuid} until status is `ready` — attaching
// media while it is still `processing` publishes a post fans cannot open.
//
// The API caps a file at 1.5 GiB and parts at 6 MiB, so a real video is
// uploaded in several parts. Sending only part 1 (the old implementation)
// silently truncated every video larger than one part.
//---------------

import { FanvueError } from '@/lib/errors';
import {
  FANVUE_API_BASE,
  bearer,
  fanvueFetch,
  isRecord,
  jsonBearer,
  readOptionalNumber,
  readOptionalString,
} from '@/lib/fanvue-http';

// The vault byte upload is not a JSON API call: a real part cannot cross
// in 15s. Give each part transfer its own budget.
export const FANVUE_UPLOAD_TIMEOUT_MS = 10 * 60_000;
// The API documents a 1.5 GiB ceiling for a media upload.
export const FANVUE_MAX_FILE_BYTES = 1_610_612_736;
// Poll cadence from the API docs' own helper: every 1.5s, up to 300s.
export const FANVUE_MEDIA_POLL_INTERVAL_MS = 1_500;
export const FANVUE_MEDIA_READY_TIMEOUT_MS = 5 * 60_000;

const MEDIA_STATUSES = ['created', 'processing', 'ready', 'error'] as const;
export type FanvueMediaStatus = (typeof MEDIA_STATUSES)[number];

export interface FanvueUploadSession {
  mediaUuid: string;
  uploadId: string;
  partSize: number;
  maxParts: number;
  // Null when the create call omitted sizeBytes; the caller computes
  // ceil(fileSize / partSize).
  totalParts: number | null;
}

export interface FanvueUploadPartUrl {
  partNumber: number;
  url: string;
}

export interface FanvueUploadedPart {
  partNumber: number;
  etag: string;
}

//---------------
// createFanvueUploadSession — step 1: registers the media item and opens
// the multipart session. `mediaUuid` is the id the post needs; `uploadId`
// is the session every later step uses.
//---------------
export async function createFanvueUploadSession(
  accessToken: string,
  input: { filename: string; fileSize: number },
): Promise<FanvueUploadSession> {
  const body = await fanvueFetch('FANVUE_UPLOAD_FAILED', `${FANVUE_API_BASE}/media/uploads`, {
    ...jsonBearer(accessToken),
    method: 'POST',
    body: JSON.stringify({
      name: input.filename,
      filename: input.filename,
      mediaType: 'video',
      sizeBytes: input.fileSize,
    }),
  });

  const mediaUuid = readOptionalString(body, 'mediaUuid');
  if (mediaUuid === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing mediaUuid', 502);
  }
  const uploadId = readOptionalString(body, 'uploadId');
  if (uploadId === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing uploadId', 502);
  }
  const partSize = readOptionalNumber(body, 'partSize');
  if (partSize === null || !Number.isInteger(partSize) || partSize < 1) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: invalid partSize', 502);
  }
  const maxParts = readOptionalNumber(body, 'maxParts');
  if (maxParts === null || !Number.isInteger(maxParts) || maxParts < 1) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: invalid maxParts', 502);
  }
  const totalParts = readOptionalNumber(body, 'totalParts');
  if (totalParts !== null && (!Number.isInteger(totalParts) || totalParts < 0)) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: invalid totalParts', 502);
  }

  return { mediaUuid, uploadId, partSize, maxParts, totalParts };
}

//---------------
// fetchFanvueUploadPartUrls — step 2: signing a contiguous range costs one
// request instead of one per part. Part numbers are 1-based.
//---------------
export async function fetchFanvueUploadPartUrls(
  accessToken: string,
  uploadId: string,
  from: number,
  to: number,
): Promise<FanvueUploadPartUrl[]> {
  const query = new URLSearchParams({ from: String(from), to: String(to) });
  const body = await fanvueFetch(
    'FANVUE_UPLOAD_FAILED',
    `${FANVUE_API_BASE}/media/uploads/${encodeURIComponent(uploadId)}/parts/urls?${query.toString()}`,
    bearer(accessToken),
  );

  const rawParts = body.parts;
  if (!Array.isArray(rawParts) || rawParts.length === 0) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing part URLs', 502);
  }
  const parts: FanvueUploadPartUrl[] = [];
  for (const entry of rawParts) {
    if (!isRecord(entry)) continue;
    const partNumber = readOptionalNumber(entry, 'partNumber');
    const url = readOptionalString(entry, 'url');
    if (partNumber === null || url === null) continue;
    parts.push({ partNumber, url });
  }
  if (parts.length === 0) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing part URLs', 502);
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  return parts;
}

//---------------
// uploadFanvueUploadPart — step 3: PUT the raw bytes to one signed URL.
// The URL already carries its authorization, so no Bearer header is sent.
// Only the status decides (a presigned endpoint answers with an empty
// body); a missing ETag is a failure, not a guess.
//---------------
export async function uploadFanvueUploadPart(
  uploadUrl: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  // A setTimeout-driven AbortController, not AbortSignal.timeout: the
  // deadline must stay observable under vitest's fake timers, which do not
  // fake AbortSignal.timeout.
  const uploadController = new AbortController();
  const uploadDeadline = setTimeout(() => uploadController.abort(), FANVUE_UPLOAD_TIMEOUT_MS);
  let uploaded: Response;
  try {
    uploaded = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Blob([new Uint8Array(bytes)], { type: contentType }),
      signal: uploadController.signal,
    });
  } finally {
    clearTimeout(uploadDeadline);
  }
  if (!uploaded.ok) {
    throw new FanvueError(`FANVUE_UPLOAD_FAILED: status ${uploaded.status}`, uploaded.status);
  }
  const etag = uploaded.headers.get('etag');
  if (etag === null || etag === '') {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing etag', 502);
  }
  return etag;
}

//---------------
// completeFanvueUploadSession — step 4: tells Fanvue the parts landed.
// Field names are the API's capitalized `PartNumber` / `ETag`. The
// response is the media status (normally `processing`), not a media id:
// the id came from step 1.
//---------------
export async function completeFanvueUploadSession(
  accessToken: string,
  uploadId: string,
  parts: FanvueUploadedPart[],
): Promise<FanvueMediaStatus> {
  const body = await fanvueFetch(
    'FANVUE_UPLOAD_FAILED',
    `${FANVUE_API_BASE}/media/uploads/${encodeURIComponent(uploadId)}`,
    {
      ...jsonBearer(accessToken),
      method: 'PATCH',
      body: JSON.stringify({
        parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      }),
    },
  );
  const status = readOptionalString(body, 'status');
  if (status === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing status', 502);
  }
  if (!isMediaStatus(status)) {
    throw new FanvueError(`FANVUE_UPLOAD_FAILED: unknown media status ${status}`, 502);
  }
  return status;
}

function isMediaStatus(value: string): value is FanvueMediaStatus {
  return (MEDIA_STATUSES as readonly string[]).includes(value);
}

export interface FanvueMediaState {
  status: FanvueMediaStatus;
  errorReason: string | null;
}

//---------------
// fetchFanvueMedia — one processing-status read. When status is `error`,
// `errorReason` names the cause (unsupported_format, video_too_long, ...).
//---------------
export async function fetchFanvueMedia(
  accessToken: string,
  mediaUuid: string,
): Promise<FanvueMediaState> {
  const body = await fanvueFetch(
    'FANVUE_UPLOAD_FAILED',
    `${FANVUE_API_BASE}/media/${encodeURIComponent(mediaUuid)}`,
    bearer(accessToken),
  );
  const status = readOptionalString(body, 'status');
  if (status === null) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: missing media status', 502);
  }
  if (!isMediaStatus(status)) {
    throw new FanvueError(`FANVUE_UPLOAD_FAILED: unknown media status ${status}`, 502);
  }
  return { status, errorReason: readOptionalString(body, 'errorReason') };
}

export interface WaitForFanvueMediaOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

//---------------
// waitForFanvueMediaReady — polls until the transcoder marks the media
// ready. A post attached before `ready` is visible to fans but cannot be
// opened, so this wait is part of publishing.
//---------------
export async function waitForFanvueMediaReady(
  accessToken: string,
  mediaUuid: string,
  options: WaitForFanvueMediaOptions = {},
): Promise<FanvueMediaState> {
  const timeoutMs = options.timeoutMs ?? FANVUE_MEDIA_READY_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? FANVUE_MEDIA_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const media = await fetchFanvueMedia(accessToken, mediaUuid);
    if (media.status === 'ready') return media;
    if (media.status === 'error') {
      throw new FanvueError(
        `FANVUE_UPLOAD_FAILED: media processing failed (${media.errorReason ?? 'unknown'})`,
        502,
      );
    }
    if (Date.now() >= deadline) {
      throw new FanvueError(
        `FANVUE_UPLOAD_FAILED: media still ${media.status} after ${timeoutMs}ms`,
        504,
      );
    }
    await sleep(intervalMs);
  }
}

export interface UploadVideoToFanvueVaultInput {
  accessToken: string;
  video: Buffer;
  filename: string;
  contentType: string;
}

//---------------
// uploadVideoToFanvueVault — the whole upload as one call: create the
// session, sign every part, PUT them in order, complete the session and
// wait for `ready`. Returns the media uuid the post needs.
//---------------
export async function uploadVideoToFanvueVault(
  input: UploadVideoToFanvueVaultInput,
): Promise<string> {
  if (input.video.length === 0) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: video is empty', 400);
  }
  if (input.video.length > FANVUE_MAX_FILE_BYTES) {
    throw new FanvueError(
      `FANVUE_UPLOAD_FAILED: video exceeds ${FANVUE_MAX_FILE_BYTES} bytes`,
      400,
    );
  }

  const session = await createFanvueUploadSession(input.accessToken, {
    filename: input.filename,
    fileSize: input.video.length,
  });

  const totalParts = session.totalParts ?? Math.ceil(input.video.length / session.partSize);
  if (!Number.isInteger(totalParts) || totalParts < 1) {
    throw new FanvueError('FANVUE_UPLOAD_FAILED: invalid totalParts', 502);
  }
  if (totalParts > session.maxParts) {
    throw new FanvueError(
      `FANVUE_UPLOAD_FAILED: file needs ${totalParts} parts, session allows ${session.maxParts}`,
      400,
    );
  }

  const signedUrls = await fetchFanvueUploadPartUrls(
    input.accessToken,
    session.uploadId,
    1,
    totalParts,
  );
  const urlByPart = new Map(signedUrls.map((entry) => [entry.partNumber, entry.url]));

  const uploadedParts: FanvueUploadedPart[] = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    const url = urlByPart.get(partNumber);
    if (url === undefined) {
      throw new FanvueError(
        `FANVUE_UPLOAD_FAILED: missing signed URL for part ${partNumber}`,
        502,
      );
    }
    const start = (partNumber - 1) * session.partSize;
    const end = Math.min(start + session.partSize, input.video.length);
    const etag = await uploadFanvueUploadPart(url, input.video.subarray(start, end), input.contentType);
    uploadedParts.push({ partNumber, etag });
  }

  await completeFanvueUploadSession(input.accessToken, session.uploadId, uploadedParts);
  await waitForFanvueMediaReady(input.accessToken, session.mediaUuid);
  return session.mediaUuid;
}
