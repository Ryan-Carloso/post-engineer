import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { EXPIRE_BATCH_LIMIT } from '@/lib/publisher/constants';
import { redactCredentialFragments } from '@/lib/scrub';
import {
  StorageNotFoundError,
  type ExpiredSlot,
  type PublisherStore,
  type VideoUploadRecord,
} from '@/lib/publisher/store-types';
import { isRecord, optionalString, parseClaimedSlot } from '@/lib/publisher/types';

export class PublisherStoreError extends Error {
  constructor(operation: string, message: string) {
    super(`[publisher-store] ${operation} failed: ${redactCredentialFragments(message)}`);
    this.name = 'PublisherStoreError';
  }
}

function parseUpload(raw: unknown): VideoUploadRecord | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    user_id: typeof raw.user_id === 'string' ? raw.user_id : '',
    status: typeof raw.status === 'string' ? raw.status : '',
    storage_path: optionalString(raw.storage_path),
    declared_content_type: optionalString(raw.declared_content_type),
    detected_content_type: optionalString(raw.detected_content_type),
    consumed_at: optionalString(raw.consumed_at),
  };
}

function isNotFound(error: { message: string; status?: number; statusCode?: string }): boolean {
  return error.status === 404 || error.statusCode === '404' || /not found/i.test(error.message);
}

export function createPublisherStore(supabase: SupabaseClient = createSupabaseServiceClient()): PublisherStore {
  return {
    async claimNextSlot(now, leaseSeconds) {
      const { data, error } = await supabase.rpc('claim_next_publish_slot', {
        p_now: now.toISOString(),
        p_lease: `${leaseSeconds} seconds`,
      });
      if (error) throw new PublisherStoreError('claim_next_publish_slot', error.message);
      if (data === null || data === undefined) return null;
      return parseClaimedSlot(data);
    },

    async expireInactiveReadySlots(now) {
      const { data, error } = await supabase.rpc('expire_inactive_ready_slots', {
        p_now: now.toISOString(),
        p_limit: EXPIRE_BATCH_LIMIT,
      });
      if (error) throw new PublisherStoreError('expire_inactive_ready_slots', error.message);
      if (!Array.isArray(data)) return [];
      return data.filter(isRecord).flatMap((row): ExpiredSlot[] =>
        typeof row.id === 'string'
          ? [
            {
              id: row.id,
              userId: optionalString(row.user_id),
              mediaKind: optionalString(row.media_kind),
              mediaRef: optionalString(row.media_ref),
            },
          ]
          : [],
      );
    },

    async personaBoundAccounts(personaId) {
      const { data, error } = await supabase
        .from('persona_default_accounts')
        .select('provider, provider_account_id')
        .eq('persona_id', personaId);
      if (error) throw new PublisherStoreError('persona_default_accounts read', error.message);
      const bound: Record<string, string[]> = {};
      for (const row of data ?? []) {
        if (typeof row.provider !== 'string' || typeof row.provider_account_id !== 'string') continue;
        if (row.provider_account_id === '') continue;
        (bound[row.provider] ??= []).push(row.provider_account_id);
      }
      return bound;
    },

    async updateSlot(slotId, fields) {
      const { error } = await supabase.from('scheduled_posts').update(fields).eq('id', slotId);
      if (error) throw new PublisherStoreError('scheduled_posts update', error.message);
    },

    async getSlotMediaClaimedAt(slotId) {
      const { data, error } = await supabase.from('scheduled_posts').select('media_claimed_at').eq('id', slotId).maybeSingle();
      if (error) throw new PublisherStoreError('scheduled_posts read', error.message);
      if (data === null) return null;
      return typeof data.media_claimed_at === 'string' ? data.media_claimed_at : null;
    },

    async getVideoUpload(uploadId) {
      const { data, error } = await supabase.from('video_uploads').select('*').eq('id', uploadId).maybeSingle();
      if (error) throw new PublisherStoreError('video_uploads read', error.message);
      return parseUpload(data);
    },

    async claimVideoUpload(uploadId, now) {
      const { data, error } = await supabase
        .from('video_uploads')
        .update({ status: 'consumed', consumed_at: now.toISOString() })
        .eq('id', uploadId)
        .eq('status', 'ready')
        .select('*');
      if (error) throw new PublisherStoreError('video_uploads claim', error.message);
      return data === null || data.length === 0 ? null : parseUpload(data[0]);
    },

    async downloadStorageObject(bucket, path) {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error) {
        if (isNotFound(error)) throw new StorageNotFoundError(bucket);
        throw new PublisherStoreError('storage download', error.message);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async removeStorageObject(bucket, path) {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      return !error;
    },
  };
}
