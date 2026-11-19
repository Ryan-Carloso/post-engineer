import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';
import {
  getSocialAccountTokens,
  updateSocialAccountTokens,
} from '@/lib/social-accounts';
import { refreshPinterestAccessToken } from '@/lib/pinterest';
import { PinterestError } from '@/lib/errors';

export async function getValidPinterestAccessToken(
  supabase: SupabaseClient<Database>,
  ownerUserId: string,
  accountId: string,
): Promise<string> {
  const { tokens } = await getSocialAccountTokens(supabase, ownerUserId, 'pinterest', accountId);
  const accessToken = tokens.access_token;

  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new PinterestError('PINTEREST_TOKEN_FAILED: Pinterest token not found', 401);
  }

  if (typeof tokens.expiry_date === 'number' && Date.now() >= tokens.expiry_date) {
    if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
      throw new PinterestError('PINTEREST_TOKEN_FAILED: Pinterest token expired. Please reconnect the account.', 401);
    }
    const refreshed = await refreshPinterestAccessToken(tokens.refresh_token);
    await updateSocialAccountTokens(supabase, ownerUserId, 'pinterest', accountId, {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      token_type: refreshed.token_type,
      expiry_date: Date.now() + refreshed.expires_in * 1000,
    });
    return refreshed.access_token;
  }

  return accessToken;
}
