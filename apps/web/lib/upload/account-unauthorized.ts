import { trackApiEvent } from '../analytics';
import { classifyAccountBreak, httpStatusOf, isUnauthorizedError } from '../account-break';
import { logger } from '../logger';
import { notifyAccountBreak } from '../owner-alert-mail';
import type { SocialProvider } from '../providers/registry';

//---------------
// publish_account_unauthorized — one connected account was rejected by its
// provider while publishing (expired or revoked token). The generic
// "one account failed" warning only says "Unauthorized"; this event names
// the provider and the account that needs reconnecting, so PostHog can list
// the broken ones. Sends ids only — never the token or the provider body.
//
// The same call also emails the owner for every account-break class
// (unauthorized, undecryptable token, Bluesky email_not_verified).
// PostHog stays limited to isUnauthorizedError. The mailer dedupes.
//---------------

export { classifyAccountBreak, httpStatusOf, isUnauthorizedError } from '../account-break';

export const PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT = 'publish_account_unauthorized';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
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
  if (classifyAccountBreak(error) === null) return;
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
