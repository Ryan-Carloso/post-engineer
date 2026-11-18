import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import { decryptTokens, encryptTokens } from '@/lib/token-crypto';
import { logger } from '@/lib/logger';
import type {
  SaveRefreshedResult,
  TokenRefreshCandidate,
  TokenRefreshProvider,
  TokenRefreshStore,
} from '@/lib/social-token-refresh';

//---------------
// createTokenRefreshStore — the Supabase side of the token-refresh job.
// Service role bypasses RLS: this is a system job acting on every user's
// accounts, and every write re-checks the row's id, user_id and updated_at,
// so it only ever replaces the exact token it read.
//---------------

const CANDIDATE_COLUMNS = 'id, user_id, provider, provider_account_id, encrypted_tokens, updated_at';

function isRefreshProvider(
  value: string,
  providers: readonly TokenRefreshProvider[],
): value is TokenRefreshProvider {
  return providers.some((provider) => provider === value);
}

export function createTokenRefreshStore(supabase: SupabaseClient<Database>): TokenRefreshStore {
  return {
    async listExpiring(providers, after, before, limit) {
      const { data, error } = await supabase
        .from('social_accounts')
        .select(CANDIDATE_COLUMNS)
        .in('provider', [...providers])
        .gt('token_expires_at', after.toISOString())
        .lt('token_expires_at', before.toISOString())
        .order('token_expires_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) {
        throw new Error(`Failed to list expiring social tokens: ${error.message}`);
      }
      const candidates: TokenRefreshCandidate[] = [];
      for (const row of data ?? []) {
        if (!isRefreshProvider(row.provider, providers)) continue;
        try {
          candidates.push({
            id: row.id,
            userId: row.user_id,
            provider: row.provider,
            providerAccountId: row.provider_account_id,
            tokens: decryptTokens(row.encrypted_tokens),
            updatedAt: row.updated_at,
          });
        } catch (decryptError) {
          // One unreadable row must not stop the run. The publish path
          // reports it to the owner as token_undecryptable.
          logger.error('[token-refresh] stored token could not be decrypted', decryptError, {
            provider: row.provider,
            accountId: row.provider_account_id,
          });
        }
      }
      return candidates;
    },

    async saveRefreshed(candidate, tokens, expiresAt): Promise<SaveRefreshedResult> {
      const { data, error } = await supabase
        .from('social_accounts')
        .update({
          encrypted_tokens: encryptTokens(tokens),
          token_expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .eq('user_id', candidate.userId)
        // Check-then-act: a reconnect during the run bumps updated_at, and
        // its newer token must win over this refresh.
        .eq('updated_at', candidate.updatedAt)
        .select('id');
      if (error) {
        throw new Error(`Failed to save refreshed social token: ${error.message}`);
      }
      return (data ?? []).length === 0 ? 'row_changed' : 'saved';
    },
  };
}
