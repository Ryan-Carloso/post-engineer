import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

function renderCard(slot: ScheduledSlot, timeOnly = false) {
  render(<PostCard slot={slot} personaName="Viva Leve" accounts={[]} locale="en" timeOnly={timeOnly} />);
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

describe('PostCard failure', () => {
  it('puts the failure reason and its Try again action together in one red box', () => {
    renderCard(FAILED_SLOT);

    const message = screen.getByText('posts.cardFailedRetryable');
    const box = message.closest('div');
    if (box === null) throw new Error('failure box not rendered');
    expect(box.className.split(/\s+/)).toContain('bg-destructive-soft');
    expect(within(box).getByRole('link', { name: 'posts.cardRetry' })).toBeInTheDocument();
  });

  it('shows the permanent failure copy, with no action, when the post cannot be retried', () => {
    renderCard({ ...FAILED_SLOT, retryable: false });

    const box = screen.getByText('posts.cardFailedPermanent').closest('div');
    expect(box?.querySelector('a')).toBeNull();
  });
});

describe('PostCard header and media', () => {
  it('shows the full date with the time by default (history list)', () => {
    renderCard({ ...FAILED_SLOT, status: 'awaiting', slotAt: '2030-06-01T10:00:00.000Z' });

    expect(screen.getByText(/2030 · \d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('shows only the time when the day list already names the date', () => {
    renderCard({ ...FAILED_SLOT, status: 'awaiting', slotAt: '2030-06-01T10:00:00.000Z' }, true);

    expect(screen.queryByText(/2030/)).not.toBeInTheDocument();
    expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('shows the video thumbnail for a published post with a video, and no tile without one', () => {
    renderCard({ ...FAILED_SLOT, status: 'published', taskId: 'task-1', publishedAt: '2030-06-01T10:05:00.000Z' });
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/persona/video-download/task-1/final-1.mp4#t=0.1');
  });

  it('draws no thumbnail tile for a post without a video', () => {
    renderCard({ ...FAILED_SLOT, status: 'awaiting', taskId: null });
    expect(document.querySelector('video')).toBeNull();
  });
});
