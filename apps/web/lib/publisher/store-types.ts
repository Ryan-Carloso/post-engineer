import type { PublishSlot } from '@/lib/publisher/types';

export interface VideoUploadRecord {
  id: string;
  user_id: string;
  status: string;
  storage_path: string | null;
  declared_content_type: string | null;
  detected_content_type: string | null;
  consumed_at: string | null;
}

export interface ExpiredSlot {
  id: string;
  userId: string | null;
  mediaKind: string | null;
  mediaRef: string | null;
}

export class StorageNotFoundError extends Error {
  constructor(bucket: string) {
    super(`storage object not found in ${bucket}`);
    this.name = 'StorageNotFoundError';
  }
}

export interface PublisherStore {
  claimNextSlot(now: Date, leaseSeconds: number): Promise<PublishSlot | null>;
  expireInactiveReadySlots(now: Date): Promise<ExpiredSlot[]>;
  personaBoundAccounts(personaId: string): Promise<Record<string, string[]>>;
  updateSlot(slotId: string, fields: Record<string, unknown>): Promise<void>;
  getSlotMediaClaimedAt(slotId: string): Promise<string | null>;
  getVideoUpload(uploadId: string): Promise<VideoUploadRecord | null>;
  claimVideoUpload(uploadId: string, now: Date): Promise<VideoUploadRecord | null>;
  downloadStorageObject(bucket: string, path: string): Promise<Uint8Array<ArrayBuffer>>;
  removeStorageObject(bucket: string, path: string): Promise<boolean>;
}
