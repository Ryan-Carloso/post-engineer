import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';

//---------------
// Tests for PostRow — the ONE dense row a scheduled post renders as, in the
// calendar's day list and in the history list. i18n echoes keys.
//---------------

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

import { PostRow } from '../post-row';

const SLOT: ScheduledSlot = {
  id: 'slot-1',
  scheduleId: 's1',
  slotAt: '2030-06-01T13:05:00.000Z',
  status: 'awaiting',
  title: 'Calendar topic',
  error: null,
  publishedAt: null,
  taskId: null,
  progress: 0,
  stage: null,
  queuePosition: null,
  queueTotal: null,
  retryable: null,
};

const ACCOUNTS = [
  { id: 'ch1', provider: 'youtube' as const, label: 'Europa Na Estrada' },
  { id: 'ig1', provider: 'instagram' as const, label: '@vivalave' },
];

function renderRow(slot: Partial<ScheduledSlot> = {}, timeOnly = false, accounts = ACCOUNTS) {
  cleanup();
  return render(
    <PostRow slot={{ ...SLOT, ...slot }} personaName="Viva Leve" accounts={accounts} locale="en" timeOnly={timeOnly} />,
  );
}

describe('PostRow layout', () => {
  it('links the whole row to the post detail and names it with the title', () => {
    renderRow();

    const link = screen.getByRole('link', { name: 'posts.cardOpenDetail' });
    expect(link).toHaveAttribute('href', '/posts/slot-1');
    expect(screen.getByText('Calendar topic')).toBeInTheDocument();
  });

  it('shows the persona and the full date with the time in the history list', () => {
    renderRow();

    expect(screen.getByText('Viva Leve')).toBeInTheDocument();
    expect(screen.getByText(/Jun 1, 2030 · \d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('shows only the time when the day list already names the date', () => {
    renderRow({}, true);

    expect(screen.queryByText(/2030/)).not.toBeInTheDocument();
    expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('dates a published post by when it went out, not by the planned slot', () => {
    renderRow({ status: 'published', publishedAt: '2030-06-02T09:30:00.000Z' }, true);

    expect(screen.getByText(/^9:30/)).toBeInTheDocument();
  });

  it('falls back to the untitled copy instead of an empty line', () => {
    renderRow({ title: null });

    expect(screen.getByText('posts.unknownTitle')).toBeInTheDocument();
  });

  it('lists the networks a post targets as provider glyphs', () => {
    const { container } = renderRow();

    expect(container.querySelectorAll('[aria-label="youtube"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="instagram"]')).toHaveLength(1);
  });

  it('draws no network glyph when the post targets no account', () => {
    renderRow({}, false, []);

    expect(screen.getByRole('link', { name: 'posts.cardOpenDetail' }).querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});

describe('PostRow status', () => {
  it.each([
    ['awaiting', 'posts.groupScheduled'],
    ['ready', 'posts.groupScheduled'],
    ['generating', 'posts.statusGenerating'],
    ['publishing', 'posts.statusPublishing'],
    ['published', 'posts.groupPublished'],
    ['failed', 'posts.groupFailed'],
  ] as const)('labels a %s post with %s', (status, label) => {
    renderRow({ status });

    expect(document.querySelector(`[data-status="${status}"]`)).toHaveTextContent(label);
  });

  it('spins the badge only while the video generates', () => {
    renderRow({ status: 'generating', progress: 40 });
    expect(document.querySelector('[data-status="generating"]')?.querySelector('.animate-spin')).not.toBeNull();

    renderRow({ status: 'publishing', progress: 40 });
    expect(document.querySelector('[data-status="publishing"]')?.querySelector('.animate-spin')).toBeNull();
  });

  it('fills the progress bar only while work runs, and never for a waiting or finished post', () => {
    renderRow({ status: 'generating', progress: 62 });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByText('62%')).toBeInTheDocument();

    renderRow({ status: 'ready', progress: 0, taskId: 'task-1' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    renderRow({ status: 'awaiting', progress: 0 });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('PostRow failure', () => {
  it('shows the translated reason for the slot error, never the raw engine text', () => {
    renderRow({ status: 'failed', error: 'Engine restart while rendering the final video' });

    expect(screen.getByText('posts.errorEngineRestart')).toBeInTheDocument();
    expect(screen.queryByText(/Engine restart while rendering/)).not.toBeInTheDocument();
  });

  it('keeps the retryable / permanent copy for an unrecognized error', () => {
    renderRow({ status: 'failed', error: 'torchrun exited 1', retryable: true });
    expect(screen.getByText('posts.cardFailedRetryable')).toBeInTheDocument();

    renderRow({ status: 'failed', error: 'torchrun exited 1', retryable: false });
    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();

    renderRow({ status: 'failed', error: null, retryable: null });
    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
  });

  it('shows no failure line on a post that did not fail', () => {
    renderRow({ status: 'published' });

    expect(document.querySelector('[data-post-row-error]')).toBeNull();
    expect(screen.queryByText('posts.cardFailedPermanent')).not.toBeInTheDocument();
  });
});

describe('PostRow media', () => {
  it('renders the final video of a ready or published post', () => {
    renderRow({ status: 'published', taskId: 'task-1' });

    expect(document.querySelector('video')).toHaveAttribute(
      'src',
      '/api/persona/video-download/task-1/final-1.mp4#t=0.1',
    );
  });

  it('draws the group glyph instead of a video when there is nothing to preview', () => {
    renderRow({ status: 'awaiting', taskId: null });

    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[data-status="awaiting"]')).not.toBeNull();
    expect(document.querySelector('[data-post-row-error]')).toBeNull();
  });
});
