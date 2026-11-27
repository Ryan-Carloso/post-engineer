import { TelegramError } from '@/lib/errors';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
export const TELEGRAM_FILE_MAX_BYTES = 50 * 1024 * 1024;
const TELEGRAM_TIMEOUT_MS = 120_000;

export type TelegramChatType = 'channel' | 'group' | 'supergroup';

export interface TelegramBotIdentity {
  botId: number;
  botUsername: string;
}

export interface TelegramChatInfo {
  chatId: string;
  chatType: TelegramChatType;
  title: string;
  username: string | null;
}

export interface TelegramPublishResult {
  messageId: number;
  chatId: string;
}

const BOT_TOKEN_PATTERN = /^\d{8,12}:[A-Za-z0-9_-]{35}$/;

export function isValidTelegramBotToken(value: string): boolean {
  return BOT_TOKEN_PATTERN.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scrubToken(text: string, botToken: string): string {
  return text.split(botToken).join('[redacted]');
}

function codeFor(errorCode: number, description: string): TelegramError['code'] {
  const text = description.toLowerCase();
  if (errorCode === 401) return 'invalid_token';
  if (text.includes('chat not found')) return 'chat_not_found';
  if (text.includes('bot is not a member') || text.includes('bot was kicked')) return 'not_member';
  if (text.includes('not enough rights') || text.includes('forbidden')) return 'no_permission';
  return 'publish_failed';
}

export async function callBotApi(
  botToken: string,
  method: string,
  init: { form?: FormData; json?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: 'POST',
      body: init.form ?? JSON.stringify(init.json ?? {}),
      headers: init.form === undefined ? { 'content-type': 'application/json' } : undefined,
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TelegramError(
      'publish_failed',
      `TELEGRAM_REQUEST_FAILED: ${scrubToken(error instanceof Error ? error.message : String(error), botToken)}`,
      502,
    );
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!isRecord(parsed) || parsed.ok !== true) {
    const description =
      isRecord(parsed) && typeof parsed.description === 'string' ? parsed.description : `status ${response.status}`;
    const errorCode =
      isRecord(parsed) && typeof parsed.error_code === 'number' ? parsed.error_code : response.status;
    throw new TelegramError(codeFor(errorCode, description), `TELEGRAM_API_ERROR: ${scrubToken(description, botToken)}`, errorCode);
  }
  if (!isRecord(parsed.result)) {
    throw new TelegramError('publish_failed', 'TELEGRAM_API_ERROR: invalid response body', 502);
  }
  return parsed.result;
}

export async function getTelegramBot(botToken: string): Promise<TelegramBotIdentity> {
  const result = await callBotApi(botToken, 'getMe', { json: {} });
  if (typeof result.id !== 'number' || typeof result.username !== 'string') {
    throw new TelegramError('publish_failed', 'TELEGRAM_API_ERROR: invalid bot identity', 502);
  }
  return { botId: result.id, botUsername: result.username };
}

export async function getTelegramChat(botToken: string, chatId: string): Promise<TelegramChatInfo> {
  const result = await callBotApi(botToken, 'getChat', { json: { chat_id: chatId } });
  const type = result.type;
  if (type !== 'channel' && type !== 'group' && type !== 'supergroup') {
    throw new TelegramError('chat_not_found', 'TELEGRAM_API_ERROR: chat is not a channel or group', 400);
  }
  if (typeof result.id !== 'number') {
    throw new TelegramError('publish_failed', 'TELEGRAM_API_ERROR: invalid chat', 502);
  }
  return {
    chatId: String(result.id),
    chatType: type,
    title: typeof result.title === 'string' && result.title !== '' ? result.title : String(result.id),
    username: typeof result.username === 'string' && result.username !== '' ? result.username : null,
  };
}

export async function assertBotCanPost(botToken: string, chat: TelegramChatInfo, botId: number): Promise<void> {
  const member = await callBotApi(botToken, 'getChatMember', { json: { chat_id: chat.chatId, user_id: botId } });
  const status = member.status;
  if (status === 'kicked' || status === 'left') {
    throw new TelegramError('not_member', 'TELEGRAM_API_ERROR: bot is not a member of the chat', 403);
  }
  if (chat.chatType === 'channel') {
    if (status !== 'administrator' && status !== 'creator') {
      throw new TelegramError('no_permission', 'TELEGRAM_API_ERROR: bot must be an administrator of the channel', 403);
    }
    if (member.can_post_messages !== true && status !== 'creator') {
      throw new TelegramError('no_permission', 'TELEGRAM_API_ERROR: bot cannot post messages in the channel', 403);
    }
    return;
  }
  if (status === 'restricted' && member.can_send_messages !== true) {
    throw new TelegramError('no_permission', 'TELEGRAM_API_ERROR: bot cannot send messages in the group', 403);
  }
}

export interface TelegramPublishInput {
  botToken: string;
  chatId: string;
  kind: 'video' | 'photo' | 'audio';
  file: Blob;
  filename: string;
  caption: string;
}

export async function publishToTelegram(input: TelegramPublishInput): Promise<TelegramPublishResult> {
  if (input.file.size > TELEGRAM_FILE_MAX_BYTES) {
    throw new TelegramError('publish_failed', 'TELEGRAM_API_ERROR: file exceeds the 50MB Bot API limit', 413);
  }
  if (input.caption.length > TELEGRAM_CAPTION_MAX_LENGTH) {
    throw new TelegramError('publish_failed', `TELEGRAM_API_ERROR: caption exceeds the ${TELEGRAM_CAPTION_MAX_LENGTH}-character limit`, 400);
  }
  const method = input.kind === 'video' ? 'sendVideo' : input.kind === 'photo' ? 'sendPhoto' : 'sendAudio';
  const field = input.kind === 'video' ? 'video' : input.kind === 'photo' ? 'photo' : 'audio';
  const form = new FormData();
  form.append('chat_id', input.chatId);
  form.append(field, input.file, input.filename);
  if (input.caption !== '') form.append('caption', input.caption);
  if (input.kind === 'video') form.append('supports_streaming', 'true');
  const result = await callBotApi(input.botToken, method, { form });
  if (typeof result.message_id !== 'number' || !isRecord(result.chat)) {
    throw new TelegramError('publish_failed', 'TELEGRAM_API_ERROR: invalid publish response', 502);
  }
  return { messageId: result.message_id, chatId: String(result.chat.id) };
}

export function telegramPostUrl(username: string | null, messageId: number): string | null {
  if (username === null || username === '') return null;
  return `https://t.me/${username}/${messageId}`;
}
