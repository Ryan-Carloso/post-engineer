//---------------
// account-columns — the per-provider account-id column of public.schedules.
// One map for every reader (experiment-link compares a partner schedule's
// columns) and writer (the route's schedule insert), so a new provider is a
// one-line change here instead of a hand-written key in each file.
//---------------

import { SCHEDULE_ACCOUNT_COLUMNS } from '@/lib/contracts/providers';
import type { Provider } from './providers-validation';

// The column map itself is a shared provider fact (the OpenAPI generator
// reads it too): shared/contracts/providers.ts.
export const PROVIDER_ACCOUNT_COLUMNS = SCHEDULE_ACCOUNT_COLUMNS;

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
    threespeak_account_ids: accountIds['3speak'] ?? [],
    rumble_account_ids: accountIds.rumble ?? [],
    fanvue_account_ids: accountIds.fanvue ?? [],
  };
}
