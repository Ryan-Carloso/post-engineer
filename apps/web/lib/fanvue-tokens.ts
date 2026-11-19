import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import {
  getSocialAccountTokens,
  updateSocialAccountTokens,
} from '@/lib/social-accounts';
import { refreshFanvueAccessToken } from '@/lib/fanvue';
import { FanvueError } from '@/lib/errors';

export async function getValidFanvueAccessToken(
  supabase: SupabaseClient<Database>,
  ownerUserId: string,
  accountId: string,
): Promise<string> {
  const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'fanvue', accountId);
  const accessToken = tokens.access_token;

  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new FanvueError('FANVUE_TOKEN_FAILED: Fanvue token not found', 401);
  }

  if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
    if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
      throw new FanvueError('FANVUE_TOKEN_FAILED: Fanvue token expired. Please reconnect the account.', 401);
    }
    const refreshed = await refreshFanvueAccessToken(tokens.refresh_token);
    await updateSocialAccountTokens(supabase, ownerUserId, 'fanvue', accountId, {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      token_type: refreshed.token_type,
      expiry_date: Date.now() + refreshed.expires_in * 1000,
    });
    return refreshed.access_token;
  }

  return accessToken;
}
