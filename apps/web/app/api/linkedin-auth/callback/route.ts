import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

//---------------
// getSessionUserId — session user_id or null
//---------------
async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user.id;
}

//---------------
// GET /api/linkedin-auth/callback — exchanges code for an access token (60d),
// fetches the member profile AND the organization pages where they are admin,
// and persists ALL of them as provider='linkedin' accounts (one row per account,
// member and organizations separate — each is its own posting target).
// ALWAYS returns the popup HTML (oauthPopupResponse).
//---------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const state = searchParams.get('state');

  // Direct error from LinkedIn (e.g.: user denied permissions)
  if (error) {
    return oauthPopupResponse('linkedin-oauth-error', {
      error: `LinkedIn OAuth error: ${error}`,
      detail: errorDescription,
    });
  }

  if (!code) {
    return oauthPopupResponse('linkedin-oauth-error', {
      error: 'Missing authorization code',
    });
  }

  // Step 1+2: callback auth — web flow (session + httpOnly nonce cookie)
  // or MCP fallback (state stored server-side via POST /api/account/connect-url).
  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await getSessionUserId(),
    () => createSupabaseServiceClient(),
    'linkedin'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('linkedin-oauth-error', { error: callbackAuth.error });
  }
  const userId = callbackAuth.userId;

  // Step 3: exchange code for access token
  let accessToken: string;
  let expiresIn: number;
  try {
    const { exchangeLinkedInCodeForToken } = await import('@/lib/linkedin');
    const token = await exchangeLinkedInCodeForToken(code, callbackAuth.redirectUri);
    accessToken = token.access_token;
    expiresIn = token.expires_in;
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    logger.error('[linkedin-auth/callback] token exchange failed', tokenErr);
    return oauthPopupResponse('linkedin-oauth-error', {
      error: `Failed to obtain LinkedIn token: ${msg}`,
    });
  }

  // Step 4: member profile
  let memberId: string;
  let memberName: string | null;
  try {
    const { fetchLinkedInMemberProfile } = await import('@/lib/linkedin');
    const profile = await fetchLinkedInMemberProfile(accessToken);
    memberId = profile.id;
    memberName = profile.name;
  } catch (profileErr) {
    const msg = profileErr instanceof Error ? profileErr.message : String(profileErr);
    logger.error('[linkedin-auth/callback] profile fetch failed', profileErr);
    return oauthPopupResponse('linkedin-oauth-error', {
      error: `Failed to fetch LinkedIn profile: ${msg}`,
    });
  }

  // Step 5: admin organizations (failure is non-blocking: can connect just the profile)
  let organizations: Array<{ id: string; name: string | null }> = [];
  try {
    const { fetchLinkedInAdminOrganizations } = await import('@/lib/linkedin');
    organizations = await fetchLinkedInAdminOrganizations(accessToken);
  } catch (orgsErr) {
    const msg = orgsErr instanceof Error ? orgsErr.message : String(orgsErr);
    logger.error('[linkedin-auth/callback] orgs fetch failed (non-blocking)', msg);
  }

  // Step 6: persist member + organizations
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  try {
    // MCP (no browser session): persists with service role, owner = userId
    // resolved from the state. Web: session client (RLS as the user).
    const supabase = callbackAuth.viaMcp
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    await upsertSocialAccount(supabase, {
      userId,
      provider: 'linkedin',
      providerAccountId: memberId,
      accountName: memberName,
      accountMetadata: { kind: 'member', name: memberName },
      tokens: {
        access_token: accessToken,
        token_type: 'bearer',
        expiry_date: tokenExpiresAt.getTime(),
        member_urn: `urn:li:person:${memberId}`,
      },
      tokenExpiresAt,
    });

    for (const organization of organizations) {
      await upsertSocialAccount(supabase, {
        userId,
        provider: 'linkedin',
        providerAccountId: organization.id,
        accountName: organization.name,
        accountMetadata: { kind: 'organization', name: organization.name },
        tokens: {
          access_token: accessToken,
          token_type: 'bearer',
          expiry_date: tokenExpiresAt.getTime(),
          member_urn: `urn:li:person:${memberId}`,
        },
        tokenExpiresAt,
      });
    }
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error('[linkedin-auth/callback] account save failed', dbErr);
    return oauthPopupResponse('linkedin-oauth-error', {
      error: `Failed to save account to database: ${msg}`,
    });
  }

  // Step 7: success — public data of the connected accounts
  return oauthPopupResponse('linkedin-oauth-success', {
    account: {
      memberId,
      memberName,
      organizations,
      provider: 'linkedin',
      connectedAt: Date.now(),
      lastUsed: Date.now(),
    },
  });
}
