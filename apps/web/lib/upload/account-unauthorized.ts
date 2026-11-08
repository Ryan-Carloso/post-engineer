import { trackApiEvent } from '../analytics';
import type { SocialProvider } from '../providers/registry';

//---------------
// publish_account_unauthorized — one connected account was rejected by its
// provider while publishing (expired or revoked token). The generic
// "one account failed" warning only says "Unauthorized"; this event names
// the provider and the account that needs reconnecting, so PostHog can list
// the broken ones. Sends ids only — never the token or the provider body.
//---------------

export const PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT = 'publish_account_unauthorized';

function numericField(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null || !(key in source)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

//---------------
// httpStatusOf — the HTTP status a provider SDK error carries, whichever shape
// it uses (axios `response.status`, gaxios/Google `code`/`status`, our own
// InstagramApiError `statusCode`).
//---------------
export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = 'response' in error ? (error as { response?: unknown }).response : undefined;
  return (
    numericField(response, 'status') ??
    numericField(error, 'status') ??
    numericField(error, 'statusCode') ??
    numericField(error, 'code')
  );
}

export function isUnauthorizedError(error: unknown): boolean {
  if (httpStatusOf(error) === 401) return true;
  if (isBlueskyInvalidCredentials(error)) return true;
  return error instanceof Error && /^unauthorized$/i.test(error.message.trim());
}

//---------------
// isBlueskyInvalidCredentials — Bluesky never carries a numeric 401: a dead
// app password surfaces as BlueskyError code 'invalid_credentials' (the
// AT Protocol login rejects it, loginToBlueskySession rethrows it as-is).
// A stored credential that no longer authenticates is exactly the account
// that needs reconnecting, so it counts as unauthorized here. Duck-typed
// (name + code) so this leaf stays free of the Bluesky client import.
//---------------
function isBlueskyInvalidCredentials(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.name === 'BlueskyError' && record.code === 'invalid_credentials';
}

export function reportAccountUnauthorized(
  provider: SocialProvider,
  accountId: string,
  ownerUserId: string,
  error: unknown,
): void {
  if (!isUnauthorizedError(error)) return;
  trackApiEvent(PUBLISH_ACCOUNT_UNAUTHORIZED_EVENT, {
    provider,
    account_id: accountId,
    user_id: ownerUserId,
    status: httpStatusOf(error) ?? 401,
  });
}
