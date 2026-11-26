import 'server-only';

import { randomUUID } from 'node:crypto';

import { detectMagicMimeType } from '@/lib/media/magic-bytes';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  UPLOAD_CONTENT_TYPE_MESSAGE,
  UPLOAD_CONTENT_TYPES,
  VIDEO_UPLOAD_CONTENT_TYPES,
  isImageUploadContentType,
  type UploadContentType,
  type VideoUploadContentType,
} from '@/lib/contracts/videos';
import { IMAGE_PROVIDERS, isImageProvider } from '@/lib/contracts/providers';
import { SCHEDULED_UPLOAD_EXPIRY_MS } from '@/lib/videos/upload-expiry';
import { listLiveUploadSlotTimes } from '@/lib/videos/scheduled-upload-slots';

export { MAX_VIDEO_UPLOAD_BYTES, VIDEO_UPLOAD_CONTENT_TYPES, type UploadContentType, type VideoUploadContentType };

export const VIDEO_UPLOAD_BUCKET = 'videos';
export const VIDEO_UPLOAD_TTL_MS = 15 * 60 * 1000;
export const VIDEO_UPLOAD_SWEEP_LIMIT = 20;
export const VIDEO_UPLOAD_STATUSES = ['pending', 'ready', 'consumed'] as const;

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

export interface VideoUploadStore {
  insertUpload(row: VideoUploadRow): Promise<VideoUploadRow>;
  getUpload(id: string): Promise<VideoUploadRow | null>;
  updateUpload(
    id: string,
    expectedStatus: VideoUploadStatus,
    patch: Partial<VideoUploadRow>,
  ): Promise<boolean>;
  deleteUpload(id: string): Promise<void>;
  listExpired(now: Date, limit: number): Promise<Array<Pick<VideoUploadRow, 'id' | 'storage_path'>>>;
  listLiveSlotTimes(uploadIds: readonly string[]): Promise<Map<string, string>>;
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

const EXTENSIONS: Record<UploadContentType, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function maxUploadBytes(contentType: UploadContentType): number {
  return isImageUploadContentType(contentType) ? MAX_IMAGE_UPLOAD_BYTES : MAX_VIDEO_UPLOAD_BYTES;
}

function tooLarge(contentType: UploadContentType): VideoUploadError {
  return isImageUploadContentType(contentType)
    ? new VideoUploadError('Image is too large. Maximum is 8 MB.', 413, 'VIDEO_UPLOAD_TOO_LARGE')
    : new VideoUploadError('Video is too large. Maximum is 2GB.', 413, 'VIDEO_UPLOAD_TOO_LARGE');
}

export function parseMintBody(body: unknown): { contentType: UploadContentType; sizeBytes: number } {
  if (!isRecord(body)) {
    throw new VideoUploadError('A JSON body with contentType and sizeBytes is required.', 400, 'VIDEO_UPLOAD_INVALID_BODY');
  }
  const { contentType, sizeBytes } = body;
  if (
    typeof contentType !== 'string' ||
    !(UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    throw new VideoUploadError(UPLOAD_CONTENT_TYPE_MESSAGE, 400, 'VIDEO_UPLOAD_INVALID_CONTENT_TYPE');
  }
  const declared = contentType as UploadContentType;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new VideoUploadError('sizeBytes must be a positive integer.', 400, 'VIDEO_UPLOAD_INVALID_SIZE');
  }
  if (sizeBytes > maxUploadBytes(declared)) throw tooLarge(declared);
  return { contentType: declared, sizeBytes };
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
  input: { contentType: UploadContentType; sizeBytes: number },
  now: Date,
): Promise<MintedVideoUpload> {
  try {
    await sweepExpiredVideoUploads(store, storage, now);
  } catch {
  }
  const id = randomUUID();
  const storagePath = `${userId}/direct-uploads/${id}.${EXTENSIONS[input.contentType]}`;
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
    await store.deleteUpload(id);
    throw new VideoUploadError('Could not create the signed upload URL.', 502, 'VIDEO_UPLOAD_SIGN_FAILED');
  }
  return {
    uploadId: id,
    signedUrl: data.signedUrl,
    token: data.token,
    storagePath,
    expiresAt,
    maxBytes: maxUploadBytes(input.contentType),
  };
}

async function loadOwnedUpload(store: VideoUploadStore, userId: string, uploadId: string): Promise<VideoUploadRow> {
  const row = await store.getUpload(uploadId);
  if (row === null || row.user_id !== userId) {
    throw new VideoUploadError('Video upload not found.', 404, 'VIDEO_UPLOAD_NOT_FOUND');
  }
  return row;
}

async function discardObject(storage: VideoUploadStorage, path: string): Promise<void> {
  try {
    await storage.remove([path]);
  } catch {
  }
}

async function keepScheduledUpload(store: VideoUploadStore, id: string, slotAt: string, now: Date): Promise<void> {
  const base = Math.max(Date.parse(slotAt), now.getTime());
  const expiresAt = new Date(base + SCHEDULED_UPLOAD_EXPIRY_MS).toISOString();
  await store.updateUpload(id, 'ready', { expires_at: expiresAt });
}

export async function sweepExpiredVideoUploads(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  now: Date,
  limit: number = VIDEO_UPLOAD_SWEEP_LIMIT,
): Promise<number> {
  const expired = await store.listExpired(now, limit);
  const liveSlotTimes = await store.listLiveSlotTimes(expired.map((row) => row.id));
  let removed = 0;
  for (const row of expired) {
    const slotAt = liveSlotTimes.get(row.id);
    if (slotAt !== undefined) {
      await keepScheduledUpload(store, row.id, slotAt, now);
      continue;
    }
    try {
      const { error } = await storage.remove([row.storage_path]);
      if (error !== null) continue;
      await store.deleteUpload(row.id);
      removed += 1;
    } catch {
    }
  }
  return removed;
}

async function rejectIfExpired(storage: VideoUploadStorage, row: VideoUploadRow, now: Date): Promise<void> {
  if (Date.parse(row.expires_at) <= now.getTime()) {
    await discardObject(storage, row.storage_path);
    throw new VideoUploadError('This video upload has expired. Mint a new one.', 410, 'VIDEO_UPLOAD_EXPIRED');
  }
}

async function downloadVerifiedMedia(
  storage: VideoUploadStorage,
  row: VideoUploadRow,
): Promise<{ buffer: Buffer; detectedType: UploadContentType }> {
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
  const magic = detectMagicMimeType(buffer);
  const detected = (UPLOAD_CONTENT_TYPES as readonly (string | null)[]).includes(magic) ? (magic as UploadContentType) : null;
  if (detected === null) {
    return refuse('The uploaded file is not an MP4 or MOV video, or a JPEG or PNG image.', 400, 'VIDEO_UPLOAD_CONTENT_UNRECOGNIZED');
  }
  if (buffer.length > maxUploadBytes(detected)) {
    const error = tooLarge(detected);
    return refuse(error.message, error.status, error.code);
  }
  if (row.declared_content_type !== null && row.declared_content_type !== detected) {
    return refuse('The uploaded video content does not match the declared content type.', 400, 'VIDEO_UPLOAD_TYPE_MISMATCH');
  }
  return { buffer, detectedType: detected };
}

export interface CompletedVideoUpload {
  uploadId: string;
  status: 'ready';
  contentType: UploadContentType;
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
    return {
      uploadId: row.id,
      status: 'ready',
      contentType: (row.detected_content_type ?? row.declared_content_type ?? 'video/mp4') as UploadContentType,
      sizeBytes: row.size_bytes ?? 0,
    };
  }
  const { buffer, detectedType } = await downloadVerifiedMedia(storage, row);
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
  contentType: UploadContentType;
}

export function assertUploadFitsProviders(row: VideoUploadRow, providers: readonly string[]): void {
  if (!isImageUploadContentType(row.detected_content_type ?? row.declared_content_type)) return;
  const videoOnly = providers.filter((provider) => !isImageProvider(provider));
  if (videoOnly.length === 0) return;
  throw new VideoUploadError(
    `This upload is an image: ${videoOnly.join(', ')} publish${videoOnly.length === 1 ? 'es' : ''} video only. Images go to ${IMAGE_PROVIDERS.join(', ')}.`,
    400,
    'IMAGE_PROVIDER_UNSUPPORTED',
  );
}

export async function claimUploadForPublish(
  store: VideoUploadStore,
  storage: VideoUploadStorage,
  userId: string,
  uploadId: string,
  now: Date,
  providers: readonly string[],
): Promise<ClaimedVideoUpload> {
  const row = await loadOwnedUpload(store, userId, uploadId);
  if (row.status === 'consumed') {
    throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  await rejectIfExpired(storage, row, now);
  if (row.status === 'pending') {
    throw new VideoUploadError('This video upload is not completed yet. Complete it before publishing.', 409, 'VIDEO_UPLOAD_NOT_READY');
  }
  assertUploadFitsProviders(row, providers);
  const { buffer, detectedType } = await downloadVerifiedMedia(storage, row);
  const updated = await store.updateUpload(row.id, 'ready', {
    status: 'consumed',
    consumed_at: now.toISOString(),
  });
  if (!updated) {
    throw new VideoUploadError('This video upload was already used to publish.', 409, 'VIDEO_UPLOAD_CONSUMED');
  }
  return { row: { ...row, status: 'consumed', consumed_at: now.toISOString() }, buffer, contentType: detectedType };
}

interface QueryError {
  message: string;
}

export function createSupabaseVideoUploadStore(): VideoUploadStore {
  const supabase = createSupabaseServiceClient();
  const table = () =>
    supabase.from('video_uploads' as never) as unknown as {
      insert: (values: Record<string, unknown>) => Promise<{ error: QueryError | null }>;
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: VideoUploadRow | null; error: QueryError | null }>;
        };
        lte: (column: string, value: string) => {
          in: (column: string, values: readonly string[]) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (count: number) => Promise<{
                data: Array<Pick<VideoUploadRow, 'id' | 'storage_path'>> | null;
                error: QueryError | null;
              }>;
            };
          };
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
    async listLiveSlotTimes(uploadIds) {
      return listLiveUploadSlotTimes(supabase, uploadIds);
    },
    async listExpired(now, limit) {
      const { data, error } = await table()
        .select('id, storage_path')
        .lte('expires_at', now.toISOString())
        .in('status', ['pending', 'ready'])
        .order('expires_at', { ascending: true })
        .limit(limit);
      if (error !== null) throw new Error(`Failed to list expired video uploads: ${error.message}`);
      return data ?? [];
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
