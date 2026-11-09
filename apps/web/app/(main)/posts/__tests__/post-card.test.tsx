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

const ACCOUNTS = [
  { id: 'ch1', provider: 'youtube' as const, label: 'Europa Na Estrada' },
  { id: 'ig1', provider: 'instagram' as const, label: '@vivalave' },
];

function renderCard(slot: ScheduledSlot, timeOnly = false, accounts: typeof ACCOUNTS = []) {
  render(<PostCard slot={slot} personaName="Viva Leve" accounts={accounts} locale="en" timeOnly={timeOnly} />);
}

describe('PostCard failure', () => {
  // There is no retry endpoint. The next step opens Recipes, where the
  // post is scheduled again. See details stays secondary.
  it('links a failed post to Recipes first and to its detail second', () => {
    renderCard(FAILED_SLOT);

    expect(screen.queryByText('posts.cardRetry')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.cardReschedule' })).toHaveAttribute('href', '/recipes');
    expect(screen.getByRole('link', { name: 'posts.cardDetails' })).toHaveAttribute('href', '/posts/f1');
  });

  it('puts the failure reason, the accounts it failed for and the details link together in one red box', () => {
    renderCard(FAILED_SLOT, false, ACCOUNTS);

    const box = screen.getByText('posts.cardFailedRetryable').closest('.bg-destructive-soft');
    if (!(box instanceof HTMLElement)) throw new Error('failure box not rendered');
    expect(within(box).getByText('posts.cardFailedFor')).toBeInTheDocument();
    expect(within(box).getByText('Europa Na Estrada')).toBeInTheDocument();
    expect(within(box).getByText('@vivalave')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: 'posts.cardReschedule' })).toHaveAttribute('href', '/recipes');
    expect(within(box).getByRole('link', { name: 'posts.cardDetails' })).toBeInTheDocument();
    expect(box.className.split(/\s+/)).toContain('text-ink');
    expect(box.className.split(/\s+/)).not.toContain('text-destructive');
    // The chips are not repeated under the box.
    expect(screen.getAllByText('Europa Na Estrada')).toHaveLength(1);
  });

  it('shows the permanent failure copy when the post cannot be retried, with the same next step', () => {
    renderCard({ ...FAILED_SLOT, retryable: false });

    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
    expect(screen.queryByText('posts.cardFailedRetryable')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.cardReschedule' })).toHaveAttribute('href', '/recipes');
    expect(screen.getByRole('link', { name: 'posts.cardDetails' })).toHaveAttribute('href', '/posts/f1');
  });

  it('treats an unknown retryable flag as permanent', () => {
    renderCard({ ...FAILED_SLOT, retryable: null });

    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
  });

  it('shows no failure box and no details link on a published card, and keeps its chips', () => {
    renderCard(
      { ...FAILED_SLOT, status: 'published', title: 'Published topic', error: null, publishedAt: '2030-06-01T10:05:00.000Z' },
      false,
      ACCOUNTS,
    );

    expect(screen.queryByRole('link', { name: 'posts.cardDetails' })).not.toBeInTheDocument();
    expect(screen.queryByText('posts.cardFailedFor')).not.toBeInTheDocument();
    expect(screen.getByText('Europa Na Estrada')).toBeInTheDocument();
  });

  it('keeps the card itself linked to the post detail, with a chevron that says so', () => {
    renderCard(FAILED_SLOT);

    const link = screen.getByRole('link', { name: /Failed topic/ });
    expect(link).toHaveAttribute('href', '/posts/f1');
    expect(link.querySelector('[data-card-chevron]')).not.toBeNull();
  });
});

describe('PostCard status pill — the calendar vocabulary', () => {
  it.each([
    ['awaiting', 'posts.groupScheduled'],
    ['ready', 'posts.groupScheduled'],
    ['generating', 'posts.groupInProgress'],
    ['publishing', 'posts.groupInProgress'],
    ['published', 'posts.groupPublished'],
    ['failed', 'posts.groupFailed'],
  ] as const)('labels a %s post with the calendar group word %s', (status, label) => {
    renderCard({ ...FAILED_SLOT, status });

    expect(document.querySelector(`[data-status="${status}"]`)).toHaveTextContent(label);
  });

  it('names the exact stage with the percent under the In progress pill', () => {
    renderCard({ ...FAILED_SLOT, status: 'generating', progress: 45 });

    expect(screen.getByText('posts.statusGenerating')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar.querySelector('div')?.className.split(/\s+/)).toContain('bg-info');
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
