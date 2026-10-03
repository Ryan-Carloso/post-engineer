//---------------
// Tests for the refund review card (admin UI).
//
// Pins the approve/reject wiring: the right payload goes to the API,
// pending state disables the buttons, and failures surface visibly.
//---------------

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { RefundReviewCard } from '../review-card';

const REVIEW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-uuid-1',
  kind: 'stuck_generation',
  ref_id: 'gen-stuck-1',
  tokens: 2,
  evidence: { engine_outcome: 'alive', engine_task_id: 'task-1' },
  status: 'pending',
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe('RefundReviewCard', () => {
  it('renders the generation id and the evidence', () => {
    render(<RefundReviewCard review={REVIEW} />);
    expect(screen.getByText('gen-stuck-1')).toBeInTheDocument();
    expect(screen.getByText(/alive/)).toBeInTheDocument();
  });

  it('approve posts the decision and shows success', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    render(<RefundReviewCard review={REVIEW} />);
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/refund-reviews',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: REVIEW.id, decision: 'approve' }),
        }),
      );
    });
    expect(await screen.findByText(/approved/i)).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('reject posts the decision with the operator note', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    render(<RefundReviewCard review={REVIEW} />);
    await user.type(screen.getByLabelText(/note/i), 'video was delivered');
    await user.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/refund-reviews',
        expect.objectContaining({
          body: JSON.stringify({
            id: REVIEW.id,
            decision: 'reject',
            note: 'video was delivered',
          }),
        }),
      );
    });
  });

  it('disables both buttons while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<RefundReviewCard review={REVIEW} />);
    await user.click(screen.getByRole('button', { name: /approve/i }));

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({ success: true }) });
    await screen.findByText(/approved/i);
  });

  it('surfaces an error when the API fails and re-enables the buttons', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'Refund failed.' }),
    });

    render(<RefundReviewCard review={REVIEW} />);
    await user.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/refund failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).not.toBeDisabled();
  });
});
