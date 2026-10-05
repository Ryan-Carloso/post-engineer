import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// POST /api/logout — ends the user's Supabase session.
// Social-account OAuth tokens stay encrypted in the database
// (social_accounts); this endpoint only disconnects the current session.
//---------------

async function postHandler() {
  const logId = logger.generateLogId();

  try {
    const supabase = await createSupabaseServerClient();

    // Verify user is authenticated
    const {
      data: { user },
      error: sessionError,
    } = await supabase.auth.getUser();

    if (sessionError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 },
      );
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      logger.error('Logout failed during sign-out', new Error(error.message), {
        logId,
        endpoint: '/api/logout',
        error: error.message,
      });

      return NextResponse.json(
        { success: false, error: 'Failed to sign out.' },
        { status: 500 },
      );
    }

    logger.info('Logout — Supabase session ended successfully', {
      logId,
      endpoint: '/api/logout',
    });

    return NextResponse.json({
      success: true,
      message: 'Logout successful. Your session has been ended.',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown logout error';

    logger.error('Logout failed with an unexpected error', new Error(errorMessage), {
      logId,
      endpoint: '/api/logout',
      error: errorMessage,
    });

    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/logout', postHandler);
