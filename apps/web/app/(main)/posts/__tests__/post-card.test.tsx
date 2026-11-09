import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';

//---------------
// Tests for PostCard (the slot card under the posts calendar).
// i18n echoes keys; next/image renders a plain <img>.
//---------------

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

import { PostCard } from '../post-card';

const FAILED_SLOT: ScheduledSlot = {
  id: 'f1',
  scheduleId: 's1',
  slotAt: '2030-06-01T10:00:00.000Z',
  status: 'failed',
  title: 'Failed topic',
  error: 'Upload failed',
  publishedAt: null,
  taskId: null,
  progress: 0,
  stage: null,
  queuePosition: null,
  queueTotal: null,
  retryable: true,
};

function renderCard(slot: ScheduledSlot) {
  render(<PostCard slot={slot} personaName="Viva Leve" accounts={[]} locale="en" />);
}

describe('PostCard retry', () => {
  it('shows a Try again link to the post detail on a failed card that can be retried', () => {
    renderCard(FAILED_SLOT);

    const retry = screen.getByRole('link', { name: 'posts.cardRetry' });
    expect(retry).toHaveAttribute('href', '/posts/f1');
  });

  it('shows no Try again link on a failed card that cannot be retried', () => {
    renderCard({ ...FAILED_SLOT, retryable: false });

    expect(screen.queryByRole('link', { name: 'posts.cardRetry' })).not.toBeInTheDocument();
  });

  it('shows no Try again link when retryable is unknown', () => {
    renderCard({ ...FAILED_SLOT, retryable: null });

    expect(screen.queryByRole('link', { name: 'posts.cardRetry' })).not.toBeInTheDocument();
  });

  it('shows no Try again link on a published card', () => {
    renderCard({
      ...FAILED_SLOT,
      status: 'published',
      title: 'Published topic',
      error: null,
      publishedAt: '2030-06-01T10:05:00.000Z',
    });

    expect(screen.queryByRole('link', { name: 'posts.cardRetry' })).not.toBeInTheDocument();
  });

  it('keeps the card itself linked to the post detail', () => {
    renderCard(FAILED_SLOT);

    expect(screen.getByRole('link', { name: /Failed topic/ })).toHaveAttribute('href', '/posts/f1');
  });
});
