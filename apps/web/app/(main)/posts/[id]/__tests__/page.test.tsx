import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
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
  GoogleIcon: () => <svg data-testid="icon-google" />,
  InstagramIcon: () => <svg data-testid="icon-instagram" />,
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

function generationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: null,
    voiceover: false,
    language: null,
    voiceId: null,
    videoAspect: null,
    niche: null,
    paragraphNumber: null,
    faceQuality: null,
    ...overrides,
  };
}

function slotPayload(
  overrides: Record<string, unknown> = {},
  topOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slot: {
      id: 'u1',
      scheduleId: 's1',
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'awaiting',
      title: 'Upcoming topic',
      error: null,
      publishedAt: null,
      taskId: null,
      progress: 0,
      stage: null,
      retryable: null,
      scriptAngle: null,
      hookPhoto: { url: null, source: 'none', segmentIndex: null, imageIndex: null },
      ...overrides,
    },
    schedule: SLOT_SCHEDULE,
    persona: { id: 'p1', name: 'Viva Leve' },
    generation: generationPayload(),
    ...topOverrides,
  };
}

const PUBLISHED_PAYLOAD = slotPayload({
  id: 'r1',
  status: 'published',
  title: 'Past topic',
  publishedAt: '2020-01-01T10:05:00.000Z',
  taskId: 'task-9',
  progress: 100,
  stage: 'done',
});

const GENERATING_PAYLOAD = slotPayload({
  id: 'gen-slot',
  status: 'generating',
  title: 'Cooking topic',
  taskId: 'task-7',
  progress: 45,
  stage: 'lipsync',
});

const FAILED_PAYLOAD = slotPayload({
  id: 'r2',
  status: 'failed',
  title: 'Failed topic',
  taskId: 'task-8',
  error: 'Upload failed',
  progress: 80,
  publishedAt: null,
});

const COMPLETED_GENERATION = {
  id: 'row-1',
  generationId: 'gen-3',
  engineTaskId: 'task-3',
  personaName: 'Viva Leve',
  videoSubject: 'Launch recap',
  status: 'completed',
  errorCode: null,
  tokensRefunded: false,
  createdAt: '2026-09-23T12:00:00.000Z',
  completedAt: '2026-09-23T12:02:00.000Z',
  progress: 100,
  stage: null,
  scriptAngle: null,
};

function mockQueries(overrides: {
  slot?: Record<string, unknown> | null;
  generation?: Record<string, unknown> | null;
  slotLoading?: boolean;
} = {}) {
  vi.mocked(usePostDetailQuery).mockImplementation((id: string) => {
    const slotPayloadId = ((overrides.slot as { slot?: { id?: string } } | null)?.slot as { id?: string } | undefined)?.id ?? 'u1';
    const isFixtureId = id === slotPayloadId;
    if (overrides.slotLoading) {
      return { data: undefined, isLoading: true, isError: false, error: null } as never;
    }
    let data: unknown = null;
    if (overrides.generation) {
      data = { kind: 'generation', generation: overrides.generation };
    } else if (isFixtureId) {
      data = { kind: 'slot', ...((overrides.slot ?? slotPayload()) as Record<string, unknown>) };
    } else if (overrides.slot) {
      data = { kind: 'slot', ...(overrides.slot as Record<string, unknown>) };
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
  it('shows the awaiting slot with its caption and the edit/delete actions', async () => {
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
        taskId: 'task-9',
        publishedAt: '2020-01-01T10:05:00.000Z',
        progress: 100,
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
        taskId: 'task-9',
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
    mockQueries({ slot: slotPayload({ id: 'u1', status: 'generating', taskId: 'task-7' }) });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    expect(screen.queryByRole('link', { name: /YouTube/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Instagram/ })).not.toBeInTheDocument();
  });

  it('shows no published-links section when the engine recorded no links', () => {
    mockQueries({
      slot: slotPayload({ id: 'r1', status: 'published', taskId: 'task-9', publishLinks: [] }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    expect(screen.queryByRole('link', { name: /YouTube/ })).not.toBeInTheDocument();
  });

  it('plays the video full-width for a published slot and hides the actions', () => {
    mockQueries({ slot: PUBLISHED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-9/final-1.mp4');
    expect(video?.getAttribute('controls')).not.toBeNull();
    expect(video?.className).toContain('h-auto');
    expect(video?.className).not.toContain('aspect-video');
    expect(screen.queryByRole('button', { name: 'posts.editCaption' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('shows visual debug info (resolution, duration) once the metadata loads', async () => {
    mockQueries({ slot: PUBLISHED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    Object.defineProperty(video, 'videoWidth', { value: 1080 });
    Object.defineProperty(video, 'videoHeight', { value: 1920 });
    Object.defineProperty(video, 'duration', { value: 12.3 });
    video?.dispatchEvent(new Event('loadedmetadata'));

    expect(await screen.findByTestId('video-debug')).toHaveTextContent('1080×1920');
    expect(screen.getByTestId('video-debug')).toHaveTextContent('12s');
    expect(screen.getByTestId('video-debug')).toHaveTextContent('/api/persona/video-download/task-9/final-1.mp4');
  });

  it('shows a visible error state when the video fails to load', async () => {
    mockQueries({ slot: PUBLISHED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    Object.defineProperty(video, 'error', { value: { code: 4 } });
    video?.dispatchEvent(new Event('error'));

    expect(await screen.findByTestId('video-debug')).toHaveTextContent('posts.videoLoadError');
    expect(screen.getByTestId('video-debug')).toHaveTextContent('4');
  });

  it('shows live progress and stage for a generating slot, without a player', () => {
    mockQueries({ slot: GENERATING_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-slot' });
    render(<DetailPage />);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('lipsync')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('swaps the progress UI for the player when a refetch flips generating to ready', () => {
    const generating = slotPayload({
      status: 'generating',
      title: 'Cooking topic',
      taskId: 'task-7',
      progress: 45,
      stage: 'lipsync',
    });
    const ready = slotPayload({
      status: 'ready',
      title: 'Cooking topic',
      taskId: 'task-7',
      progress: 100,
      stage: 'done',
    });
    let current: Record<string, unknown> = generating;
    vi.mocked(usePostDetailQuery).mockImplementation(() => ({
      data: { kind: 'slot', ...current } as never,
      isLoading: false,
      isError: false,
      error: null,
    } as never));

    const { rerender } = render(<DetailPage />);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');

    current = ready;
    rerender(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-7/final-1.mp4');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the hook photo image and its position when the first photo came from a URL', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: {
          url: 'https://e.com/hook.jpg',
          source: 'segment',
          segmentIndex: 0,
          imageIndex: 0,
        },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).getByText('posts.hookPhotoLabel')).toBeInTheDocument();
    const image = within(section).getByAltText('posts.hookPhotoAlt');
    expect(image.getAttribute('src')).toBe('https://e.com/hook.jpg');
    expect(within(section).getByText('posts.hookPhotoSegmentNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoSegmentNote', { segment: 1, image: 1 });
  });

  it('shows the segment note without an image when the first photo has no displayable URL', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: { url: null, source: 'segment', segmentIndex: 0, imageIndex: 1 },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoSegmentNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoSegmentNote', { segment: 1, image: 2 });
  });

  it('explains the upload when the first photo is a media id', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: { url: null, source: 'upload', segmentIndex: 1, imageIndex: 2 },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoUploadNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoUploadNote', { segment: 2, image: 3 });
  });

  it('explains that no photo was sent when no segment photo was sent', () => {
    mockQueries({ slot: slotPayload() });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoNoneNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoNoneNote');
  });

  it.each([
    ['both indices null', null, null],
    ['segment index null', null, 2],
    ['image index null', 0, null],
  ])('falls back to the none note when %s: no position, no image', (_label, segmentIndex, imageIndex) => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: {
          url: 'https://e.com/hook.jpg',
          source: 'segment',
          segmentIndex,
          imageIndex,
        },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoNoneNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoNoneNote');
  });

  it('falls back to the none note for a segment photo with no URL and no position', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: { url: null, source: 'segment', segmentIndex: null, imageIndex: null },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoNoneNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoNoneNote');
  });

  it('never renders an image for an upload photo even when it carries a URL', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: {
          url: 'https://e.com/hook.jpg',
          source: 'upload',
          segmentIndex: 1,
          imageIndex: 2,
        },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoUploadNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoUploadNote', { segment: 2, image: 3 });
  });

  it('never renders the upload note for a none source even with a position', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: {
          url: 'https://e.com/hook.jpg',
          source: 'none',
          segmentIndex: 1,
          imageIndex: 2,
        },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoNoneNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoNoneNote');
  });

  it('falls back to the none note for an upload with no position', () => {
    mockQueries({
      slot: slotPayload({
        hookPhoto: { url: null, source: 'upload', segmentIndex: null, imageIndex: null },
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.hookPhotoLabel' });
    expect(within(section).queryByRole('img')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.hookPhotoNoneNote')).toBeInTheDocument();
    expect(mockT).toHaveBeenCalledWith('posts.hookPhotoNoneNote');
  });

  it('renders no hook photo section for a voiceover video', () => {
    mockQueries({
      slot: slotPayload(
        {},
        {
          persona: null,
          schedule: { ...SLOT_SCHEDULE, personaId: null },
          generation: generationPayload({ voiceover: true }),
        },
      ),
    });
    render(<DetailPage />);

    expect(screen.queryByRole('region', { name: 'posts.hookPhotoLabel' })).not.toBeInTheDocument();
  });

  it('shows the language, voice and format the post was generated with', () => {
    mockQueries({
      slot: slotPayload({}, {
        generation: generationPayload({
          language: 'pt-BR',
          voiceId: 'ana_neural',
          videoAspect: '9:16',
        }),
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(section).getByText('posts.generationFactsLabel')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationLanguageLabel')).toBeInTheDocument();
    expect(within(section).getByText('pt-BR')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationVoiceLabel')).toBeInTheDocument();
    expect(within(section).getByText('ana_neural')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationFormatLabel')).toBeInTheDocument();
    expect(within(section).getByText('9:16')).toBeInTheDocument();
  });

  it('labels a voiceover post as voiceover and a persona post by name', () => {
    mockQueries({
      slot: slotPayload({}, {
        persona: null,
        schedule: { ...SLOT_SCHEDULE, personaId: null },
        generation: generationPayload({ voiceover: true }),
      }),
    });
    const { unmount } = render(<DetailPage />);
    const voiceoverSection = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(voiceoverSection).getByText('posts.generationFaceLabel')).toBeInTheDocument();
    expect(within(voiceoverSection).getByText('posts.generationVoiceover')).toBeInTheDocument();
    expect(within(voiceoverSection).queryByText('posts.generationWithFace')).not.toBeInTheDocument();
    expect(within(voiceoverSection).getByText('posts.noPersona')).toBeInTheDocument();
    unmount();

    mockQueries({ slot: slotPayload() });
    render(<DetailPage />);
    const faceSection = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(faceSection).getByText('posts.generationWithFace')).toBeInTheDocument();
    expect(within(faceSection).queryByText('posts.generationVoiceover')).not.toBeInTheDocument();
    expect(within(faceSection).getByText('Viva Leve')).toBeInTheDocument();
  });

  it('renders no row for a fact the post does not have', () => {
    mockQueries({ slot: slotPayload() });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(section).queryByText('posts.generationLanguageLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationVoiceLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationFormatLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationNicheLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationParagraphsLabel')).not.toBeInTheDocument();
    expect(within(section).getByText('posts.generationFaceLabel')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationPersonaLabel')).toBeInTheDocument();
  });

  it('renders every fact row when the post has the full snapshot', () => {
    mockQueries({
      slot: slotPayload({}, {
        generation: generationPayload({
          language: 'pt-BR',
          voiceId: 'ana_neural',
          videoAspect: '9:16',
          niche: 'cooking',
          paragraphNumber: 5,
        }),
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(section).getByText('posts.generationLanguageLabel')).toBeInTheDocument();
    expect(within(section).getByText('pt-BR')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationVoiceLabel')).toBeInTheDocument();
    expect(within(section).getByText('ana_neural')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationFormatLabel')).toBeInTheDocument();
    expect(within(section).getByText('9:16')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationNicheLabel')).toBeInTheDocument();
    expect(within(section).getByText('cooking')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationParagraphsLabel')).toBeInTheDocument();
    expect(within(section).getByText('5')).toBeInTheDocument();
  });

  it('never offers editing on the generation facts', () => {
    mockQueries({
      slot: slotPayload({}, {
        generation: generationPayload({ language: 'pt-BR', niche: 'cooking', paragraphNumber: 5 }),
      }),
    });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('combobox')).not.toBeInTheDocument();
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
      mutateAsync: vi.fn().mockRejectedValue(new Error('Only a slot that has not started generating can be edited.')),
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

  it('shows a download button for a ready slot', () => {
    mockQueries({
      slot: slotPayload({ id: 'r1', status: 'ready', taskId: 'task-9', progress: 100, stage: 'done' }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const download = screen.getByRole('link', { name: 'posts.downloadVideo' });
    expect(download.getAttribute('href')).toBe(
      '/api/persona/video-download/task-9/final-1.mp4?source=download',
    );
    expect(download.getAttribute('download')).not.toBeNull();
  });

  it('shows no download button for an awaiting slot with no video yet', () => {
    render(<DetailPage />);

    expect(screen.queryByRole('link', { name: 'posts.downloadVideo' })).not.toBeInTheDocument();
  });

  it('offers edit and delete on a ready slot', () => {
    mockQueries({
      slot: slotPayload({ id: 'r1', status: 'ready', taskId: 'task-9', progress: 100, stage: 'done' }),
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

  it('shows no reschedule for a generating slot', () => {
    mockQueries({ slot: GENERATING_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-slot' });
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

  it('resolves a completed generation with its video and no slot actions', () => {
    mockQueries({ slot: null, generation: COMPLETED_GENERATION });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-3/final-1.mp4');
    expect(screen.getByRole('heading', { name: 'Viva Leve' })).toBeInTheDocument();
    expect(screen.getByText('posts.statusCompleted')).toBeInTheDocument();
    expect(screen.getByText('posts.statusCompleted').className).toContain('bg-success-soft');
    expect(screen.getByRole('region', { name: 'posts.detailsTitle' })).toHaveTextContent('Launch recap');
    expect(screen.queryByText('posts.errorUnknown')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.refundedBadge')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
  });

  it('shows the script angle the engine picked for a slot', () => {
    mockQueries({ slot: slotPayload({ status: 'ready', taskId: 'task-1', scriptAngle: 'The myth that keeps coming back' }) });
    render(<DetailPage />);

    expect(screen.getByRole('region', { name: 'posts.scriptAngleLabel' })).toHaveTextContent(
      'The myth that keeps coming back',
    );
  });

  it('shows the script angle for a generation', () => {
    mockQueries({ slot: null, generation: { ...COMPLETED_GENERATION, scriptAngle: 'Recap angle' } });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByRole('region', { name: 'posts.scriptAngleLabel' })).toHaveTextContent('Recap angle');
  });

  it('renders no angle section when the engine recorded none', () => {
    mockQueries();
    render(<DetailPage />);

    expect(screen.queryByRole('region', { name: 'posts.scriptAngleLabel' })).not.toBeInTheDocument();
  });

  it('shows a not-found state with a way back when both lookups return 404', () => {
    mockQueries({ slot: null, generation: null });
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
        ...slotPayload({ status: 'generating' }),
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

  it('shows each target account under its network heading with the accounts page brand tile', () => {
    render(<DetailPage />);

    const youtube = within(screen.getByLabelText('posts.accountsLabel')).getByRole('group', { name: 'accounts.youtubeLabel' });
    expect(within(youtube).getByTestId('provider-brand-youtube')).toBeInTheDocument();
    expect(within(youtube).getByText('Europa Na Estrada')).toBeInTheDocument();
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

  it('shows the post ID on the generation view too', () => {
    mockQueries({ slot: null, generation: COMPLETED_GENERATION });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByText('gen-3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'posts.copyPostId' })).toBeInTheDocument();
  });
});

describe('PostDetailPage — progress history', () => {
  const HISTORY = [
    { progress: 40, stage: 'subtitle', recordedAt: '2026-10-05T22:10:00.000Z' },
    { progress: 0, stage: 'music_mood', recordedAt: '2026-10-05T22:12:00.000Z' },
    { progress: 50, stage: 'materials', recordedAt: '2026-10-05T22:14:00.000Z' },
  ];

  function mockGeneratingWithHistory(history: unknown[]) {
    mockQueries({
      slot: slotPayload({
        id: 'gen-slot',
        status: 'generating',
        taskId: 'task-7',
        progress: 50,
        stage: 'materials',
        progressHistory: history,
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-slot' });
  }

  it('lists the observed progress transitions oldest first', () => {
    mockGeneratingWithHistory(HISTORY);
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.progressHistoryTitle');
    const rows = within(section).getAllByTestId('progress-history-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('40%');
    expect(rows[0]).toHaveTextContent('subtitle');
    expect(rows[1]).toHaveTextContent('0%');
    expect(rows[2]).toHaveTextContent('50%');
  });

  it('marks the regressed row so the 40% -> 0% drop is visible', () => {
    mockGeneratingWithHistory(HISTORY);
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.progressHistoryTitle');
    const rows = within(section).getAllByTestId('progress-history-row');
    expect(rows[0]).not.toHaveAttribute('data-regressed');
    expect(rows[1]).toHaveAttribute('data-regressed', 'true');
    expect(rows[2]).not.toHaveAttribute('data-regressed');
  });

  it('renders a null stage without crashing', () => {
    mockGeneratingWithHistory([{ progress: 10, stage: null, recordedAt: '2026-10-05T22:09:00.000Z' }]);
    render(<DetailPage />);

    const section = screen.getByLabelText('posts.progressHistoryTitle');
    expect(within(section).getByTestId('progress-history-row')).toHaveTextContent('10%');
  });

  it('renders no history section when nothing was recorded', () => {
    mockQueries({ slot: slotPayload({ id: 'u1', status: 'awaiting' }) });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    expect(screen.queryByLabelText('posts.progressHistoryTitle')).not.toBeInTheDocument();
  });
});

function directGeneration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...COMPLETED_GENERATION, ...overrides };
}

describe('PostDetailPage — direct generation progress', () => {
  it('shows live progress for a pending generation that already has a task id', () => {
    mockQueries({
      generation: directGeneration({
        status: 'pending',
        progress: 12,
        stage: 'script',
        engineTaskId: 'task-pending',
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('posts.videoGenerating')).toBeInTheDocument();
    expect(screen.getByText('posts.statusPending')).toBeInTheDocument();
    expect(screen.getByText('script').tagName).toBe('P');
    expect(screen.queryByRole('region', { name: 'posts.detailsTitle' })?.querySelector('video')).toBeNull();
  });

  it('shows live progress once the generation is running', () => {
    mockQueries({
      generation: directGeneration({
        status: 'running',
        progress: 67,
        stage: 'audio',
        engineTaskId: 'task-running',
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('posts.statusRunning')).toBeInTheDocument();
    expect(screen.getByText('posts.statusRunning').className).toContain('bg-info-soft');
    expect(screen.queryByText('posts.coverNoVideo')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'posts.detailsTitle' })?.querySelector('video')).toBeNull();
  });

  it('shows the no-video placeholder while pending with no task id', () => {
    mockQueries({
      generation: directGeneration({ status: 'pending', engineTaskId: null, progress: 0, stage: null }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('posts.coverNoVideo')).toBeInTheDocument();
  });

  it('shows the mapped failure and the refund badge', () => {
    mockQueries({
      generation: directGeneration({
        status: 'failed',
        errorCode: 'custom_audio_invalid',
        tokensRefunded: true,
        engineTaskId: 'task-3',
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByText('posts.errorCustomAudio')).toBeInTheDocument();
    expect(screen.getByText('posts.refundedBadge')).toBeInTheDocument();
    expect(screen.getByText('posts.statusFailed')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'posts.detailsTitle' })?.querySelector('video')).toBeNull();
  });

  it('shows the mapped failure for the newer generation error codes', () => {
    const cases = [
      ['no_first_photo', 'posts.errorNoFirstPhoto'],
      ['engine_restart', 'posts.errorEngineRestart'],
      ['images_do_not_cover_audio', 'posts.errorImagesDoNotCoverAudio'],
    ] as const;
    for (const [errorCode, key] of cases) {
      mockQueries({
        generation: directGeneration({ status: 'failed', errorCode, engineTaskId: 'task-3' }),
      });
      vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
      const { unmount } = render(<DetailPage />);
      expect(screen.getByText(key)).toBeInTheDocument();
      unmount();
    }
  });

  it('falls back to the unknown error when the code is missing or unrecognized', () => {
    mockQueries({
      generation: directGeneration({ status: 'failed', errorCode: null, engineTaskId: null }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    const missing = render(<DetailPage />);
    expect(screen.getByText('posts.errorUnknown')).toBeInTheDocument();
    missing.unmount();

    mockQueries({
      generation: directGeneration({ status: 'failed', errorCode: 'brand_new_code', engineTaskId: null }),
    });
    render(<DetailPage />);
    expect(screen.getByText('posts.errorUnknown')).toBeInTheDocument();
  });

  it('uses the persona and title fallbacks when those fields are null', () => {
    mockQueries({
      generation: directGeneration({ personaName: null, videoSubject: null, status: 'completed' }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByRole('heading', { name: 'posts.personaFallback' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'posts.detailsTitle' })).toHaveTextContent('posts.unknownTitle');
  });

  it('does not enter the generation view when the payload has no generation', () => {
    vi.mocked(usePostDetailQuery).mockReturnValue({
      data: { kind: 'generation' },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    expect(screen.getByRole('heading', { name: 'posts.personaFallback' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('posts.videoGenerating')).not.toBeInTheDocument();
  });
});

describe('PostDetailPage — status badge', () => {
  it.each([
    ['pending', 'posts.statusPending', 'bg-sunken'],
    ['generating', 'posts.statusGenerating', 'bg-info-soft'],
    ['ready', 'posts.statusReady', 'bg-warning-soft'],
    ['publishing', 'posts.statusPublishing', 'bg-info-soft'],
    ['published', 'posts.statusPublished', 'bg-success-soft'],
    ['failed', 'posts.statusFailed', 'bg-destructive-soft'],
  ] as const)('labels a %s slot with %s', (status, label, style) => {
    mockQueries({ slot: slotPayload({ id: 'u1', status, taskId: 'task-status' }) });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    const badge = screen.getByText(label);
    expect(badge.className).toContain(style);
  });

  it('plays the video for a publishing slot', () => {
    mockQueries({
      slot: slotPayload({ id: 'u1', status: 'publishing', taskId: 'task-pub', progress: 100 }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'u1' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-pub/final-1.mp4');
  });
});
