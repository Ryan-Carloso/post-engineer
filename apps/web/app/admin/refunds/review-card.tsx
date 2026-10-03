//---------------
// RefundReviewCard — one pending refund review with approve/reject.
//
// Client component: the decision POSTs to /api/admin/refund-reviews and
// the page refreshes to converge on the true queue state.
//---------------

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ReviewCardData {
  id: string;
  user_id: string;
  kind: string;
  ref_id: string;
  tokens: number | null;
  evidence: unknown;
  status: string;
  created_at: string;
}

type Decision = 'approve' | 'reject';

export function RefundReviewCard({ review }: { review: ReviewCardData }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function decide(decision: Decision): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/refund-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: review.id,
          decision,
          ...(decision === 'reject' && note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || body?.success !== true) {
        setError(
          typeof body?.error === 'string' && body.error.length > 0
            ? body.error
            : 'Request failed.',
        );
        return;
      }
      setDone(decision === 'approve' ? 'Approved — refund issued.' : 'Rejected.');
      router.refresh();
    } catch {
      setError('Request failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label={`review ${review.ref_id}`}>
      <h2>{review.ref_id}</h2>
      <dl>
        <dt>User</dt>
        <dd>{review.user_id}</dd>
        <dt>Kind</dt>
        <dd>{review.kind}</dd>
        <dt>Queued</dt>
        <dd>{review.created_at}</dd>
        <dt>Evidence</dt>
        <dd>
          <pre>{JSON.stringify(review.evidence, null, 2)}</pre>
        </dd>
      </dl>
      {done ? (
        <p role="status">{done}</p>
      ) : (
        <>
          <label>
            Note
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
              placeholder="operator note (required for reject context)"
            />
          </label>
          <button type="button" onClick={() => decide('approve')} disabled={pending}>
            {pending ? 'Working…' : 'Approve'}
          </button>
          <button type="button" onClick={() => decide('reject')} disabled={pending}>
            {pending ? 'Working…' : 'Reject'}
          </button>
        </>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : null}
    </section>
  );
}
