import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountNeedsReconnectWarning } from '@/lib/account-needs-reconnect';
import type { VideoUploadRow } from '@/lib/videos/signed-upload';
import type { Provider } from './providers-validation';
import type { ExistingMediaFormFields } from './publish-form';
import type { ImageContentType, PublishExistingRequest } from './schema';

export interface PublishExistingContext {
  aiLabel: boolean;
  route: string;
  supabase: SupabaseClient;
  userId: string;
  request: Request;
  input: PublishExistingRequest;
  accountIds: Record<Provider, string[]>;
  reconnectWarning: AccountNeedsReconnectWarning | null;
  uploadRow: VideoUploadRow | null;
  image: { buffer: Buffer; contentType: ImageContentType } | null;
  logId: string;
  startTime: number;
}

export function fieldsFor(
  input: PublishExistingRequest,
  provider: Provider,
  accountIds: string[],
  aiLabel = false,
): ExistingMediaFormFields {
  const caption = input.caption?.trim() ? input.caption.trim() : input.description;
  return {
    title: input.title,
    description: input.description,
    caption,
    tags: input.tags ?? [],
    privacyStatus: input.privacyStatus ?? 'public',
    boardId: input.publishing.pinterestBoardId ?? '',
    aiLabel,
    accountIds,
  };
}
