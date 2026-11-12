import 'server-only';

import { randomUUID } from 'node:crypto';

import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// Signed video uploads (issue #561) — the remote replacement for sending
// a local video path to publish. Flow: mint (this module creates one
// owner-bound `video_uploads` row plus a signed upload URL for the
// private `videos` bucket), the caller PUTs the bytes straight to
// storage, complete (the server downloads the object and verifies the
// real content via magic bytes before marking the row `ready`), and
// publish-by-id claims the row exactly once (`ready` -> `consumed` in a
// single conditional update, so a replay or a concurrent second publish
// loses). The row is the capability record: the upload id alone is never
// enough — every step re-checks the owner and the expiry.
//---------------

export const VIDEO_UPLOAD_BUCKET = 'videos';
// Same 2GB ceiling as POST /api/upload-content and the MCP client guard.
export const MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const VIDEO_UPLOAD_TTL_MS = 15 * 60 * 1000;
export const VIDEO_UPLOAD_CONTENT_TYPES = ['video/mp4', 'video/quicktime'] as const;
export const VIDEO_UPLOAD_STATUSES = ['pending', 'ready', 'consumed'] as const;

export type VideoUploadContentType = (typeof VIDEO_UPLOAD_CONTENT_TYPES)[number];
export type VideoUploadStatus = (typeof VIDEO_UPLOAD_STATUSES)[number];

export interface VideoUploadRow {
  id: string;
  user_id: string;
  storage_path: string;
  declared_content_type: string | null;
  detected_content_type: string | null;
  size_bytes: number | null;
  status: VideoUploadStatus;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
}

// Stable failure for every signed-upload branch: routes map `status` to
// the HTTP status and `code` to the machine-readable error code.
export class VideoUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'VideoUploadError';
  }
}

// Persistence + storage seams. The Supabase adapter below is the only
// place that touches the real client, so the state machine is unit
// tested against in-memory fakes.
export interface VideoUploadStore {
  insertUpload(row: VideoUploadRow): Promise<VideoUploadRow>;
  getUpload(id: string): Promise<VideoUploadRow | null>;
  // Conditional update: applies the patch only when the row still holds
  // `expectedStatus`. Returns false when a concurrent caller moved it.
  updateUpload(
    id: string,
    expectedStatus: VideoUploadStatus,
    patch: Partial<VideoUploadRow>,
  ): Promise<boolean>;
  deleteUpload(id: string): Promise<void>;
}

export interface VideoUploadStorage {
  createSignedUploadUrl(
    path: string,
  ): Promise<{ data: { signedUrl: string; token: string; path: string } | null; error: { message: string } | null }>;
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extensionFor(contentType: VideoUploadContentType): string {
  return contentType === 'video/quicktime' ? 'mov' : 'mp4';
}

export function parseMintBody(body: unknown): { contentType: VideoUploadContentType; sizeBytes: number } {
  if (!isRecord(body)) {
    throw new VideoUploadError('A JSON body with contentType and sizeBytes is required.', 400, 'VIDEO_UPLOAD_INVALID_BODY');
  }
  const { contentType, sizeBytes } = body;
  if (
    typeof contentType !== 'string' ||
    !(VIDEO_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    throw new VideoUploadError('contentType must be video/mp4 or video/quicktime.', 400, 'VIDEO_UPLOAD_INVALID_CONTENT_TYPE');
  }
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new VideoUploadError('sizeBytes must be a positive integer.', 400, 'VIDEO_UPLOAD_INVALID_SIZE');
  }
  if (sizeBytes > MAX_VIDEO_UPLOAD_BYTES) {
    throw new VideoUploadError('Video is too large. Maximum is 2GB.', 413, 'VIDEO_UPLOAD_TOO_LARGE');
  }
  return { contentType: contentType as VideoUploadContentType, sizeBytes };
}

export interface MintedVideoUpload {
  uploadId: string;
  signedUrl: string;
  token: string;
  storagePath: string;
  expiresAt: string;
  maxBytes: number;
}

export async function mintVideoUpload(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  userId: string,
  input: { contentType: VideoUploadContentType; sizeBytes: number },
  now: Date,
): Promise<MintedVideoUpload> {
  const id = randomUUID();
  const storagePath = `${userId}/direct-uploads/${id}.${extensionFor(input.contentType)}`;
  const expiresAt = new Date(now.getTime() + VIDEO_UPLOAD_TTL_MS).toISOString();
  await store.insertUpload({
    id,
    user_id: userId,
    storage_path: storagePath,
    declared_content_type: input.contentType,
    detected_content_type: null,
    size_bytes: input.sizeBytes,
    status: 'pending',
    expires_at: expiresAt,
    created_at: now.toISOString(),
    consumed_at: null,
  });
  const { data, error } = await storage.createSignedUploadUrl(storagePath);
  if (error !== null || data === null) {
    // No orphan row for an upload the caller can never perform.
    await store.deleteUpload(id);
    throw new VideoUploadError('Could not create the signed upload URL.', 502, 'VIDEO_UPLOAD_SIGN_FAILED');
  }
  return {
    uploadId: id,
    signedUrl: data.signedUrl,
    token: data.token,
    storagePath,
    expiresAt,
    maxBytes: MAX_VIDEO_UPLOAD_BYTES,
  };
}

// Foreign-owned ids answer 404, never 403: the id's existence is itself
// owner-private (unknown ids -> 404 rule).
async function loadOwnedUpload(store: VideoUploadStore, userId: string, uploadId: string): Promise<VideoUploadRow> {
  const row = await store.getUpload(uploadId);
  if (row === null || row.user_id !== userId) {
    throw new VideoUploadError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
  }
  return row;
}

// A refused upload must not keep its object: the signed URL can point at
// up to 2GB, and an expired or rejected object is never published.
async function discardObject(storage: VideoUploadStorage, path: string): Promise<void> {
  try {
    await storage.remove([path]);
  } catch {
    // Best-effort. A failed delete must not hide why the upload was refused.
  }
}

async function rejectIfExpired(storage: VideoUploadStorage, row: VideoUploadRow, now: Date): Promise<void> {
  if (Date.parse(row.expires_at) <= now.getTime()) {
    await discardObject(storage, row.storage_path);
    throw new VideoUploadError('This video upload has expired. Mint a new one.', 410, 'VIDEO_UPLOAD_EXPIRED');
  }
}

async function downloadVerifiedVideo(
  storage: VideoUploadStorage,
  row: VideoUploadRow,
): Promise<{ buffer: Buffer; detectedType: VideoUploadContentType }> {
  const { data, error } = await storage.download(row.storage_path);
  if (error !== null || data === null) {
    throw new VideoUploadError('No uploaded file was found for this upload. Upload the video first.', 400, 'VIDEO_UPLOAD_FILE_MISSING');
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const refuse = async (message: string, status: number, code: string): Promise<never> => {
    await discardObject(storage, row.storage_path);
    throw new VideoUploadError(message, status, code);
  };
  if (buffer.length === 0) {
    return refuse('The uploaded video is empty.', 400, 'VIDEO_UPLOAD_FILE_EMPTY');
  }
  if (buffer.length > MAX_VIDEO_UPLOAD_BYTES) {
    return refuse('Video is too large. Maximum is 2GB.', 413, 'VIDEO_UPLOAD_TOO_LARGE');
  }
  // Real content, never the declared type: both are caller-controlled.
  const detected = detectMagicMimeType(buffer);
  if (detected !== 'video/mp4' && detected !== 'video/quicktime') {
    return refuse('The uploaded file is not an MP4 or MOV video.', 400, 'VIDEO_UPLOAD_CONTENT_UNRECOGNIZED');
  }
  if (row.declared_content_type !== null && row.declared_content_type !== detected) {
    return refuse('The uploaded video content does not match the declared content type.', 400, 'VIDEO_UPLOAD_TYPE_MISMATCH');
  }
  return { buffer, detectedType: detected };
}

export interface CompletedVideoUpload {
  uploadId: string;
  status: 'ready';
  contentType: VideoUploadContentType;
  sizeBytes: number;
}

export async function completeVideoUpload(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  userId: string,
  uploadId: string,
  now: Date,
): Promise<CompletedVideoUpload> {
  const row = await loadOwnedUpload(store, userId, uploadId);
  if (row.status === 'consumed') {
    throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  await rejectIfExpired(storage, row, now);
  if (row.status === 'ready') {
    // Idempotent retry: the verified facts are already on the row.
    return {
      uploadId: row.id,
      status: 'ready',
      contentType: (row.detected_content_type ?? row.declared_content_type ?? 'video/mp4') as VideoUploadContentType,
      sizeBytes: row.size_bytes ?? 0,
    };
  }
  const { buffer, detectedType } = await downloadVerifiedVideo(storage, row);
  const sizeBytes = buffer.length;
  const updated = await store.updateUpload(row.id, 'pending', {
    status: 'ready',
    detected_content_type: detectedType,
    size_bytes: sizeBytes,
  });
  if (!updated) {
    throw new VideoUploadError('This video upload changed while it was being verified. Retry.', 409, 'VIDEO_UPLOAD_CONFLICT');
  }
  return { uploadId: row.id, status: 'ready', contentType: detectedType, sizeBytes };
}

export interface ClaimedVideoUpload {
  row: VideoUploadRow;
  buffer: Buffer;
  contentType: VideoUploadContentType;
}

// Single-use consumption: the bytes are verified first, then the row is
// claimed with one conditional update. A second caller (replay or a
// concurrent publish) sees `consumed` and is refused before any provider
// is contacted.
export async function claimUploadForPublish(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  userId: string,
  uploadId: string,
  now: Date,
): Promise<ClaimedVideoUpload> {
  const row = await loadOwnedUpload(store, userId, uploadId);
  if (row.status === 'consumed') {
    throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  await rejectIfExpired(storage, row, now);
  if (row.status === 'pending') {
    throw new VideoUploadError('This video upload is not completed yet. Complete it before publishing.', 409, 'VIDEO_UPLOAD_NOT_READY');
  }
  const { buffer, detectedType } = await downloadVerifiedVideo(storage, row);
  const updated = await store.updateUpload(row.id, 'ready', {
    status: 'consumed',
    consumed_at: now.toISOString(),
  });
  if (!updated) {
    throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  return { row: { ...row, status: 'consumed', consumed_at: now.toISOString() }, buffer, contentType: detectedType };
}

//---------------
// Supabase adapters (service role; every query is owner-filtered by the
// callers above — the store itself is keyed by upload id only).
//---------------

interface QueryError {
  message: string;
}

export function createSupabaseVideoUploadStore(): VideoUploadStore {
  const supabase = createSupabaseServiceClient();
  // The table ships in migration 059 and is in the generated Database
  // types; this adapter still speaks through a minimal structural view
  // of the query builder so the store seam stays trivially fakeable in
  // the state-machine unit tests.
  const table = () =>
    supabase.from('video_uploads' as never) as unknown as {
      insert: (values: Record<string, unknown>) => Promise<{ error: QueryError | null }>;
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: VideoUploadRow | null; error: QueryError | null }>;
        };
      };
      update: (values: Record<string, unknown>) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            select: (columns: string) => Promise<{ data: unknown[] | null; error: QueryError | null }>;
          };
        };
      };
      delete: () => { eq: (column: string, value: string) => Promise<{ error: QueryError | null }> };
    };
  return {
    async insertUpload(row) {
      const { error } = await table().insert({ ...row });
      if (error !== null) throw new Error(`Failed to record the video upload: ${error.message}`);
      return row;
    },
    async getUpload(id) {
      const { data, error } = await table().select('*').eq('id', id).maybeSingle();
      if (error !== null) throw new Error(`Failed to load the video upload: ${error.message}`);
      return data;
    },
    async updateUpload(id, expectedStatus, patch) {
      // `.select('id')` makes PostgREST return the updated rows, so a
      // claim that lost the race (row no longer in expectedStatus)
      // observes zero rows instead of a silent overwrite.
      const { data, error } = await table()
        .update({ ...patch })
        .eq('id', id)
        .eq('status', expectedStatus)
        .select('id');
      if (error !== null) throw new Error(`Failed to update the video upload: ${error.message}`);
      return data !== null && data.length > 0;
    },
    async deleteUpload(id) {
      const { error } = await table().delete().eq('id', id);
      if (error !== null) throw new Error(`Failed to remove the video upload: ${error.message}`);
    },
  };
}

export function createSupabaseVideoUploadStorage(): VideoUploadStorage {
  const supabase = createSupabaseServiceClient();
  const bucket = () => supabase.storage.from(VIDEO_UPLOAD_BUCKET);
  return {
    async createSignedUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      return {
        data: data === null ? null : { signedUrl: data.signedUrl, token: data.token, path: data.path },
        error: error === null ? null : { message: error.message },
      };
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      return { data, error: error === null ? null : { message: error.message } };
    },
    async remove(paths) {
      const { error } = await bucket().remove(paths);
      return { error: error === null ? null : { message: error.message } };
    },
  };
}
