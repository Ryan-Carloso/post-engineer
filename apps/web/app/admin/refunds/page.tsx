//---------------
// /admin/refunds — the human side of billing reconciliation.
//
// Lists pending refund reviews (stuck generations the daily job could
// not verify). Server component; the allowlist check below is the
// authorization for the service-role queries (RLS bypass).
//---------------

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { isAdminUser } from '@/lib/admin';
import { RefundReviewCard, type ReviewCardData } from './review-card';

export default async function RefundsAdminPage() {
  const { auth } = await requireSupabaseSession();
  if (!auth || !isAdminUser(auth.userId)) {
    return (
      <main>
        <h1>Not authorized</h1>
        <p>This page is restricted to administrators.</p>
      </main>
    );
  }

  // Service-role bypasses RLS: the allowlist check above is the
  // authorization, and the projection excludes internal columns.
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('refund_reviews')
    .select('id, user_id, kind, ref_id, tokens, evidence, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return (
      <main>
        <h1>Refund reviews</h1>
        <p role="alert">Failed to load the review queue.</p>
      </main>
    );
  }

  const reviews = (data ?? []) as ReviewCardData[];

  return (
    <main>
      <h1>Refund reviews</h1>
      <p>
        Stuck video generations the daily reconciliation could not verify.
        Approve refunds the tokens; reject dismisses with a note.
      </p>
      {reviews.length === 0 ? (
        <p>No pending reviews.</p>
      ) : (
        reviews.map((review) => <RefundReviewCard key={review.id} review={review} />)
      )}
    </main>
  );
}
