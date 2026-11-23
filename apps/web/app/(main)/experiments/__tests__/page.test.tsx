import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, params?: Record<string, unknown>) => {
    if (params === undefined) return key;
    return `${key} [${Object.values(params).join(', ')}]`;
  };
  return { useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t }) };
});

vi.mock('@/lib/experiments/comparison-query', () => ({ usePromptComparisonQuery: vi.fn() }));
vi.mock('@/lib/api', () => ({ useSocialAccountsQuery: vi.fn() }));
vi.mock('@/components/provider-icon', () => ({ ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`icon-${provider}`} /> }));
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => (
    <div>
      {children}
      <button type="button" onClick={() => onValueChange('28d')}>pick-28d</button>
      <button type="button" onClick={() => onValueChange('90d')}>pick-90d</button>
    </div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import ExperimentsPage from '../page';
import { useSocialAccountsQuery } from '@/lib/api';
import { usePromptComparisonQuery } from '@/lib/experiments/comparison-query';
import type { PromptComparisonResponse } from '@/lib/contracts/experiments';

type PromptView = PromptComparisonResponse['accounts'][number]['prompts'][number];

function prompt(overrides: Partial<PromptView> = {}): PromptView {
  return {
    versionId: '11111111-1111-4111-8111-111111111111',
    slug: 'calm-hook',
    title: 'Calm hook',
    version: 2,
    source: 'user',
    videos: 6,
    medianViews: 1234,
    lift: 1.456,
    pValue: 0.03,
    label: 'clear',
    direction: 'above',
    ...overrides,
  };
}

function comparison(overrides: Partial<PromptComparisonResponse> = {}): PromptComparisonResponse {
  return {
    success: true,
    window: '7d',
    truncated: false,
    accounts: [
      {
        provider: 'youtube',
        accountId: 'yt-1',
        videos: 12,
        baselineViews: 900,
        prompts: [
          prompt(),
          prompt({ versionId: '22222222-2222-4222-8222-222222222222', slug: 'story-first-reels', title: 'Story first', version: 1, source: 'official', label: 'indicative', direction: 'below', lift: 0.8 }),
          prompt({ versionId: null, slug: null, title: null, version: null, source: null, videos: 2, medianViews: null, lift: null, pValue: null, label: 'insufficient', direction: null }),
        ],
      },
    ],
    ...overrides,
  };
}

function queryReturns(value: Record<string, unknown>): { refetch: ReturnType<typeof vi.fn> } {
  const refetch = vi.fn();
  vi.mocked(usePromptComparisonQuery).mockReturnValue({ isLoading: false, isError: false, isFetching: false, refetch, ...value } as never);
  return { refetch };
}

beforeEach(() => {
  vi.mocked(usePromptComparisonQuery).mockReset();
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: { accounts: [{ provider: 'youtube', channelId: 'yt-1', channelName: 'My channel', id: 'row-1' }] },
  } as never);
});

describe('ExperimentsPage', () => {
  it('shows each account with its prompts, labels, lifts and the no-prompt group', () => {
    queryReturns({ data: comparison() });
    render(<ExperimentsPage />);
    const card = screen.getByRole('region', { name: 'My channel' });
    expect(within(card).getByTestId('icon-youtube')).toBeInTheDocument();
    expect(within(card).getByText('experiments.accountSummary [12, 900]')).toBeInTheDocument();
    expect(within(card).getByText('Calm hook')).toBeInTheDocument();
    expect(within(card).getByText('experiments.version [2]')).toBeInTheDocument();
    expect(within(card).getByText('experiments.liftValue [1.46]')).toBeInTheDocument();
    expect(within(card).getAllByText('1,234')).toHaveLength(2);
    expect(within(card).getByText('experiments.labelClear')).toHaveAttribute('title', 'experiments.above');
    expect(within(card).getByText('experiments.labelClear').className).toContain('bg-success-soft');
    expect(within(card).getByText('experiments.labelIndicative')).toHaveAttribute('title', 'experiments.below');
    expect(within(card).getByText('experiments.official')).toBeInTheDocument();
    expect(within(card).getByText('experiments.noPrompt')).toBeInTheDocument();
    expect(within(card).getByText('experiments.labelInsufficient')).not.toHaveAttribute('title');
    expect(screen.getByText('experiments.howItWorks [5, 10]')).toBeInTheDocument();
  });

  it('colours a clear trailing prompt as destructive and falls back to the account id without a name', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({ data: undefined } as never);
    queryReturns({ data: comparison({ accounts: [{ provider: 'youtube', accountId: 'yt-9', videos: 6, baselineViews: null, prompts: [prompt({ direction: 'below', lift: 0.5 })] }] }) });
    render(<ExperimentsPage />);
    expect(screen.getByRole('region', { name: 'yt-9' })).toBeInTheDocument();
    expect(screen.getByText('experiments.accountSummary [6, —]')).toBeInTheDocument();
    expect(screen.getByText('experiments.labelClear').className).toContain('bg-destructive-soft');
  });

  it('switches the window from the tabs and ignores an unknown value', () => {
    queryReturns({ data: comparison() });
    render(<ExperimentsPage />);
    expect(vi.mocked(usePromptComparisonQuery).mock.calls.at(-1)?.[0]).toBe('7d');
    fireEvent.click(screen.getByText('pick-28d'));
    expect(vi.mocked(usePromptComparisonQuery).mock.calls.at(-1)?.[0]).toBe('28d');
    fireEvent.click(screen.getByText('pick-90d'));
    expect(vi.mocked(usePromptComparisonQuery).mock.calls.at(-1)?.[0]).toBe('28d');
  });

  it('warns when the comparison was truncated', () => {
    queryReturns({ data: comparison({ truncated: true }) });
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.truncated [2,000]')).toBeInTheDocument();
  });

  it('shows the empty state when no account has a prompt video', () => {
    queryReturns({ data: comparison({ accounts: [] }) });
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.empty')).toBeInTheDocument();
  });

  it('shows a spinner while loading', () => {
    queryReturns({ isLoading: true, data: undefined });
    render(<ExperimentsPage />);
    expect(screen.queryByText('experiments.empty')).not.toBeInTheDocument();
    expect(screen.queryByText('experiments.loadError')).not.toBeInTheDocument();
  });

  it('shows a localized error with a retry for a failed fetch', () => {
    const { refetch } = queryReturns({ data: { success: false, error: 'HTTP 500' } });
    render(<ExperimentsPage />);
    expect(screen.getByText('experiments.loadError')).toBeInTheDocument();
    expect(screen.queryByText('HTTP 500')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('experiments.retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
