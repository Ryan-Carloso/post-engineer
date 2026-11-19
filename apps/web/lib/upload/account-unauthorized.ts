import { trackApiEvent } from '../analytics';
import { classifyAccountBreak, httpStatusOf, isUnauthorizedError } from '../account-break';
import { markAccountNeedsReconnect } from '../account-needs-reconnect';
import { logger } from '../logger';
import { notifyAccountBreak } from '../owner-alert-mail';
import type { SocialProvider } from '../providers/registry';

export { classifyAccountBreak, httpStatusOf, isMetaInvalidToken, isUnauthorizedError } from '../account-break';

export const PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT = 'publish_account_unauthorized';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

export function rememberDeadCredential(
  provider: SocialProvider,
  accountId: string,
  ownerUserId: string,
): void {
  void markAccountNeedsReconnect(ownerUserId, provider, accountId);
}

export function reportAccountUnauthorized(
  provider: SocialProvider,
  accountId: string,
  ownerUserId: string,
  error: unknown,
): void {
  if (isUnauthorizedError(error)) {
    trackApiEvent(PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT, {
      provider,
      account_id: accountId,
      user_id: ownerUserId,
      status: httpStatusOf(error) ?? 401,
    });
  }
  const breakClass = classifyAccountBreak(error);
  if (breakClass === 'unauthorized' || breakClass === 'token_undecryptable') {
    rememberDeadCredential(provider, accountId, ownerUserId);
  }
  if (breakClass === null) return;
  const pending = notifyAccountBreak({
    userId: ownerUserId,
    provider,
    accountId,
    error,
  });
  if (pending && typeof pending.catch === 'function') {
    void pending.catch((notifyError: unknown) => {
      logger.error('[ACCOUNT] Owner alert failed', new Error(errorName(notifyError)));
    });
  }
}
