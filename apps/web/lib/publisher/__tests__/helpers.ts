import { vi } from 'vitest';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@/lib/contracts/providers';
import type { PublisherStore, VideoUploadRecord } from '@/lib/publisher/store-types';
import type { PublishSchedule, PublishSlot } from '@/lib/publisher/types';

export const NOW = new Date('2026-11-27T12:00:00.000Z');
export const USER_ID = 'user-1';
export const SLOT_ID = 'slot-1';
export const UPLOAD_ID = 'upload-1';
export const PERSONA_ID = 'persona-1';

export function emptyAccountIds(): Record<SocialProvider, string[]> {
  const ids = {} as Record<SocialProvider, string[]>;
  for (const provider of SOCIAL_PROVIDERS) ids[provider] = [];
  return ids;
}

export function makeSchedule(overrides: Partial<PublishSchedule> = {}): PublishSchedule {
  return {
    id: 'schedule-1',
    userId: USER_ID,
    personaId: PERSONA_ID,
    providers: ['youtube'],
    accountIds: { ...emptyAccountIds(), youtube: ['yt-1'] },
    pinterestBoardId: null,
    personaName: 'Maya',
    aiLabel: false,
    ...overrides,
  };
}

export function makeSlot(overrides: Partial<PublishSlot> = {}): PublishSlot {
  return {
    id: SLOT_ID,
    userId: USER_ID,
    title: 'Porto in one minute',
    description: 'A short guide to Porto',
    firstComment: null,
    mediaKind: 'upload',
    mediaRef: UPLOAD_ID,
    mediaContentType: null,
    mediaClaimedAt: null,
    outcomes: [],
    attempts: 0,
    resumed: false,
    schedule: makeSchedule(),
    ...overrides,
  };
}

export function readyUpload(overrides: Partial<VideoUploadRecord> = {}): VideoUploadRecord {
  return {
    id: UPLOAD_ID,
    user_id: USER_ID,
    status: 'ready',
    storage_path: `${USER_ID}/${UPLOAD_ID}.mp4`,
    declared_content_type: 'video/mp4',
    detected_content_type: 'video/mp4',
    consumed_at: null,
    ...overrides,
  };
}

export function makeStore(overrides: Partial<PublisherStore> = {}): PublisherStore & {
  updates: Array<Record<string, unknown>>;
} {
  const updates: Array<Record<string, unknown>> = [];
  const store: PublisherStore = {
    claimNextSlot: vi.fn(async () => null),
    expireInactiveReadySlots: vi.fn(async () => []),
    personaBoundAccounts: vi.fn(async () => ({ youtube: ['yt-1', 'yt-2'], bluesky: ['bs-1'] })),
    updateSlot: vi.fn(async (_slotId: string, fields: Record<string, unknown>) => {
      updates.push(JSON.parse(JSON.stringify(fields)));
    }),
    getVideoUpload: vi.fn(async () => readyUpload()),
    claimVideoUpload: vi.fn(async (_id: string, now: Date) => readyUpload({ status: 'consumed', consumed_at: now.toISOString() })),
    downloadStorageObject: vi.fn(async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])),
    removeStorageObject: vi.fn(async () => true),
    ...overrides,
  };
  return Object.assign(store, { updates });
}
