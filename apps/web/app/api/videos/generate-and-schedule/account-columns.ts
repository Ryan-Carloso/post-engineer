//---------------
// account-columns — the per-provider account-id column of public.schedules.
// One map for every reader (experiment-link compares a partner schedule's
// columns) and writer (the route's schedule insert), so a new provider is a
// one-line change here instead of a hand-written key in each file.
//---------------

import type { Provider } from './providers-validation';

export const PROVIDER_ACCOUNT_COLUMNS = {
  youtube: 'youtube_account_ids',
  instagram: 'instagram_account_ids',
  linkedin: 'linkedin_account_ids',
  bluesky: 'bluesky_account_ids',
  threads: 'threads_account_ids',
  facebook: 'facebook_account_ids',
  pinterest: 'pinterest_account_ids',
  rumble: 'rumble_account_ids',
} as const satisfies Record<Provider, string>;

export type ScheduleAccountColumns = {
  [P in Provider as (typeof PROVIDER_ACCOUNT_COLUMNS)[P]]: string[];
};

// Every column is written, empty when the provider is not targeted: the
// insert must not leave a column to its default by omission.
export function scheduleAccountColumns(
  accountIds: Partial<Record<Provider, string[]>>,
): ScheduleAccountColumns {
  return {
    youtube_account_ids: accountIds.youtube ?? [],
    instagram_account_ids: accountIds.instagram ?? [],
    linkedin_account_ids: accountIds.linkedin ?? [],
    bluesky_account_ids: accountIds.bluesky ?? [],
    threads_account_ids: accountIds.threads ?? [],
    facebook_account_ids: accountIds.facebook ?? [],
    pinterest_account_ids: accountIds.pinterest ?? [],
    rumble_account_ids: accountIds.rumble ?? [],
  };
}
