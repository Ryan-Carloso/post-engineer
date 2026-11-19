import { SCHEDULE_ACCOUNT_COLUMNS } from '@/lib/contracts/providers';
import type { Provider } from './providers-validation';

export const PROVIDER_ACCOUNT_COLUMNS = SCHEDULE_ACCOUNT_COLUMNS;

export type ScheduleAccountColumns = {
  [P in Provider as (typeof PROVIDER_ACCOUNT_COLUMNS)[P]]: string[];
};

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
    telegram_account_ids: accountIds.telegram ?? [],
  };
}
