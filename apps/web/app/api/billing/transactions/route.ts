import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { toFiniteNumber } from '@/lib/tokens';
import type { TokenTransaction } from '@/lib/token-transactions';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { parseTransactionsLimit, parseTransactionsOffset } from '@/lib/contracts/billing';

// The paging parse helpers live in the shared contract
// (shared/contracts/billing.ts) and are re-exported here so existing
// importers keep their path.
export { parseTransactionsLimit, parseTransactionsOffset } from '@/lib/contracts/billing';

//---------------
// GET /api/billing/transactions — the current user's token ledger,
// newest first, paginated.
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
// RLS already scopes session queries to the caller; the service client used
// for API keys bypasses RLS, so every query is explicitly filtered by user_id.
//---------------

//---------------
// toTransaction — maps a raw ledger row to the public response shape.
// numeric amounts arrive as strings via PostgREST; coerce to number.
//---------------
function toTransaction(row: {
  id: unknown;
  amount: unknown;
  type: unknown;
  description: unknown;
  reason: unknown;
  generation_id: unknown;
  created_at: unknown;
}): TokenTransaction {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    amount: toFiniteNumber(row.amount, 0),
    type: typeof row.type === 'string' ? row.type : 'unknown',
    description: typeof row.description === 'string' ? row.description : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    generationId: typeof row.generation_id === 'string' ? row.generation_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const userId = auth.userId;
  // OAuth (MCP) callers have no cookie session, so like API keys they
  // must use the service client — the server client would silently
  // return zero rows through RLS.
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const searchParams = request ? new URL(request.url).searchParams : null;
  const limit = parseTransactionsLimit(searchParams?.get('limit') ?? null);
  const offset = parseTransactionsOffset(searchParams?.get('offset') ?? null);

  try {
    const { count, error: countError } = await supabase
      .from('token_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (countError) throw countError;

    const { data, error: rowsError } = await supabase
      .from('token_transactions')
      .select('id, amount, type, description, reason, generation_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (rowsError) throw rowsError;

    const rows = (data ?? []) as Array<{
      id: unknown;
      amount: unknown;
      type: unknown;
      description: unknown;
      reason: unknown;
      generation_id: unknown;
      created_at: unknown;
    }>;

    return NextResponse.json({
      success: true,
      transactions: rows.map(toTransaction),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (queryError) {
    logger.error('[api/billing/transactions] ledger query failed', queryError, { userId });
    return NextResponse.json(
      { success: false, error: 'Could not load token transactions.' },
      { status: 500 },
    );
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/billing/transactions', getHandler, { getUserId: resolveReportingUserId });
