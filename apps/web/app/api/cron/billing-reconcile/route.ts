//---------------
// POST /api/cron/billing-reconcile — daily billing reconciliation trigger.
//
// Called by the pg_cron job (see supabase/migrations/004_billing_reconcile.sql)
// with `Authorization: Bearer <CRON_SECRET>`. Runs zombie auto-refunds and
// stuck-generation reconciliation (engine-state-verified: failed tasks
// refund with the engine's reason, completed tasks backfill, active or
// unreachable tasks auto-refund past the day limit). Fully automatic —
// every refund emits `refund_issued` as the audit trail. Not user-facing:
// no rate limit, no session — the shared secret is the only gate,
// compared timing-safely.
//
// Service-role bypasses RLS: the reconcile store only touches
// billing-owned tables and re-checks ownership on every query.
//---------------

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createReconcileStore, runBillingReconciliation } from '@/lib/billing/reconcile';
import { logger } from '@/lib/logger';
import { withApiErrorReporting } from '@/lib/api-error-reporting';
import { rejectUnauthorizedCron } from '@/lib/cron-auth';

async function postHandler(request: Request): Promise<NextResponse> {
  const rejection = rejectUnauthorizedCron(
    request,
    'cron/billing-reconcile',
    'Reconciliation is not configured.',
  );
  if (rejection !== null) return rejection;

  const store = createReconcileStore(createSupabaseServiceClient());
  const report = await runBillingReconciliation(store);
  if (report.errors.length > 0) {
    logger.error('[cron/billing-reconcile] completed with errors', null, {
      errors: report.errors,
    });
  }
  return NextResponse.json({ success: true, report });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/cron/billing-reconcile', postHandler);
