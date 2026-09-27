import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

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

import BatchForm from '../batch-form';
import { usePersonaListQuery } from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { I18nProvider } from '@/lib/i18n/provider';

const PERSONAS = [
  { id: 'p1', name: 'Persona One', createdAt: '2026-01-01', faceMixPercent: 50, faceQuality: 'ok' },
];

function setup() {
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: PERSONAS } as never);
  vi.mocked(fetchTokenBalance).mockResolvedValue({ balance: 100, free: 100 });
  render(
    <I18nProvider>
      <BatchForm />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('BatchForm', () => {
  it('renders persona picker, provider checkboxes, one topic row, times and timezone', () => {
    setup();
    expect(screen.getByTestId('batch-persona')).toBeInTheDocument();
    expect(screen.getByTestId('batch-provider-youtube')).toBeInTheDocument();
    expect(screen.getByTestId('batch-provider-linkedin')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-provider-bluesky')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/batch-topic-/)).toHaveLength(1);
    expect(screen.getByTestId('batch-add-topic')).toBeInTheDocument();
    expect(screen.getByTestId('batch-timezone')).toBeInTheDocument();
  });

  it('lets the user add and remove topic rows, up to 30', () => {
    setup();
    const add = screen.getByTestId('batch-add-topic');
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByTestId(/batch-topic-/)).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId(/batch-remove-topic-/)[0]);
    expect(screen.getAllByTestId(/batch-topic-/)).toHaveLength(2);
  });

  it('caps topic rows at 30', () => {
    setup();
    const add = screen.getByTestId('batch-add-topic');
    for (let i = 0; i < 40; i++) fireEvent.click(add);
    expect(screen.getAllByTestId(/batch-topic-/)).toHaveLength(30);
    expect(add).toBeDisabled();
  });

  it('shows a live cost estimate: topics x per-video cost vs balance', async () => {
    setup();
    fireEvent.change(screen.getByTestId('batch-persona'), { target: { value: 'p1' } });
    // Persona One: 50% face mix @ ok => 2 tokens/video
    fireEvent.click(screen.getByTestId('batch-add-topic'));
    fireEvent.click(screen.getByTestId('batch-add-topic'));
    const { useI18n } = await import('@/lib/i18n/provider');
    const t = vi.mocked(useI18n)().t;
    // 3 topics x 2 tokens = 6 estimated, 100 balance
    await waitFor(() =>
      expect(t).toHaveBeenCalledWith('fillSchedule.batchEstimatedCost', { cost: 6, perVideo: 2 }),
    );
    expect(t).toHaveBeenCalledWith('fillSchedule.batchBalance', { balance: 100 });
  });

  it('submits the batch payload to /api/schedule/batch', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, tokensSpent: 2, slots: [] }), { status: 200 }),
    );

    fireEvent.change(screen.getByTestId('batch-persona'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('batch-provider-instagram'));
    fireEvent.change(screen.getByTestId('batch-topic-0'), { target: { value: 'My topic' } });
    fireEvent.click(screen.getByTestId('batch-submit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/schedule/batch');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.personaId).toBe('p1');
    expect(payload.items).toEqual([{ topic: 'My topic' }]);
    expect(payload.providers).toEqual(['youtube', 'instagram']);
    expect(payload.times).toHaveLength(1);
    expect(typeof payload.timezone).toBe('string');
    expect(await screen.findByTestId('batch-success')).toBeInTheDocument();
  });

  it('surfaces the backend INSUFFICIENT message when tokens are short', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          code: 'INSUFFICIENT',
          have: 3,
          need: 4,
          error: 'INSUFFICIENT_TOKENS: batch needs 4 tokens but the balance is 3.',
        }),
        { status: 400 },
      ),
    );

    fireEvent.change(screen.getByTestId('batch-persona'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByTestId('batch-topic-0'), { target: { value: 'T1' } });
    fireEvent.click(screen.getByTestId('batch-submit'));

    const error = await screen.findByTestId('batch-error');
    expect(error.textContent).toMatch(/INSUFFICIENT_TOKENS/);
  });
});
