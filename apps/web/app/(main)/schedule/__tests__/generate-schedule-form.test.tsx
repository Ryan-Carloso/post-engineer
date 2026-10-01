import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// generate-schedule-form.test — behavioral coverage for the unified
// generate+schedule form: preselect, topics, slot preview, submit body,
// idempotency reuse, error field mapping, account defaults.
//---------------

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
  useSearchParams: vi.fn(),
}));

vi.mock('@/lib/scroll-to-error', () => ({
  scrollToErrorField: vi.fn(),
}));

import GenerateScheduleForm from '../generate-schedule-form';
import {
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useBlueskyAccountsQuery,
  useLinkedinAccountsQuery,
} from '@/lib/api';
import { fetchTokenBalance } from '@/lib/token-balance';
import { useSearchParams } from 'next/navigation';
import { scrollToErrorField } from '@/lib/scroll-to-error';
import { I18nProvider } from '@/lib/i18n/provider';

const PERSONAS = [
  { id: 'p1', name: 'Persona One', createdAt: '2026-01-01', faceMixPercent: 50, faceQuality: 'ok' },
  { id: 'p2', name: 'Persona Two', createdAt: '2026-01-02', faceMixPercent: 0, faceQuality: 'ok' },
];

const YT_ACCOUNTS = {
  data: {
    authenticated: true,
    accounts: [
      { provider: 'youtube', recordId: 'r1', channelId: 'ch1', channelName: 'Channel One', connectedAt: 0, lastUsed: 0 },
    ],
  },
  isPending: false,
  isError: false,
};

const EMPTY_ACCOUNTS = (provider: string) => ({
  data: { authenticated: true, accounts: [] },
  isPending: false,
  isError: false,
  provider,
});

function setup(personaIdParam: string | null = null) {
  vi.mocked(useSearchParams).mockReturnValue({
    get: (key: string) => (key === 'personaId' ? personaIdParam : null),
  } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: PERSONAS } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue(YT_ACCOUNTS as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue(EMPTY_ACCOUNTS('instagram') as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
    data: {
      authenticated: true,
      accounts: [{ provider: 'bluesky', recordId: 'r2', did: 'did:1', handle: '@handle', connectedAt: 0, lastUsed: 0 }],
    },
    isPending: false,
    isError: false,
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue(EMPTY_ACCOUNTS('linkedin') as never);
  vi.mocked(fetchTokenBalance).mockResolvedValue({ balance: 100, free: 100 });
  render(
    <I18nProvider>
      <GenerateScheduleForm />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

async function fillValidBasics() {
  fireEvent.change(screen.getByTestId('gen-persona'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByTestId('gen-topic-0'), { target: { value: 'My topic' } });
  // Wait for the youtube account default-selection effect to settle.
  await waitFor(() => expect(screen.getByTestId('gen-account-youtube-ch1')).toBeChecked());
}

describe('GenerateScheduleForm', () => {
  it('renders persona picker, all four provider checkboxes, topics, times, timezone and slot preview', () => {
    setup();
    expect(screen.getByTestId('gen-form')).toBeInTheDocument();
    expect(screen.getByTestId('gen-persona')).toBeInTheDocument();
    expect(screen.getByTestId('gen-provider-youtube')).toBeInTheDocument();
    expect(screen.getByTestId('gen-provider-instagram')).toBeInTheDocument();
    expect(screen.getByTestId('gen-provider-linkedin')).toBeInTheDocument();
    expect(screen.getByTestId('gen-provider-bluesky')).toBeInTheDocument();
    expect(screen.getAllByTestId(/gen-topic-/)).toHaveLength(1);
    expect(screen.getByTestId('gen-add-topic')).toBeInTheDocument();
    expect(screen.getByTestId('gen-time-0')).toBeInTheDocument();
    expect(screen.getByTestId('gen-start-date')).toBeInTheDocument();
    expect(screen.getByTestId('gen-timezone')).toBeInTheDocument();
    expect(screen.getByTestId('gen-slot-preview')).toBeInTheDocument();
    expect(screen.getByTestId('gen-faceless')).toBeInTheDocument();
    expect(screen.getByTestId('gen-submit')).toBeInTheDocument();
  });

  it('preselects the persona from ?personaId=', () => {
    setup('p2');
    expect(screen.getByTestId('gen-persona')).toHaveValue('p2');
  });

  it('ignores an unknown ?personaId= value', () => {
    setup('does-not-exist');
    expect(screen.getByTestId('gen-persona')).toHaveValue('');
  });

  it('lets the user add and remove topic rows, capped at 10', () => {
    setup();
    const add = screen.getByTestId('gen-add-topic');
    for (let i = 0; i < 12; i++) fireEvent.click(add);
    expect(screen.getAllByTestId(/^gen-topic-\d+$/)).toHaveLength(10);
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByTestId('gen-remove-topic-0'));
    expect(screen.getAllByTestId(/^gen-topic-\d+$/)).toHaveLength(9);
    expect(add).not.toBeDisabled();
  });

  it('updates the live slot preview as topics and times change', async () => {
    setup();
    // Empty topics: the preview shows the empty hint.
    expect(screen.getByTestId('gen-slot-preview')).toHaveTextContent('fillSchedule.genSlotPreviewEmpty');

    fireEvent.change(screen.getByTestId('gen-topic-0'), { target: { value: 'Topic A' } });
    await waitFor(() => expect(screen.getAllByTestId(/^gen-slot-\d+$/)).toHaveLength(1));
    expect(screen.getByTestId('gen-slot-0')).toHaveTextContent('Topic A');

    fireEvent.click(screen.getByTestId('gen-add-topic'));
    fireEvent.change(screen.getByTestId('gen-topic-1'), { target: { value: 'Topic B' } });
    await waitFor(() => expect(screen.getAllByTestId(/^gen-slot-\d+$/)).toHaveLength(2));
    // One time configured: topic 2 lands on the next day (distributeSlots).
    expect(screen.getByTestId('gen-slot-1')).toHaveTextContent('Topic B');
  });

  it('submits the unified payload to /api/videos/generate-and-schedule and shows the schedule', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          schedule: { id: 'sched-1' },
          slots: [
            { slotId: 'sl1', slotAt: '2026-10-02T19:00:00.000Z', topic: 'My topic', taskId: 'task-1', status: 'generating' },
          ],
          replayed: false,
        }),
        { status: 200 },
      ),
    );

    await fillValidBasics();
    fireEvent.click(screen.getByTestId('gen-provider-bluesky'));
    fireEvent.click(screen.getByTestId('gen-faceless'));
    fireEvent.change(screen.getByTestId('gen-script-prompt'), { target: { value: 'Be funny' } });
    fireEvent.click(screen.getByTestId('gen-submit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/videos/generate-and-schedule');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.personaId).toBe('p1');
    expect(payload.topics).toEqual(['My topic']);
    expect(payload.publishing.providers).toEqual(['youtube', 'bluesky']);
    expect(payload.publishing.accounts).toEqual({ youtube: ['ch1'], bluesky: ['did:1'] });
    expect(payload.publishing.schedule.times).toEqual(['12:00']);
    expect(typeof payload.publishing.schedule.startAt).toBe('string');
    expect(typeof payload.publishing.schedule.timezone).toBe('string');
    expect(payload.options).toEqual({ faceless: true, scriptPrompt: 'Be funny' });
    expect(typeof payload.idempotencyKey).toBe('string');
    expect(payload.idempotencyKey.length).toBeGreaterThan(0);

    // Success panel: schedule id, per-slot summary and a link to /posts.
    expect(await screen.findByText('sched-1')).toBeInTheDocument();
    expect(screen.getByText('My topic')).toBeInTheDocument();
    const postsLink = screen.getByRole('link', { name: 'fillSchedule.genViewPosts' });
    expect(postsLink).toHaveAttribute('href', '/posts');
  });

  it('reuses the idempotency key across retries instead of regenerating it', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    await fillValidBasics();

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fireEvent.click(screen.getByTestId('gen-submit'));
    await screen.findByTestId('gen-error');
    const firstKey = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).idempotencyKey;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, schedule: { id: 's1' }, slots: [], replayed: false }), { status: 200 }),
    );
    fireEvent.click(screen.getByTestId('gen-submit'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondKey = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it('maps server field errors with scrollToErrorField and shows the message as-is', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid publishing time: "25:00". Use "HH:MM".',
          code: 'INVALID_SCHEDULE_TIME',
          field: 'publishing.schedule.times',
        }),
        { status: 400 },
      ),
    );

    await fillValidBasics();
    fireEvent.click(screen.getByTestId('gen-submit'));

    const error = await screen.findByTestId('gen-error');
    // Server messages are actionable: shown verbatim, never paraphrased.
    expect(error.textContent).toBe('Invalid publishing time: "25:00". Use "HH:MM".');
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('publishing.schedule.times');
  });

  it('shows INSUFFICIENT_TOKENS as-is and focuses the cost preview', async () => {
    setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'You need 850 tokens, but only have 600.',
          code: 'INSUFFICIENT_TOKENS',
        }),
        { status: 402 },
      ),
    );

    await fillValidBasics();
    fireEvent.click(screen.getByTestId('gen-submit'));

    const error = await screen.findByTestId('gen-error');
    expect(error.textContent).toBe('You need 850 tokens, but only have 600.');
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('tokens');
  });

  it('defaults to all connected accounts of each selected provider', async () => {
    setup();
    const account = await screen.findByTestId('gen-account-youtube-ch1');
    await waitFor(() => expect(account).toBeChecked());

    // Deselecting every account of a selected provider blocks submit loudly.
    fireEvent.click(account);
    fireEvent.change(screen.getByTestId('gen-persona'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByTestId('gen-topic-0'), { target: { value: 'T1' } });
    fireEvent.click(screen.getByTestId('gen-submit'));

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const error = await screen.findByTestId('gen-error');
    expect(error.textContent).toBe('fillSchedule.genNeedAccounts');
  });

  it('shows a live cost estimate: topics x per-video cost vs balance', async () => {
    setup();
    fireEvent.change(screen.getByTestId('gen-persona'), { target: { value: 'p1' } });
    // Persona One: 50% face mix @ ok => 2 tokens/video
    fireEvent.click(screen.getByTestId('gen-add-topic'));
    fireEvent.click(screen.getByTestId('gen-add-topic'));
    fireEvent.change(screen.getByTestId('gen-topic-0'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('gen-topic-1'), { target: { value: 'B' } });
    fireEvent.change(screen.getByTestId('gen-topic-2'), { target: { value: 'C' } });
    const { useI18n } = await import('@/lib/i18n/provider');
    const t = vi.mocked(useI18n)().t;
    // 3 topics x 2 tokens = 6 estimated, 100 balance
    await waitFor(() => expect(t).toHaveBeenCalledWith('fillSchedule.genEstimatedCost', { cost: 6, perVideo: 2 }));
    expect(t).toHaveBeenCalledWith('fillSchedule.genBalance', { balance: 100 });

    // Faceless drops the per-video cost to 1.
    fireEvent.click(screen.getByTestId('gen-faceless'));
    await waitFor(() => expect(t).toHaveBeenCalledWith('fillSchedule.genEstimatedCost', { cost: 3, perVideo: 1 }));
  });
});
