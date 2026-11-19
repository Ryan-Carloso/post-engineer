import 'server-only';

import { logger } from '@/lib/logger';
import type { SocialProvider } from '@/lib/providers/registry';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export const ACCOUNT_NEEDS_RECONNECT_WARNING_CODE = 'account_needs_reconnect' as const;

export interface ReconnectAccountRef {
  provider: string;
  accountId: string;
}

export interface AccountNeedsReconnectWarning {
  code: typeof ACCOUNT_NEEDS_RECONNECT_WARNING_CODE;
  accounts: ReconnectAccountRef[];
}

export function accountNeedsReconnectWarning(
  accounts: ReconnectAccountRef[],
): AccountNeedsReconnectWarning | null {
  if (accounts.length === 0) return null;
  return { code: ACCOUNT_NEEDS_RECONNECT_WARNING_CODE, accounts };
}

export async function markAccountNeedsReconnect(
  userId: string,
  provider: SocialProvider,
  providerAccountId: string,
): Promise<void> {
  try {
    const { error } = await createSupabaseServiceClient()
      .from('social_accounts')
      .update({ needs_reconnect: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('provider_account_id', providerAccountId)
      .eq('needs_reconnect', false);
    if (error) {
      logger.error('[ACCOUNT] Failed to mark needs_reconnect', new Error(error.message), {
        userId,
        provider,
        providerAccountId,
      });
    }
  } catch (error) {
    logger.error(
      '[ACCOUNT] Failed to mark needs_reconnect',
      error instanceof Error ? error : new Error('Failed to mark needs_reconnect'),
      { userId, provider, providerAccountId },
    );
  }
}
