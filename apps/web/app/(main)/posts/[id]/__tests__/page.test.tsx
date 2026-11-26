import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const pushMock = vi.fn();

const mockT = vi.fn((key: string, _vars?: Record<string, unknown>) => key);

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ id: 'u1' })),
  useRouter: vi.fn(() => ({ push: pushMock })),
}));

vi.mock('@/lib/api', () => ({
  usePostDetailQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useThreadsAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
  useFacebookAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
  useBlueskyAccountsQuery: vi.fn(),
  useUpdateSlotMutation: vi.fn(),
  useDeleteSlotMutation: vi.fn(),
}));

vi.mock('@/lib/api-slot-reschedule', () => ({
  useRescheduleSlotMutation: vi.fn(),
}));

vi.mock('@/lib/social-accounts-queries', () => ({
  useRumbleAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/pinterest-accounts', () => ({
  usePinterestAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/fanvue-accounts', () => ({
  useFanvueAccountsQuery: vi.fn(() => ({ data: { authenticated: true, accounts: [] }, isLoading: false, error: null })),
}));

vi.mock('@/lib/ui', () => ({
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  ExternalLinkIcon: () => <span data-testid="icon-external-link" />,
  GoogleIcon: () => <span data-testid="icon-google" />,
  InstagramIcon: () => <span data-testid="icon-instagram" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: mockT, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import DetailPage from '../page';
import {
  usePostDetailQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useBlueskyAccountsQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
} from '@/lib/api';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { useRescheduleSlotMutation } from '@/lib/api-slot-reschedule';

const SLOT_SCHEDULE = {
  id: 's1',
  personaId: 'p1',
  providers: ['youtube'],
  youtubeAccountIds: ['ch1'],
  instagramAccountIds: [],
  linkedinAccountIds: [],
  timezone: 'Europe/Lisbon',
  publishMode: 'scheduled',
};

function slotPayload(
  overrides: Record<string, unknown> = {},
  topOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slot: {
      id: 'u1',
      scheduleId: 's1',
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'ready',
      title: 'Upcoming topic',
      error: null,
      publishedAt: null,
      publishLinks: [],
      userNotices: [],
      providerFailures: [],
      postUrl: null,
      ...overrides,
    },
    schedule: SLOT_SCHEDULE,
    persona: { id: 'p1', name: 'Viva Leve' },
    prompt: null,
    ...topOverrides,
  };
}

const PUBLISHED_PAYLOAD = slotPayload({
  id: 'r1',
  status: 'published',
  title: 'Past topic',
  publishedAt: '2020-01-01T10:05:00.000Z',
});

const FAILED_PAYLOAD = slotPayload({
  id: 'r2',
  status: 'failed',
  title: 'Failed topic',
  error: 'Upload failed',
  publishedAt: null,
});

function mockQueries(overrides: {
  slot?: Record<string, unknown> | null;
  slotLoading?: boolean;
} = {}) {
  vi.mocked(usePostDetailQuery).mockImplementation((id: string) => {
    const slotPayloadId = ((overrides.slot as { slot?: { id?: string } } | null)?.slot as { id?: string } | undefined)?.id ?? 'u1';
    const isFixtureId = id === slotPayloadId;
    if (overrides.slotLoading) {
      return { data: undefined, isLoading: true, isError: false, error: null } as never;
    }
    let data: unknown = null;
    if (isFixtureId) {
      data = overrides.slot === null ? null : (overrides.slot ?? slotPayload());
    } else if (overrides.slot) {
      data = overrides.slot;
    }
    return {
      data: data as never,
      isLoading: false,
      isError: false,
      error: null,
    } as never;
  });
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ channelId: 'ch1', channelName: 'Europa Na Estrada' }] },
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
}

function mockMutations() {
  vi.mocked(useUpdateSlotMutation).mockReturnValue({
    mutate: vi.fn((...args: unknown[]) => {
      const options = args[args.length - 1] as { onSuccess?: () => void } | undefined;
      options?.onSuccess?.();
    }),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useDeleteSlotMutation).mockReturnValue({
    mutate: vi.fn((...args: unknown[]) => {
      const options = args[args.length - 1] as { onSuccess?: () => void } | undefined;
      options?.onSuccess?.();
    }),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useRescheduleSlotMutation).mockReturnValue({
    mutate: vi.fn((...args: unknown[]) => {
      const options = args[args.length - 1] as { onSuccess?: () => void } | undefined;
      options?.onSuccess?.();
    }),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    error: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useI18n).mockReturnValue({ t: mockT, locale: 'en', setLocale: vi.fn() });
  mockQueries();
  mockMutations();
  vi.mocked(useParams).mockReturnValue({ id: 'u1' });
});

describe('PostDetailPage', () => {
  it('shows the ready slot with its caption and the edit/delete actions', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Viva Leve' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
    expect(screen.getByLabelText('posts.captionLabel')).toHaveValue('Upcoming topic');
    expect(screen.getByRole('button', { name: 'posts.delete' })).toBeInTheDocument();
  });

  it('saves an edited caption through the mutation', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
    const textarea = screen.getByLabelText('posts.captionLabel');
    await user.clear(textarea);
    await user.type(textarea, 'New title');
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    const mutate = vi.mocked(useUpdateSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith({ slotId: 'u1', title: 'New title' }, expect.anything());
  });

  it('cancels an edit without saving and restores the original caption', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
    const textarea = screen.getByLabelText('posts.captionLabel');
    await user.clear(textarea);
    await user.type(textarea, 'Discarded title');
    await user.click(screen.getByRole('button', { name: 'posts.cancel' }));

    const mutate = vi.mocked(useUpdateSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('posts.captionLabel')).not.toBeInTheDocument();
    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
    expect(screen.getByLabelText('posts.captionLabel')).toHaveValue('Upcoming topic');
  });

  it('lists where the post was published, one link per provider', () => {
    mockQueries({
      slot: slotPayload({
        id: 'r1',
        status: 'published',
        publishedAt: '2020-01-01T10:05:00.000Z',
        publishLinks: [
          { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
          { provider: 'instagram', url: 'https://www.instagram.com/p/xyz/' },
          { provider: 'bluesky', url: 'https://bsky.app/profile/viva.bsky.social/post/1' },
          { provider: 'linkedin', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1' },
        ],
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const youtube = screen.getByRole('link', { name: /YouTube/ });
    expect(youtube).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc');
    const instagram = screen.getByRole('link', { name: /Instagram/ });
    expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/p/xyz/');
    const bluesky = screen.getByRole('link', { name: /Bluesky/ });
    expect(bluesky).toHaveAttribute('href', 'https://bsky.app/profile/viva.bsky.social/post/1');
    const linkedin = screen.getByRole('link', { name: /LinkedIn/ });
    expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/feed/update/urn:li:activity:1');
  });

  it('opens each published link in a new tab', () => {
    mockQueries({
      slot: slotPayload({
        id: 'r1',
        status: 'published',
        publishLinks: [{ provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' }],
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const link = screen.getByRole('link', { name: /YouTube/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows the account notice while the slot is still publishing', () => {
    mockQueries({
      slot: slotPayload({
        id: 'u1',
        status: 'publishing',
        error: 'upload API reported failure',
        userNotices: [{
          provider: 'bluesky',
          accountId: 'b1',
          code: 'email_not_verified',
          requiresUser: true,
          notice: 'raw upstream must not render',
        }],
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('posts.userNoticeEmail');
    expect(screen.queryByText('upload API reported failure')).not.toBeInTheDocument();
    expect(screen.queryByText('raw upstream must not render')).not.toBeInTheDocument();
  });

  it('shows no published-links section when the post is not published yet', () => {
    mockQueries({ slot: slotPayload({ id: 'u1', status: 'ready' }) });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    expect(screen.queryByRole('link', { name: /YouTube/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Instagram/ })).not.toBeInTheDocument();
  });

  it('shows no published-links section when no link was recorded', () => {
    mockQueries({
      slot: slotPayload({ id: 'r1', status: 'published', publishLinks: [] }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    expect(screen.queryByRole('link', { name: /YouTube/ })).not.toBeInTheDocument();
  });

  it('shows the error and allows deleting a failed slot after confirmation', async () => {
    mockQueries({ slot: FAILED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r2' });
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    const mutate = vi.mocked(useDeleteSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith('r2', expect.anything());
  });

  it('redirects back to /posts after a successful deletion', async () => {
    mockQueries({ slot: FAILED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r2' });
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.delete' }));
    await user.click(screen.getByRole('button', { name: 'posts.deleteConfirm' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/posts'));
  });

  it('surfaces the mutation error instead of navigating away', async () => {
    vi.mocked(useUpdateSlotMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error('Only a ready slot can be edited.')),
      isPending: false,
      isError: true,
      error: new Error('Only a pending or ready slot can be edited.'),
    } as never);
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    expect(await screen.findByText('Only a pending or ready slot can be edited.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('offers edit and delete on a ready slot', () => {
    mockQueries({
      slot: slotPayload({ id: 'r1', status: 'ready' }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    expect(screen.getByRole('button', { name: 'posts.editCaption' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.delete' })).toBeInTheDocument();
  });

  it('prefills the reschedule input with the slot time in the schedule timezone', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.reschedule' }));
    expect(screen.getByLabelText('posts.reschedule')).toHaveValue('2030-06-01T11:00');
  });

  it('saves a reschedule through the mutation', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.reschedule' }));
    const input = screen.getByLabelText('posts.reschedule');
    fireEvent.change(input, { target: { value: '2030-06-02T12:00' } });
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    const mutate = vi.mocked(useRescheduleSlotMutation).mock.results[0].value.mutate as ReturnType<
      typeof vi.fn
    >;
    expect(mutate).toHaveBeenCalledWith(
      { slotId: 'u1', slotAt: '2030-06-02T11:00:00.000Z' },
      expect.anything(),
    );
  });

  it('shows no reschedule for an ASAP slot', () => {
    mockQueries({
      slot: slotPayload({}, { schedule: { ...SLOT_SCHEDULE, publishMode: 'asap' } }),
    });
    render(<DetailPage />);

    expect(screen.queryByRole('button', { name: 'posts.reschedule' })).not.toBeInTheDocument();
  });

  it('shows the reschedule error instead of closing the editor', async () => {
    vi.mocked(useRescheduleSlotMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockRejectedValue(new Error('nope')),
      isPending: false,
      isError: true,
      error: new Error('nope'),
    } as never);
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.reschedule' }));
    expect(screen.getByText('posts.rescheduleError')).toBeInTheDocument();
    expect(screen.getByLabelText('posts.reschedule')).toBeInTheDocument();
  });

  it('shows a not-found state with a way back when the post is not found', () => {
    mockQueries({ slot: null });
    vi.mocked(useParams).mockReturnValue({ id: 'unknown-id' });
    render(<DetailPage />);

    expect(screen.getByText('posts.notFound')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'posts.back' })).toHaveAttribute('href', '/posts');
  });

  it('shows a loading skeleton while the detail queries load', () => {
    mockQueries({ slotLoading: true });
    render(<DetailPage />);

    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
  });
});

describe('PostDetailPage — post identity', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('shows the post ID with a copy button that writes it to the clipboard', async () => {
    render(<DetailPage />);

    expect(screen.getByText('posts.postIdLabel')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'posts.copyPostId' }));
    expect(writeText).toHaveBeenCalledWith('u1');
    expect(await screen.findByText('posts.copied')).toBeInTheDocument();
  });

  it('shows the scheduled date in the schedule timezone', () => {
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent('posts.scheduledForLabel');
    expect(section).toHaveTextContent('Jun');
    expect(section).toHaveTextContent('11:00');
    expect(section).toHaveTextContent('(Europe/Lisbon)');
  });

  it('renders the scheduled date in Portuguese when the locale is pt', () => {
    vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() });
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent(/jun/i);
    expect(section).not.toHaveTextContent('Jun');
  });

  it('shows the published date in the schedule timezone for published posts', () => {
    mockQueries({ slot: PUBLISHED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent('posts.publishedOnLabel');
    expect(section).toHaveTextContent('10:05');
    expect(section).toHaveTextContent('(Europe/Lisbon)');
  });

  it('explains ASAP instead of a scheduled time for an unpublished asap post', () => {
    mockQueries({
      slot: {
        ...slotPayload({ status: 'ready' }),
        schedule: { ...SLOT_SCHEDULE, publishMode: 'asap' },
      },
    });
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent('posts.asapLabel');
    expect(section).toHaveTextContent('posts.asapHint');
    expect(section).not.toHaveTextContent('posts.scheduledForLabel');
  });

  it('still shows the published date for an asap post once published', () => {
    mockQueries({
      slot: {
        ...PUBLISHED_PAYLOAD,
        schedule: { ...SLOT_SCHEDULE, publishMode: 'asap' },
      },
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent('posts.publishedOnLabel');
    expect(section).not.toHaveTextContent('posts.asapHint');
  });

  it('falls back to the viewer timezone on a garbage schedule timezone and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockQueries({
        slot: {
          ...slotPayload(),
          schedule: { ...SLOT_SCHEDULE, timezone: 'Not/AZone' },
        },
      });
      render(<DetailPage />);

      const section = screen.getByLabelText('posts.scheduleLabel');
      expect(section).toHaveTextContent('posts.scheduledForLabel');
      expect(section).toHaveTextContent('(Not/AZone)');
      expect(warn).toHaveBeenCalledWith('Ignoring invalid schedule timezone: Not/AZone');
    } finally {
      warn.mockRestore();
    }
  });

  it('lists the target accounts by name', () => {
    render(<DetailPage />);

    expect(screen.getByText('posts.accountsLabel')).toBeInTheDocument();
    expect(screen.getByText('Europa Na Estrada')).toBeInTheDocument();
  });

  it('restarts the copied-indicator window on rapid clicks instead of extending it', async () => {
    vi.useFakeTimers();
    try {
      render(<DetailPage />);

      const button = screen.getByRole('button', { name: 'posts.copyPostId' });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(screen.getByText('posts.copied')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {
        fireEvent.click(button);
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText('posts.copied')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByText('posts.copied')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

});

describe('PostDetailPage — status badge', () => {
  it.each([
    ['ready', 'posts.statusReady', 'bg-warning-soft'],
    ['publishing', 'posts.statusPublishing', 'bg-info-soft'],
    ['published', 'posts.statusPublished', 'bg-success-soft'],
    ['failed', 'posts.statusFailed', 'bg-destructive-soft'],
  ] as const)('labels a %s slot with %s', (status, label, style) => {
    mockQueries({ slot: slotPayload({ id: 'u1', status }) });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    const badge = screen.getByText(label);
    expect(badge.className).toContain(style);
  });

});
