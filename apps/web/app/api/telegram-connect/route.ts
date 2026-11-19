import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { encryptTokens } from '@/lib/token-crypto';
import {
  assertBotCanPost,
  getTelegramBot,
  getTelegramChat,
  isValidTelegramBotToken,
  type TelegramChatType,
} from '@/lib/telegram';
import { TelegramError } from '@/lib/errors';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, errorMessage, formatErrorMessage, type ErrorCode } from '@/lib/error-codes';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

function errorResponse(
  status: number,
  error: string,
  route: string,
  options?: { cause?: unknown; code?: string; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, ...options });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ExpectedKind = 'channel' | 'group';

async function readCredentials(request: Request): Promise<
  | { ok: true; botToken: string; chatId: string; expected: ExpectedKind }
  | { ok: false; error: string }
> {
  let fields: Record<string, unknown>;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' };
    }
    if (!isRecord(body)) return { ok: false, error: 'Invalid JSON payload.' };
    fields = body;
  } else {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return { ok: false, error: 'Invalid multipart payload.' };
    }
    fields = {
      botToken: formData.get('botToken'),
      chatId: formData.get('chatId'),
      chatType: formData.get('chatType'),
    };
  }
  const botToken = fields.botToken;
  const chatId = fields.chatId;
  const chatType = fields.chatType;
  if (typeof botToken !== 'string' || !botToken.trim()) {
    return { ok: false, error: 'Telegram bot token is required.' };
  }
  if (typeof chatId !== 'string' || !chatId.trim()) {
    return { ok: false, error: 'Telegram chat ID or @username is required.' };
  }
  if (chatType !== 'channel' && chatType !== 'group') {
    return { ok: false, error: 'chatType must be channel or group.' };
  }
  return { ok: true, botToken: botToken.trim(), chatId: chatId.trim(), expected: chatType };
}

function kindMatches(expected: ExpectedKind, actual: TelegramChatType): boolean {
  return expected === 'channel' ? actual === 'channel' : actual === 'group' || actual === 'supergroup';
}

async function postHandler(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.telegramConnect);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return errorResponse(401, 'Authentication required.', 'POST /api/telegram-connect');
  }

  const credentials = await readCredentials(request);
  if (!credentials.ok) {
    return errorResponse(400, credentials.error, 'POST /api/telegram-connect');
  }
  const { botToken, chatId, expected } = credentials;

  if (!isValidTelegramBotToken(botToken)) {
    return errorResponse(
      400,
      'Telegram bot token must be the token @BotFather issued (for example 123456789:AA...).',
      'POST /api/telegram-connect',
    );
  }

  const supabase = createSupabaseServiceClient();

  try {
    const bot = await getTelegramBot(botToken);
    const chat = await getTelegramChat(botToken, chatId);
    if (!kindMatches(expected, chat.chatType)) {
      const actual = expected === 'channel' ? 'group' : 'channel';
      return errorResponse(
        400,
        formatErrorMessage(ERROR_CODES.TELEGRAM_CHAT_KIND_MISMATCH, { actual, expected }),
        'POST /api/telegram-connect',
        { code: ERROR_CODES.TELEGRAM_CHAT_KIND_MISMATCH },
      );
    }
    await assertBotCanPost(botToken, chat, bot.botId);

    const encrypted = encryptTokens({
      access_token: botToken,
      token_type: 'telegram_bot_token',
      bot_id: String(bot.botId),
      bot_username: bot.botUsername,
    });

    const { data: upserted, error: upsertError } = await supabase
      .from('social_accounts')
      .upsert(
        {
          user_id: auth.userId,
          provider: 'telegram',
          provider_account_id: chat.chatId,
          account_name: chat.title,
          account_metadata: {
            chatType: chat.chatType,
            username: chat.username,
            botUsername: bot.botUsername,
          },
          encrypted_tokens: encrypted,
          needs_reconnect: false,
        },
        { onConflict: 'user_id,provider,provider_account_id' },
      )
      .select('id')
      .single();

    if (upsertError || !upserted) {
      return errorResponse(500, 'Could not save the Telegram account.', 'POST /api/telegram-connect', {
        cause: upsertError,
        metadata: { userId: auth.userId },
      });
    }

    return NextResponse.json({
      success: true,
      accountId: upserted.id,
      chatId: chat.chatId,
      chatType: chat.chatType,
      title: chat.title,
    });
  } catch (error) {
    if (error instanceof TelegramError) {
      const code = telegramConnectErrorCode(error.code);
      if (code !== null) {
        const status = code === ERROR_CODES.TELEGRAM_TOKEN_REJECTED ? 422 : code === ERROR_CODES.TELEGRAM_CHAT_NOT_FOUND ? 404 : 403;
        return errorResponse(status, errorMessage(code), 'POST /api/telegram-connect', {
          cause: error,
          code,
          metadata: { userId: auth.userId },
        });
      }
    }
    return errorResponse(500, 'Could not connect the Telegram account.', 'POST /api/telegram-connect', {
      cause: error,
      metadata: { userId: auth.userId },
      logMessage: 'Telegram connection failed.',
    });
  }
}

function telegramConnectErrorCode(code: TelegramError['code']): ErrorCode | null {
  if (code === 'invalid_token') return ERROR_CODES.TELEGRAM_TOKEN_REJECTED;
  if (code === 'chat_not_found') return ERROR_CODES.TELEGRAM_CHAT_NOT_FOUND;
  if (code === 'not_member') return ERROR_CODES.TELEGRAM_BOT_NOT_MEMBER;
  if (code === 'no_permission') return ERROR_CODES.TELEGRAM_BOT_CANNOT_POST;
  return null;
}

export const POST = withApiErrorReporting('POST /api/telegram-connect', postHandler, { getUserId: resolveReportingUserId });
