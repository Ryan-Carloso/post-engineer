//---------------
// PostHog events for account profile reads (name + picture), on connect and
// on the 24h resync. They answer "why does this card show no name/photo?"
// without server logs: whether the provider returned a name and a picture,
// which host the picture lives on (next/image only loads allowed hosts),
// and why a read failed. Never sends the name, the URL or the token.
//---------------

import { trackApiEvent } from './analytics';
import type { SocialProvider } from './providers/registry';

export const ACCOUNT_PROFILE_FETCHED_EVENT = 'account_profile_fetched';
export const ACCOUNT_PROFILE_FETCH_FAILED_EVENT = 'account_profile_fetch_failed';

export type AccountProfileTrigger = 'connect' | 'sync';

export interface ProfileSnapshot {
  accountName: string | null;
  pictureUrl: string | null;
}

export function pictureHost(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid_url';
  }
}

export function reportProfileFetched(
  provider: SocialProvider,
  trigger: AccountProfileTrigger,
  fetched: ProfileSnapshot,
  previous?: ProfileSnapshot,
): void {
  const properties: Record<string, unknown> = {
    provider,
    trigger,
    has_name: fetched.accountName !== null && fetched.accountName !== '',
    has_picture: fetched.pictureUrl !== null && fetched.pictureUrl !== '',
    picture_host: pictureHost(fetched.pictureUrl),
  };
  if (previous !== undefined) {
    properties.name_changed = fetched.accountName !== null && fetched.accountName !== previous.accountName;
    properties.picture_changed = fetched.pictureUrl !== null && fetched.pictureUrl !== previous.pictureUrl;
  }
  trackApiEvent(ACCOUNT_PROFILE_FETCHED_EVENT, properties);
}

// Stable code from errors shaped "CODE: detail" (ThreadsError, LinkedinError,
// BlueskyProfileError); the free-text detail is not sent.
export function profileErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'non_error_thrown';
  const match = /^([A-Z][A-Z0-9_]{2,}):/.exec(error.message);
  return match === null ? error.name : match[1];
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const value of [record.status, record.statusCode, record.code]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return null;
}

export function reportProfileFetchFailed(
  provider: SocialProvider,
  trigger: AccountProfileTrigger,
  error: unknown,
): void {
  trackApiEvent(ACCOUNT_PROFILE_FETCH_FAILED_EVENT, {
    provider,
    trigger,
    error_code: profileErrorCode(error),
    error_status: errorStatus(error),
  });
}
