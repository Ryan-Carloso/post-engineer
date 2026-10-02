import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the post detail page (/posts/[id]) — resolves the entity by
// id through the detail endpoints (GET /api/schedule/slots/:id and
// GET /api/persona/video-generations/:id), never by scanning the history
// lists.
//---------------

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ id: 'u1' })),
  useRouter: vi.fn(() => ({ push: pushMock })),
}));

vi.mock('@/lib/api', () => ({
  useSlotDetailQuery: vi.fn(),
  useGenerationDetailQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useUpdateSlotMutation: vi.fn(),
  useDeleteSlotMutation: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  ExternalLinkIcon: () => <span data-testid="icon-external-link" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }));
  return { useI18n, I18nProvider };
});

import DetailPage from '../page';
import {
  useSlotDetailQuery,
  useGenerationDetailQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
} from '@/lib/api';
import { useParams } from 'next/navigation';

const SLOT_SCHEDULE = {
  id: 's1',
  personaId: 'p1',
  providers: ['youtube'],
  youtubeAccountIds: ['ch1'],
  instagramAccountIds: [],
  linkedinAccountIds: [],
};

function slotPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slot: {
      id: 'u1',
      scheduleId: 's1',
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'awaiting',
      topic: 'Upcoming topic',
      error: null,
      publishedAt: null,
      taskId: null,
      progress: 0,
      stage: null,
      retryable: null,
      ...overrides,
    },
    schedule: SLOT_SCHEDULE,
    persona: { id: 'p1', name: 'Viva Leve' },
  };
}

const PUBLISHED_PAYLOAD = slotPayload({
  id: 'r1',
  status: 'published',
  topic: 'Past topic',
  publishedAt: '2020-01-01T10:05:00.000Z',
  taskId: 'task-9',
  progress: 100,
  stage: 'done',
});

const GENERATING_PAYLOAD = slotPayload({
  id: 'gen-slot',
  status: 'generating',
  topic: 'Cooking topic',
  taskId: 'task-7',
  progress: 45,
  stage: 'lipsync',
});

const FAILED_PAYLOAD = slotPayload({
  id: 'r2',
  status: 'failed',
  topic: 'Failed topic',
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
};

function mockQueries(overrides: {
  slot?: Record<string, unknown> | null;
  generation?: Record<string, unknown> | null;
  slotLoading?: boolean;
} = {}) {
  vi.mocked(useSlotDetailQuery).mockImplementation((id: string) => {
    // The page asks for the route id; 'u1' is the default fixture's id.
    const isFixtureId = id === ((overrides.slot?.slot as { id?: string })?.id ?? 'u1');
    if (overrides.slotLoading) {
      return { data: undefined, isLoading: true, isError: false, error: null } as never;
    }
    return {
      data: isFixtureId ? ((overrides.slot ?? slotPayload()) as never) : ((overrides.slot ?? null) as never),
      isLoading: false,
      isError: false,
      error: null,
    } as never;
  });
  vi.mocked(useGenerationDetailQuery).mockReturnValue({
    data: (overrides.generation ?? null) as never,
    isLoading: false,
    isError: false,
    error: null,
  } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ channelId: 'ch1', channelName: 'Europa Na Estrada' }] },
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
}

function mockMutations() {
  // Real react-query invokes the per-call callbacks on success — the
  // mocks mirror that so onSuccess side effects (close editor, redirect)
  // are exercised.
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
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueries();
  mockMutations();
  vi.mocked(useParams).mockReturnValue({ id: 'u1' });
});

describe('PostDetailPage', () => {
  it('shows the awaiting slot with its topic and the edit/delete actions', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    expect(screen.getByText('Viva Leve')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    expect(screen.getByLabelText('posts.topicLabel')).toHaveValue('Upcoming topic');
    expect(screen.getByRole('button', { name: 'posts.delete' })).toBeInTheDocument();
  });

  it('saves an edited topic through the mutation', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    const textarea = screen.getByLabelText('posts.topicLabel');
    await user.clear(textarea);
    await user.type(textarea, 'New topic');
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    const mutate = vi.mocked(useUpdateSlotMutation).mock.results[0].value.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith({ slotId: 'u1', topic: 'New topic' }, expect.anything());
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
        ],
      }),
    });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    const youtube = screen.getByRole('link', { name: /YouTube/ });
    expect(youtube).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc');
    const instagram = screen.getByRole('link', { name: /Instagram/ });
    expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/p/xyz/');
  });

  // Published links open another site, so they must never share the tab
  // with the app itself.
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
    // The player must keep the video's intrinsic aspect ratio — faceless
    // videos are often vertical (9:16) and a forced 16:9 box letterboxes
    // them into a black rectangle.
    expect(video?.className).toContain('h-auto');
    expect(video?.className).not.toContain('aspect-video');
    expect(screen.queryByRole('button', { name: 'posts.edit' })).not.toBeInTheDocument();
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
      error: new Error('Only a slot that has not started generating can be edited.'),
    } as never);
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.edit' }));
    await user.click(screen.getByRole('button', { name: 'posts.save' }));

    expect(await screen.findByText('Only a slot that has not started generating can be edited.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('resolves a completed generation with its video and no slot actions', () => {
    mockQueries({ slot: null, generation: COMPLETED_GENERATION });
    vi.mocked(useParams).mockReturnValue({ id: 'gen-3' });
    render(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-3/final-1.mp4');
    expect(screen.queryByRole('button', { name: 'posts.delete' })).not.toBeInTheDocument();
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
