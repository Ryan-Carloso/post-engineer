'use client';

//---------------
// Telegram setup guide — the "info" that walks the user through
// connecting a channel or a group: the kind picker and the steps for
// that kind (@BotFather, adding the bot with the right permission,
// finding the chat ID). Shared by the accounts screen and the
// onboarding wizard, both of which render it above the chat and token
// fields of their credential dialog.
//
// The kind matters only at connect time: a channel bot must be an
// administrator who can post, a group bot a member allowed to send.
// The picked kind is sent as chatType and checked server-side against
// the real chat (POST /api/telegram-connect).
//---------------

import type { ReactNode } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { ERROR_CODES } from '@/lib/error-codes';
import { useI18n } from '@/lib/i18n/provider';

export type TelegramChatKind = 'channel' | 'group';

/** The localized sentence for a /api/telegram-connect error code; an
 * unknown or missing code gets the generic connect error. */
export function telegramConnectErrorKey(code: unknown, kind: TelegramChatKind): TranslationKey {
  if (code === ERROR_CODES.TELEGRAM_TOKEN_REJECTED) return 'accounts.telegramErrorToken';
  if (code === ERROR_CODES.TELEGRAM_CHAT_NOT_FOUND) return 'accounts.telegramErrorChatNotFound';
  if (code === ERROR_CODES.TELEGRAM_CHAT_KIND_MISMATCH) {
    return kind === 'channel' ? 'accounts.telegramErrorIsGroup' : 'accounts.telegramErrorIsChannel';
  }
  if (code === ERROR_CODES.TELEGRAM_BOT_NOT_MEMBER) return 'accounts.telegramErrorNotMember';
  if (code === ERROR_CODES.TELEGRAM_BOT_CANNOT_POST) return 'accounts.telegramErrorCannotPost';
  return 'accounts.telegramConnectError';
}

export function TelegramSetupGuide({
  kind,
  onKindChange,
}: {
  kind: TelegramChatKind;
  onKindChange: (kind: TelegramChatKind) => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-ink-soft">{t('accounts.telegramSetupTitle')}</p>
      <div className="flex gap-2" role="radiogroup" aria-label={t('accounts.telegramSetupTitle')}>
        {(['channel', 'group'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            data-testid={`telegram-kind-${value}`}
            onClick={() => onKindChange(value)}
            className={
              kind === value
                ? 'rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-on-ink'
                : 'rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken'
            }
          >
            {t(value === 'channel' ? 'accounts.telegramKindChannel' : 'accounts.telegramKindGroup')}
          </button>
        ))}
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-5 text-muted-text">
        <li>{t('accounts.telegramSetupBotFather')}</li>
        <li>{t(kind === 'channel' ? 'accounts.telegramSetupAddChannel' : 'accounts.telegramSetupAddGroup')}</li>
        <li>{t('accounts.telegramSetupChatId')}</li>
      </ol>
    </div>
  );
}
