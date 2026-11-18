//---------------
// What route.ts hands to the scheduled and ASAP branches once the request
// is validated, the accounts resolved, and the media verified. Kept in its
// own module so asap.ts and route.ts share it without importing each other.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import type { VideoUploadRow } from '@/lib/videos/signed-upload';
import type { Provider } from '../../videos/generate-and-schedule/providers-validation';
import type { EngineTaskRecord } from './media-resolve';
import type { ExistingMediaFormFields } from './publish-form';
import type { ImageContentType, PublishExistingRequest } from './schema';

export interface PublishExistingContext {
  /** The route label for error responses (route.ts owns the literal). */
  route: string;
  supabase: SupabaseClient;
  userId: string;
  request: Request;
  input: PublishExistingRequest;
  accountIds: Record<Provider, string[]>;
  /** Null unless one of the accounts' stored logins is already dead: the slot still schedules, and the response warns. */
  reconnectWarning: AccountNeedsReconnectWarning | null;
  taskRecord: EngineTaskRecord | null;
  uploadRow: VideoUploadRow | null;
  image: { buffer: Buffer; contentType: ImageContentType } | null;
  logId: string;
  startTime: number;
}

/** The publish form fields for one provider and the accounts it publishes to. */
export function fieldsFor(
  input: PublishExistingRequest,
  provider: Provider,
  accountIds: string[],
): ExistingMediaFormFields {
  const caption = input.caption?.trim() ? input.caption.trim() : input.description;
  return {
    title: input.title,
    description: input.description,
    caption,
    tags: input.tags ?? [],
    privacyStatus: input.privacyStatus ?? 'public',
    boardId: input.publishing.pinterestBoardId ?? '',
    accountIds,
  };
}
