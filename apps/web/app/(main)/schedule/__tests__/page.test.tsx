import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// The schedule page is the unified generate+schedule flow: it renders the
// GenerateScheduleForm and nothing else.

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/token-balance', () => ({
  fetchTokenBalance: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const t = vi.fn((key: string) => key);
  const useI18n = vi.fn(() => ({ t, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({ get: () => null })),
}));

import SchedulePage from '../page';
import {
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useBlueskyAccountsQuery,
  useLinkedinAccountsQuery,
} from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { I18nProvider } from '@/lib/i18n/provider';

const PERSONAS = [
  { id: 'p1', name: 'Persona One', createdAt: '2026-01-01', faceMixPercent: 50, faceQuality: 'ok' },
];

const NO_ACCOUNTS = { data: { authenticated: true, accounts: [] }, isPending: false, isError: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: PERSONAS } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue(NO_ACCOUNTS as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue(NO_ACCOUNTS as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue(NO_ACCOUNTS as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue(NO_ACCOUNTS as never);
  vi.mocked(fetchTokenBalance).mockResolvedValue({ balance: 100, free: 100 });
});

describe('SchedulePage — unified generate+schedule', () => {
  it('renders the generate form and no legacy schedule modes', () => {
    render(
      <I18nProvider>
        <SchedulePage />
      </I18nProvider>,
    );
    expect(screen.getByTestId('gen-form')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-form')).not.toBeInTheDocument();
  });
});
