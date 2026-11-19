import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getSocialAccountTokens, touchSocialAccount } from '@/lib/social-accounts';
import {
  TELEGRAM_CAPTION_MAX_LENGTH,
  TELEGRAM_FILE_MAX_BYTES,
  publishToTelegram,
  telegramPostUrl,
} from '@/lib/telegram';
import { accountFailure } from '@/lib/upload/account-error';
import { rememberDeadCredential, reportAccountUnauthorized } from '@/lib/upload/account-unauthorized';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';

//---------------
// handleTelegramUpload — publishes to the user's Telegram chats via the
// Bot API. Channel and group/supergroup are one path: the stored
// provider_account_id is the chat_id and the caption is the title +
// description the schedule built. FormData (multipart, from the engine
// or the UI): provider=telegram, video|image|audio (File), caption,
// telegramAccountIds (repeated; chat ids).
// The stored token is the user's @BotFather bot token (see
// lib/telegram.ts): a 401 from Telegram means that token is dead and is
// reported for reconnect; a 403 means the bot lost its seat in the chat.
//---------------

interface TelegramAccountResult {
  accountId: string;
  success: boolean;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface TelegramUploadResponse {
  success: boolean;
  results: TelegramAccountResult[];
}

function rejected(error: string): TelegramUploadResponse {
  return { success: false, results: [accountFailure('', error, 'publish_rejected')] };
}

type MediaKind = 'video' | 'photo' | 'audio';

function mediaOf(file: File): { kind: MediaKind; field: string } | null {
  if (file.type.startsWith('video/')) return { kind: 'video', field: 'video' };
  if (file.type === 'image/jpeg' || file.type === 'image/png') return { kind: 'photo', field: 'image' };
  if (file.type.startsWith('audio/')) return { kind: 'audio', field: 'audio' };
  return null;
}

export async function handleTelegramUpload(
  formData: FormData,
  ownerUserId: string,
): Promise<TelegramUploadResponse> {
  const accountIds = getAccountIdsFromFormData(formData, 'telegramAccountIds');
  const captionRaw = formData.get('caption') ?? formData.get('description') ?? formData.get('title');
  const caption = typeof captionRaw === 'string' ? captionRaw.trim() : '';
  const rawFile = formData.get('video') ?? formData.get('image') ?? formData.get('audio');

  if (accountIds.length === 0) return rejected('At least one Telegram chat ID is required');
  if (!(rawFile instanceof File)) return rejected('Video, image or audio file is required');
  const media = mediaOf(rawFile);
  if (media === null) return rejected('File must be a video, a JPEG/PNG image or an audio file');
  if (rawFile.size > TELEGRAM_FILE_MAX_BYTES) return rejected('File exceeds the Telegram 50MB limit');
  if (caption.length > TELEGRAM_CAPTION_MAX_LENGTH) {
    return rejected(`Caption exceeds the Telegram ${TELEGRAM_CAPTION_MAX_LENGTH}-character limit`);
  }

  const buffer = Buffer.from(await rawFile.arrayBuffer());
  const supabase = createSupabaseServiceClient();
  const results: TelegramAccountResult[] = [];

  for (const accountId of accountIds) {
    try {
      const { tokens, account } = await getSocialAccountTokens(supabase, ownerUserId, 'telegram', accountId);
      const botToken = tokens.access_token;
      if (typeof botToken !== 'string' || botToken === '') {
        rememberDeadCredential('telegram', accountId, ownerUserId);
        results.push(accountFailure(accountId, 'Telegram bot token not found', 'token_missing'));
        continue;
      }
      const username =
        typeof account.accountMetadata.username === 'string' ? account.accountMetadata.username : null;
      const published = await publishToTelegram({
        botToken,
        chatId: accountId,
        kind: media.kind,
        file: new Blob([buffer], { type: rawFile.type }),
        filename: rawFile.name === '' ? 'file' : rawFile.name,
        caption,
      });
      await touchSocialAccount(supabase, ownerUserId, 'telegram', accountId);
      const url = telegramPostUrl(username, published.messageId);
      results.push({
        accountId,
        success: true,
        postId: String(published.messageId),
        ...(url === null ? {} : { permalink: url }),
      });
    } catch (error) {
      // A rejected bot token is a Telegram 401: reportAccountUnauthorized
      // classifies it as unauthorized and flags the account for reconnect.
      reportAccountUnauthorized('telegram', accountId, ownerUserId, error);
      results.push(accountFailure(accountId, error instanceof Error ? error : new Error('Unknown error')));
    }
  }

  return { success: results.some((result) => result.success), results };
}
