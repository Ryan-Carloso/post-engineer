import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

let testLocale: 'pt' | 'en' = 'pt';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${JSON.stringify(vars)})`;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: testLocale, setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { ResultPanel } from '../result-panel';
import { I18nProvider } from '@/lib/i18n/provider';
import type { PublishResult } from '@/lib/post-composer/request';

function renderPanel(result: PublishResult, timezone = 'Europe/Lisbon') {
  const onAgain = vi.fn();
  const utils = render(
    <I18nProvider>
      <ResultPanel result={result} timezone={timezone} onAgain={onAgain} />
    </I18nProvider>,
  );
  return { ...utils, onAgain };
}

afterEach(() => {
  testLocale = 'pt';
});

const SCHEDULED: PublishResult = {
  mode: 'scheduled',
  replayed: false,
  scheduleId: 'schedule-1',
  slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'A day in Lisbon', status: 'ready' }],
};

const ASAP: PublishResult = {
  mode: 'asap',
  success: true,
  replayed: false,
  publishes: [
    {
      provider: 'youtube',
      success: true,
      results: [{ accountId: 'ch-1', success: true, videoUrl: 'https://youtu.be/x' }],
    },
    {
      provider: 'instagram',
      success: false,
      results: [{ accountId: 'ig-1', success: false, error: 'quota' }],
    },
  ],
};

describe('ResultPanel', () => {
  it('renders the scheduled success with the first slot date and link', () => {
    renderPanel(SCHEDULED);
    expect(screen.getByTestId('composer-result')).toBeInTheDocument();
    expect(screen.getByText('composer.successScheduledTitle')).toBeInTheDocument();
    expect(screen.getByText(/dezembro/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-1',
    );
    expect(screen.getByRole('link', { name: 'composer.successScheduledAction' })).toHaveAttribute(
      'href',
      '/posts',
    );
    expect(screen.queryByText('composer.resultReplayed')).not.toBeInTheDocument();
  });

  it('formats the slot date in the english locale', () => {
    testLocale = 'en';
    renderPanel(SCHEDULED);
    expect(screen.getByText(/December/)).toBeInTheDocument();
  });

  it('shows the replayed note on a scheduled replay', () => {
    renderPanel({ ...SCHEDULED, replayed: true });
    expect(screen.getByText('composer.resultReplayed')).toBeInTheDocument();
  });

  it('renders the scheduled success without a slot link when there are no slots', () => {
    renderPanel({ ...SCHEDULED, slots: [] });
    expect(screen.getByText('composer.successScheduledTitle')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'composer.successViewPost' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successScheduledAction' })).toHaveAttribute(
      'href',
      '/posts',
    );
  });

  it('keeps an unparseable slot date as-is', () => {
    renderPanel({ ...SCHEDULED, slots: [{ id: 'slot-9', slotAt: 'not-a-date', title: 'T', status: 'ready' }] });
    expect(screen.getByText('composer.successScheduledBody({"date":"not-a-date"})')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-9',
    );
  });

  it('renders the asap success with provider labels, outcomes and links', () => {
    renderPanel(ASAP);
    expect(screen.getByText('composer.successAsapTitle')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('ch-1')).toBeInTheDocument();
    expect(screen.getByText('ig-1')).toBeInTheDocument();
    expect(screen.getByText('composer.resultOk')).toBeInTheDocument();
    expect(screen.getByText('composer.resultFailed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      'https://youtu.be/x',
    );
    expect(screen.queryByText('composer.resultReplayed')).not.toBeInTheDocument();
  });

  it('renders the partial title when any publish failed', () => {
    renderPanel({ ...ASAP, success: false, replayed: true });
    expect(screen.getByText('composer.successPartialTitle')).toBeInTheDocument();
    expect(screen.queryByText('composer.successAsapTitle')).not.toBeInTheDocument();
    expect(screen.getByText('composer.resultReplayed')).toBeInTheDocument();
  });

  it('links the permalink when there is no video URL', () => {
    renderPanel({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'threads',
          success: true,
          results: [{ accountId: 'th-1', success: true, permalink: 'https://threads.net/p/1' }],
        },
      ],
    });
    expect(screen.getByText('Threads')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      'https://threads.net/p/1',
    );
  });

  it('shows no link when the account has neither a video URL nor a permalink', () => {
    renderPanel({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: true,
          results: [{ accountId: 'ch-1', success: true }],
        },
      ],
    });
    expect(screen.queryByRole('link', { name: 'composer.successViewPost' })).not.toBeInTheDocument();
    expect(screen.getByText('composer.resultOk')).toBeInTheDocument();
  });

  it('renders an unknown provider by its raw name', () => {
    renderPanel({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'mystery',
          success: true,
          results: [{ accountId: 'm-1', success: true }],
        },
      ],
    });
    expect(screen.getByText('mystery')).toBeInTheDocument();
  });

  it('calls onAgain when the again button is clicked', () => {
    const { onAgain } = renderPanel(SCHEDULED);
    fireEvent.click(screen.getByRole('button', { name: 'composer.successAgain' }));
    expect(onAgain).toHaveBeenCalledTimes(1);
  });

  it('shows the server error text under a failed account', () => {
    renderPanel(ASAP);
    expect(screen.getByText('composer.resultError({"error":"quota"})')).toBeInTheDocument();
    expect(screen.getByText('composer.resultFailed')).toBeInTheDocument();
  });

  it('shows a first-comment warning amber and still shows Published', () => {
    renderPanel({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: true,
          results: [
            {
              accountId: 'ch-1',
              success: true,
              videoUrl: 'https://youtu.be/x',
              warnings: ['FIRST_COMMENT_FAILED'],
            },
          ],
        },
      ],
    });
    const warning = screen.getByText('posts.commentWarningFailed({"provider":"YouTube"})');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveClass('text-warning');
    expect(screen.getByText('composer.resultOk')).toBeInTheDocument();
  });

  it('shows the reconnect warning on a scheduled result with dead accounts', () => {
    renderPanel({
      ...SCHEDULED,
      warnings: [
        { code: 'account_needs_reconnect', accounts: [{ provider: 'youtube', accountId: 'UC1' }] },
      ],
    });
    const warning = screen.getByText('composer.resultReconnectWarning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveClass('text-warning');
    expect(screen.getByText('composer.successScheduledTitle')).toBeInTheDocument();
  });

  it('renders the held panel with a link to the held slot, never a success title', () => {
    renderPanel({
      mode: 'asap',
      held: true,
      approvalRequired: true,
      replayed: false,
      slot: { id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', status: 'awaiting_approval' },
    });
    expect(screen.getByText('composer.heldTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.heldBody')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-1',
    );
    expect(screen.queryByText('composer.successAsapTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('composer.resultReplayed')).not.toBeInTheDocument();
  });

  it('renders the replayed approved hold without a success title', () => {
    renderPanel({
      mode: 'asap',
      held: false,
      approvalRequired: false,
      replayed: true,
      slot: { id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', status: 'ready' },
    });
    expect(screen.getByText('composer.heldTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.resultReplayed')).toBeInTheDocument();
    expect(screen.queryByText('composer.successAsapTitle')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-1',
    );
  });
});
