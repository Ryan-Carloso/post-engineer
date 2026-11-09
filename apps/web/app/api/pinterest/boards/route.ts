import { NextRequest, NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { fetchPinterestBoards } from '@/lib/pinterest';
import { getValidPinterestAccessToken } from '@/lib/pinterest-tokens';
import { PinterestError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/pinterest/boards?accountId=<pinterest user id> — the boards
// one connected Pinterest account owns, for the board picker in the
// publish/schedule flow. The account id is the v5 user_account id the
// OAuth callback stored. An expired access token is refreshed from the
// stored refresh token before listing.
//---------------

async function getHandler(request: NextRequest) {
  const limited = await applyRateLimit(request, RATE_LIMITS.pinterestBoards);
  if (limited) return limited;

  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const accountId = new URL(request.url).searchParams.get('accountId');
  if (accountId === null || accountId.trim() === '') {
    return NextResponse.json({ success: false, error: 'accountId is required.' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const accessToken = await getValidPinterestAccessToken(supabase, auth.userId, accountId.trim());
    const boards = await fetchPinterestBoards(accessToken);
    return NextResponse.json({ success: true, boards });
  } catch (error) {
    if (error instanceof PinterestError) {
      logger.warn('[pinterest/boards] Pinterest request failed', { metadata: { error: error.message } });
      return NextResponse.json(
        { success: false, error: 'Failed to list Pinterest boards.' },
        { status: error.statusCode === 401 ? 401 : 502 },
      );
    }
    logger.error('[pinterest/boards] failed', error);
    return NextResponse.json({ success: false, error: 'Failed to list Pinterest boards.' }, { status: 500 });
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/pinterest/boards', getHandler, { getUserId: resolveReportingUserId });
