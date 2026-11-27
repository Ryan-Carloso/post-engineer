import { NextRequest } from 'next/server';
import { oauthPopupResponse } from '@/lib/oauth-utils';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { sessionUserId } from '@/lib/oauth/session-user';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const state = searchParams.get('state');

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

  const callbackAuth = await resolveOAuthCallbackAuth(
    request,
    state,
    await sessionUserId(),
    () => createSupabaseServiceClient(),
    'linkedin'
  );
  if (!callbackAuth.ok) {
    return oauthPopupResponse('linkedin-oauth-error', { error: callbackAuth.error });
  }
  const userId = callbackAuth.userId;

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

  let memberId: string;
  let memberName: string | null;
  let memberPicture: string | null;
  try {
    const { fetchLinkedInMemberProfile } = await import('@/lib/linkedin');
    const profile = await fetchLinkedInMemberProfile(accessToken);
    memberId = profile.id;
    memberName = profile.name;
    memberPicture = profile.picture;
    reportProfileFetched('linkedin', 'connect', { accountName: profile.name, pictureUrl: profile.picture });
  } catch (profileErr) {
    const msg = profileErr instanceof Error ? profileErr.message : String(profileErr);
    logger.error('[linkedin-auth/callback] profile fetch failed', profileErr);
    reportProfileFetchFailed('linkedin', 'connect', profileErr);
    return oauthPopupResponse('linkedin-oauth-error', {
      error: `Failed to fetch LinkedIn profile: ${msg}`,
    });
  }

  let organizations: Array<{ id: string; name: string | null }> = [];
  try {
    const { fetchLinkedInAdminOrganizations } = await import('@/lib/linkedin');
    organizations = await fetchLinkedInAdminOrganizations(accessToken);
  } catch (orgsErr) {
    const msg = orgsErr instanceof Error ? orgsErr.message : String(orgsErr);
    logger.error('[linkedin-auth/callback] orgs fetch failed (non-blocking)', msg);
  }

  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  try {
    const supabase = await createSupabaseServerClient();
    const { upsertSocialAccount } = await import('@/lib/social-accounts');

    await upsertSocialAccount(supabase, {
      userId,
      provider: 'linkedin',
      providerAccountId: memberId,
      accountName: memberName,
      accountMetadata: {
        kind: 'member',
        name: memberName,
        picture: memberPicture,
        profileSyncedAt: new Date().toISOString(),
      },
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

export const GET = withApiErrorReporting('GET /api/linkedin-auth/callback', getHandler);
