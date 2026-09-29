import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// The schedule page is batch-only (for now): the recurring/one-off form was
// removed, so this just pins that the page renders the BatchForm.

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: vi.fn(),
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

import SchedulePage from '../page';
import { usePersonaListQuery } from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { I18nProvider } from '@/lib/i18n/provider';

const PERSONAS = [
  { id: 'p1', name: 'Persona One', createdAt: '2026-01-01', faceMixPercent: 50, faceQuality: 'ok' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: PERSONAS } as never);
  vi.mocked(fetchTokenBalance).mockResolvedValue({ balance: 100, free: 100 });
});

describe('SchedulePage — batch only', () => {
  it('renders the batch form and no recurring/one-off schedule form', () => {
    render(
      <I18nProvider>
        <SchedulePage />
      </I18nProvider>,
    );
    expect(screen.getByTestId('batch-form')).toBeInTheDocument();
    expect(screen.queryByLabelText('fillSchedule.modeRecurring')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('fillSchedule.oneOff')).not.toBeInTheDocument();
  });
});
