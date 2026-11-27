import { logger } from '@/lib/logger';
import { UPLOADS_BUCKET, VIDEOS_BUCKET } from '@/lib/publisher/constants';
import type { SlotMedia } from '@/lib/publisher/publish-accounts';
import { scrubErrorText, errorMessageOf } from '@/lib/publisher/scrub-error';
import { StorageNotFoundError, type ExpiredSlot, type PublisherStore, type VideoUploadRecord } from '@/lib/publisher/store-types';
import type { MediaCleanup, PublishSlot } from '@/lib/publisher/types';

const UPLOAD_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export type FailPermanently = (reason: string) => Promise<void>;

export interface ResolvedMedia {
  media: SlotMedia;
  cleanup: MediaCleanup;
}

function firstNonEmpty(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null && value !== '') ?? null;
}

function slotOwnsUploadClaim(slot: PublishSlot, row: VideoUploadRecord): boolean {
  if (slot.mediaClaimedAt === null || row.consumed_at === null) return false;
  const claimedAt = Date.parse(slot.mediaClaimedAt);
  const consumedAt = Date.parse(row.consumed_at);
  return !Number.isNaN(claimedAt) && claimedAt === consumedAt;
}

export function imageCleanup(slot: Pick<PublishSlot, 'mediaKind' | 'mediaRef' | 'userId'>): MediaCleanup {
  if (slot.mediaKind !== 'image') return null;
  const ref = slot.mediaRef;
  if (ref === null || slot.userId === null) return null;
  if (!ref.startsWith(`scheduled-media/${slot.userId}/`)) return null;
  if (ref.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return { bucket: UPLOADS_BUCKET, path: ref };
}

export async function claimedUploadCleanup(
  store: PublisherStore,
  slot: PublishSlot,
  resumed: boolean,
): Promise<MediaCleanup> {
  if (!resumed || slot.mediaKind !== 'upload' || slot.mediaRef === null) return null;
  let row: VideoUploadRecord | null;
  try {
    row = await store.getVideoUpload(slot.mediaRef);
  } catch (error) {
    logger.warn('[publisher] claimed-upload lookup failed, leaving the bytes in place', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    return null;
  }
  if (row === null || row.status !== 'consumed') return null;
  if (!slotOwnsUploadClaim(slot, row)) return null;
  if (row.storage_path === null || row.storage_path === '') return null;
  return { bucket: VIDEOS_BUCKET, path: row.storage_path };
}

export async function expiredSlotCleanup(
  store: PublisherStore,
  slot: ExpiredSlot,
): Promise<MediaCleanup> {
  if (slot.mediaKind === 'image') return imageCleanup(slot);
  if (slot.mediaKind !== 'upload' || slot.mediaRef === null) return null;
  let row: VideoUploadRecord | null;
  try {
    row = await store.getVideoUpload(slot.mediaRef);
  } catch (error) {
    logger.warn('[publisher] expired slot upload lookup failed', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    return null;
  }
  if (row === null || row.user_id !== slot.userId) return null;
  if (row.storage_path === null || row.storage_path === '') return null;
  return { bucket: VIDEOS_BUCKET, path: row.storage_path };
}

export async function cleanupExistingMedia(
  store: PublisherStore,
  slotId: string,
  cleanup: MediaCleanup,
): Promise<void> {
  if (cleanup === null) return;
  const removed = await store.removeStorageObject(cleanup.bucket, cleanup.path);
  if (!removed) {
    logger.warn('[publisher] stored media could not be removed', {
      slotId,
      bucket: cleanup.bucket,
    });
  }
}

export async function resolveExistingMedia(
  store: PublisherStore,
  failPermanently: FailPermanently,
  slot: PublishSlot,
  now: Date,
  resumed: boolean,
): Promise<ResolvedMedia | null> {
  if (slot.mediaKind === 'upload') return resolveUpload(store, failPermanently, slot, now, resumed);
  if (slot.mediaKind === 'image') return resolveImage(store, failPermanently, slot);
  return null;
}

async function downloadOrDefer(
  store: PublisherStore,
  slot: PublishSlot,
  bucket: string,
  path: string,
  label: string,
  failPermanently: FailPermanently,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await store.downloadStorageObject(bucket, path);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      await failPermanently(`scheduled ${label} file is gone`);
      return null;
    }
    logger.warn(`[publisher] scheduled ${label} download failed, retrying later`, {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    return null;
  }
}

async function removeConsumedUpload(
  store: PublisherStore,
  slot: PublishSlot,
  row: VideoUploadRecord,
  expectedClaimAt: string,
): Promise<void> {
  let current: VideoUploadRecord | null;
  try {
    current = await store.getVideoUpload(row.id);
  } catch (error) {
    logger.warn('[publisher] claimed-upload lookup failed after a claim error, leaving the bytes in place', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    return;
  }
  if (current === null || current.status !== 'consumed' || current.user_id !== slot.userId) return;
  if (current.consumed_at === null || Date.parse(current.consumed_at) !== Date.parse(expectedClaimAt)) return;
  if (current.storage_path === null || current.storage_path === '') return;
  try {
    await cleanupExistingMedia(store, slot.id, { bucket: VIDEOS_BUCKET, path: current.storage_path });
  } catch (error) {
    logger.warn('[publisher] claimed-upload cleanup failed after a claim error', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
  }
}

async function claimStampMissing(store: PublisherStore, slot: PublishSlot, claimedAt: string): Promise<boolean> {
  let persisted: string | null;
  try {
    persisted = await store.getSlotMediaClaimedAt(slot.id);
  } catch (error) {
    logger.warn('[publisher] claim-stamp lookup failed after a stamp error, leaving the bytes in place', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    return false;
  }
  if (persisted === null) return true;
  const persistedAt = Date.parse(persisted);
  const claimed = Date.parse(claimedAt);
  return Number.isNaN(persistedAt) || Number.isNaN(claimed) || persistedAt !== claimed;
}

async function resolveUpload(
  store: PublisherStore,
  failPermanently: FailPermanently,
  slot: PublishSlot,
  now: Date,
  resumed: boolean,
): Promise<ResolvedMedia | null> {
  const mediaRef = slot.mediaRef;
  if (mediaRef === null) {
    await failPermanently('scheduled video upload id is missing');
    return null;
  }
  const row = await store.getVideoUpload(mediaRef);
  if (row === null || row.user_id !== slot.userId) {
    await failPermanently('scheduled video upload not found');
    return null;
  }
  const alreadyClaimed = row.status === 'consumed' && resumed && slotOwnsUploadClaim(slot, row);
  if (!alreadyClaimed && row.status !== 'ready') {
    await failPermanently('scheduled video upload is no longer ready');
    return null;
  }
  if (row.storage_path === null || row.storage_path === '') {
    await failPermanently('scheduled video upload has no stored file');
    return null;
  }
  const bytes = await downloadOrDefer(store, slot, VIDEOS_BUCKET, row.storage_path, 'upload', failPermanently);
  if (bytes === null) return null;
  let claimed: VideoUploadRecord | null;
  try {
    claimed = alreadyClaimed ? row : await store.claimVideoUpload(mediaRef, now);
  } catch (error) {
    await removeConsumedUpload(store, slot, row, now.toISOString());
    throw error;
  }
  if (claimed === null) {
    await failPermanently('scheduled video upload was already used');
    return null;
  }
  if (!alreadyClaimed && claimed.consumed_at !== null && claimed.consumed_at !== '') {
    try {
      await store.updateSlot(slot.id, { media_claimed_at: claimed.consumed_at });
    } catch (error) {
      if (await claimStampMissing(store, slot, claimed.consumed_at)) {
        await removeConsumedUpload(store, slot, row, claimed.consumed_at);
      }
      throw error;
    }
  }
  const contentType = firstNonEmpty(row.declared_content_type, row.detected_content_type) ?? 'video/mp4';
  const extension = UPLOAD_EXTENSIONS[contentType] ?? 'mp4';
  return {
    media: { name: `${mediaRef}.${extension}`, bytes, contentType },
    cleanup: { bucket: VIDEOS_BUCKET, path: row.storage_path },
  };
}

async function resolveImage(
  store: PublisherStore,
  failPermanently: FailPermanently,
  slot: PublishSlot,
): Promise<ResolvedMedia | null> {
  if (imageCleanup(slot) === null || slot.mediaRef === null) {
    await failPermanently('scheduled image path is invalid');
    return null;
  }
  const contentType = slot.mediaContentType ?? 'image/jpeg';
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const bytes = await downloadOrDefer(store, slot, UPLOADS_BUCKET, slot.mediaRef, 'image', failPermanently);
  if (bytes === null) return null;
  return { media: { name: `image.${extension}`, bytes, contentType }, cleanup: null };
}
