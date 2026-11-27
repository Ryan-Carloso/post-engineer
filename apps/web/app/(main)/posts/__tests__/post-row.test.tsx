import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ScheduledSlot } from '@/lib/api';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

import { PostRow } from '../post-row';
import { formatDate, formatTime } from '../post-card';

const SLOT: ScheduledSlot = {
  id: 'slot-1',
  scheduleId: 's1',
  slotAt: '2030-06-01T13:05:00.000Z',
  status: 'ready',
  title: 'Calendar topic',
  error: null,
  publishedAt: null,
};

const ACCOUNTS = [
  { id: 'ch1', provider: 'youtube' as const, label: 'Europa Na Estrada' },
  { id: 'ig1', provider: 'instagram' as const, label: '@vivalave' },
];

function renderRow(slot: Partial<ScheduledSlot> = {}, timeOnly = false, accounts = ACCOUNTS, accountActive = true) {
  cleanup();
  return render(
    <PostRow slot={{ ...SLOT, ...slot }} personaName="Viva Leve" accounts={accounts} locale="en" timeOnly={timeOnly} accountActive={accountActive} />,
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
    expect(
      screen.getByText(`${formatDate('2030-06-01T13:05:00.000Z', 'en')} · ${formatTime('2030-06-01T13:05:00.000Z', 'en')}`),
    ).toBeInTheDocument();
  });

  it('shows only the time when the day list already names the date', () => {
    renderRow({}, true);

    expect(screen.queryByText(/2030/)).not.toBeInTheDocument();
    expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it('dates a published post by when it went out, not by the planned slot', () => {
    renderRow({ status: 'published', publishedAt: '2030-06-02T09:30:00.000Z', slotAt: '2030-06-01T10:00:00.000Z' }, true);

    expect(screen.getByText(formatTime('2030-06-02T09:30:00.000Z', 'en'))).toBeInTheDocument();
    expect(screen.queryByText(formatTime('2030-06-01T10:00:00.000Z', 'en'))).not.toBeInTheDocument();
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

  it('exposes the targeted networks to assistive technology', () => {
    renderRow();

    expect(screen.getByRole('img', { name: 'youtube' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'instagram' })).toBeInTheDocument();
  });

  it('draws no network glyph when the post targets no account', () => {
    renderRow({}, false, []);

    expect(screen.getByRole('link', { name: 'posts.cardOpenDetail' }).querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});

describe('PostRow status', () => {
  it.each([
    ['ready', 'posts.groupScheduled'],
    ['publishing', 'posts.groupInProgress'],
    ['published', 'posts.groupPublished'],
    ['failed', 'posts.groupFailed'],
  ] as const)('labels a %s post with %s', (status, label) => {
    renderRow({ status });

    expect(document.querySelector(`[data-status="${status}"]`)).toHaveTextContent(label);
  });

  it('labels an expired post with its own group and dates it by the slot, never published_at', () => {
    renderRow({ status: 'expired', publishedAt: '2030-06-02T09:30:00.000Z', slotAt: '2030-06-01T10:00:00.000Z' }, true);

    expect(document.querySelector('[data-status="expired"]')).toHaveTextContent('posts.groupExpired');
    expect(screen.getByText(formatTime('2030-06-01T10:00:00.000Z', 'en'))).toBeInTheDocument();
    expect(screen.queryByText(formatTime('2030-06-02T09:30:00.000Z', 'en'))).not.toBeInTheDocument();
  });

  it('labels a ready post as paused when the account is inactive', () => {
    renderRow({ status: 'ready' }, false, ACCOUNTS, false);

    expect(document.querySelector('[data-status="paused"]')).toHaveTextContent('posts.groupPaused');
  });

  it('keeps a ready post scheduled when the account is active', () => {
    renderRow({ status: 'ready' }, false, ACCOUNTS, true);

    expect(document.querySelector('[data-status="ready"]')).toHaveTextContent('posts.groupScheduled');
    expect(document.querySelector('[data-status="paused"]')).toBeNull();
  });
});

describe('PostRow failure', () => {
  it('shows the generic failure line, never the raw error text', () => {
    renderRow({ status: 'failed', error: 'Instagram said: token expired at 12:00' });

    expect(screen.getByText('posts.cardFailedPermanent')).toBeInTheDocument();
    expect(screen.queryByText(/token expired/)).not.toBeInTheDocument();
  });


  it('shows no failure line on a post that did not fail', () => {
    renderRow({ status: 'published' });

    expect(document.querySelector('[data-post-row-error]')).toBeNull();
    expect(screen.queryByText('posts.cardFailedPermanent')).not.toBeInTheDocument();
  });
});

