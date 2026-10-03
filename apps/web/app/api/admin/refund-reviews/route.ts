//---------------
// /api/admin/refund-reviews — human review queue for stuck generations.
//
// GET lists reviews (newest first). POST decides one:
//   { id, decision: 'approve' | 'reject', note? }
// Approve calls the idempotent refund_generation_tokens RPC and marks the
// review approved; reject marks it rejected with the operator's note.
//
// Gate: session auth + ADMIN_USER_IDS allowlist (lib/admin). The service
// client bypasses RLS; the allowlist check is the authorization, stated
// explicitly at each handler per the service-role rule.
//---------------

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isAdminUser } from '@/lib/admin';
import { REVIEW_APPROVE_REFUND_REASON } from '@/lib/billing/reconcile';
import { getPostHogServer } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';

const DecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});

interface ReviewRow {
  id: string;
  user_id: string;
  kind: string;
  ref_id: string;
  tokens: number | null;
  evidence: unknown;
  status: string;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function adminOrError(request: Request): Promise<{ userId: string } | NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError) return authError;
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  // Service-role bypasses RLS below: this allowlist check is the
  // authorization for every query in this route.
  if (!isAdminUser(auth.userId)) {
    return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 });
  }
  return { userId: auth.userId };
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  const admin = await adminOrError(request);
  if (admin instanceof NextResponse || admin instanceof Response) return admin;

  const statusParam = new URL(request.url).searchParams.get('status') ?? 'pending';
  const allowed = ['pending', 'approved', 'rejected'];
  if (statusParam !== 'all' && !allowed.includes(statusParam)) {
    return NextResponse.json({ success: false, error: 'Invalid status filter.' }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from('refund_reviews')
    .select('id, user_id, kind, ref_id, tokens, evidence, status, note, created_at, decided_at');
  if (statusParam !== 'all') query = query.eq('status', statusParam);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    logger.error('[admin/refund-reviews] list failed', error, { adminId: admin.userId });
    return NextResponse.json({ success: false, error: 'Failed to list reviews.' }, { status: 500 });
  }
  return NextResponse.json({ success: true, reviews: data ?? [] });
}

export async function POST(request: Request): Promise<NextResponse | Response> {
  const admin = await adminOrError(request);
  if (admin instanceof NextResponse || admin instanceof Response) return admin;

  const parsed = DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { id, decision, note } = parsed.data;

  const supabase = createSupabaseServiceClient();
  const { data: rowData, error: fetchError } = await supabase
    .from('refund_reviews')
    .select('id, user_id, kind, ref_id, tokens, evidence, status, note, created_at, decided_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    logger.error('[admin/refund-reviews] fetch failed', fetchError, { reviewId: id });
    return NextResponse.json({ success: false, error: 'Failed to load review.' }, { status: 500 });
  }
  const row = (isRecord(rowData) ? (rowData as unknown as ReviewRow) : null);
  if (!row) {
    return NextResponse.json({ success: false, error: 'Review not found.' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `Review already ${row.status}.` },
      { status: 409 },
    );
  }

  const decidedAt = new Date().toISOString();

  if (decision === 'reject') {
    const { error: updateError } = await supabase
      .from('refund_reviews')
      .update({ status: 'rejected', note: note ?? null, decided_at: decidedAt })
      .eq('id', id);
    if (updateError) {
      logger.error('[admin/refund-reviews] reject failed', updateError, { reviewId: id });
      return NextResponse.json({ success: false, error: 'Failed to reject review.' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // Approve: the money move. The RPC is idempotent; refunded=false means a
  // previous run already settled it (still mark approved — the operator's
  // decision stands, just without a second PostHog event).
  const { data: rpcData, error: rpcError } = await supabase.rpc('refund_generation_tokens', {
    p_user_id: row.user_id,
    p_generation_id: row.ref_id,
    p_reason: REVIEW_APPROVE_REFUND_REASON,
  });
  if (rpcError) {
    logger.error('[admin/refund-reviews] refund failed; review left pending', rpcError, {
      reviewId: id,
      generationId: row.ref_id,
    });
    return NextResponse.json({ success: false, error: 'Refund failed.' }, { status: 500 });
  }
  const refunded = isRecord(rpcData) && rpcData.refunded === true;
  const { error: updateError } = await supabase
    .from('refund_reviews')
    .update({
      status: 'approved',
      note: refunded ? (note ?? null) : `already settled; ${note ?? 'no operator note'}`,
      decided_at: decidedAt,
    })
    .eq('id', id);
  if (updateError) {
    // The tokens moved but the review row did not flip: loud log, 500 —
    // the operator must reconcile manually (the RPC will no-op on retry).
    logger.error('[admin/refund-reviews] refund landed but status update failed', updateError, {
      reviewId: id,
      generationId: row.ref_id,
    });
    return NextResponse.json(
      { success: false, error: 'Refund issued but the review could not be marked approved.' },
      { status: 500 },
    );
  }
  if (refunded) {
    // Same scrub bypass as lib/billing/reconcile: the properties are
    // closed-set (ids, counts, fixed reason) — no credentials possible —
    // and the scrubber would redact the token count this event audits.
    try {
      getPostHogServer()?.captureAs(row.user_id, 'refund_issued', {
        kind: 'refund_review',
        review_id: id,
        generation_id: row.ref_id,
        tokens: typeof row.tokens === 'number' ? row.tokens : 0,
        reason: REVIEW_APPROVE_REFUND_REASON,
      });
    } catch {
      // Telemetry must never break the decision.
    }
  }
  return NextResponse.json({ success: true });
}
