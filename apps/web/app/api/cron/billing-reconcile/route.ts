//---------------
// POST /api/cron/billing-reconcile — daily billing reconciliation trigger.
//
// Called by the pg_cron job (see supabase/migrations/004_billing_reconcile.sql)
// with `Authorization: Bearer <CRON_SECRET>`. Runs zombie auto-refunds and
// stuck-generation detection (ambiguous cases land in refund_reviews for a
// human). Not user-facing: no rate limit, no session — the shared secret is
// the only gate, compared timing-safely.
//
// Service-role bypasses RLS: the reconcile store only touches
// billing-owned tables and re-checks ownership on every query.
//---------------

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createReconcileStore, runBillingReconciliation } from '@/lib/billing/reconcile';
import { logger } from '@/lib/logger';

function secretsEqual(provided: string, expected: string): boolean {
  // Hash both sides first so timingSafeEqual never leaks the expected
  // length and never throws on length mismatch.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('[cron/billing-reconcile] CRON_SECRET is not configured; refusing to run', null, {});
    return NextResponse.json(
      { success: false, error: 'Reconciliation is not configured.' },
      { status: 500 },
    );
  }
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secretsEqual(provided, cronSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const store = createReconcileStore(createSupabaseServiceClient());
  const report = await runBillingReconciliation(store);
  if (report.errors.length > 0) {
    logger.error('[cron/billing-reconcile] completed with errors', null, {
      errors: report.errors,
    });
  }
  return NextResponse.json({ success: true, report });
}
