import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for the post detail page (/posts/[id]) — resolves the entity by
// id through the detail endpoints (GET /api/schedule/slots/:id and
// GET /api/persona/video-generations/:id), never by scanning the history
// lists.
//---------------

const pushMock = vi.fn();

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

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
  useBlueskyAccountsQuery: vi.fn(),
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
  useBlueskyAccountsQuery,
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
  timezone: 'Europe/Lisbon',
  publishMode: 'scheduled',
};

function generationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    faceless: false,
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
    generation: generationPayload(),
    ...topOverrides,
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
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
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
  it('shows the awaiting slot with its caption and the edit/delete actions', async () => {
    const user = userEvent.setup();
    render(<DetailPage />);

    expect(screen.getByText('Upcoming topic')).toBeInTheDocument();
    // The header title shows the persona name (the generation-facts section
    // below renders it a second time in its Persona row).
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

  // The scheduled refetch on useSlotDetailQuery delivers the status flip —
  // the page must swap the progress UI for the player without a reload.
  it('swaps the progress UI for the player when a refetch flips generating to ready', () => {
    const generating = slotPayload({
      status: 'generating',
      topic: 'Cooking topic',
      taskId: 'task-7',
      progress: 45,
      stage: 'lipsync',
    });
    const ready = slotPayload({
      status: 'ready',
      topic: 'Cooking topic',
      taskId: 'task-7',
      progress: 100,
      stage: 'done',
    });
    let current: Record<string, unknown> = generating;
    vi.mocked(useSlotDetailQuery).mockImplementation(() => ({
      data: current as never,
      isLoading: false,
      isError: false,
      error: null,
    } as never));

    const { rerender } = render(<DetailPage />);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');

    // The refetch returns ready: the page re-renders with the <video>
    // instead of the progress bar.
    current = ready;
    rerender(<DetailPage />);

    const video = screen.getByRole('region', { name: 'posts.detailsTitle' }).querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/api/persona/video-download/task-7/final-1.mp4');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  //---------------
  // GenerationFactsSection — read-only record of what the post was generated
  // with (the post_* snapshot + faceless flag). Never editable: it records
  // what was charged for.
  //---------------
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
    expect(within(section).getByText('posts.generationLanguageLabel')).toBeInTheDocument();
    expect(within(section).getByText('pt-BR')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationVoiceLabel')).toBeInTheDocument();
    expect(within(section).getByText('ana_neural')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationFormatLabel')).toBeInTheDocument();
    expect(within(section).getByText('9:16')).toBeInTheDocument();
  });

  it('labels a faceless post as faceless and a persona post by name', () => {
    // Faceless direction: the Face row always renders, reading Faceless.
    // A consistent persona-less fixture has no persona row AND a null
    // personaId on the schedule (that is what the page keys noPersona on).
    mockQueries({
      slot: slotPayload({}, {
        persona: null,
        schedule: { ...SLOT_SCHEDULE, personaId: null },
        generation: generationPayload({ faceless: true }),
      }),
    });
    const { unmount } = render(<DetailPage />);
    const facelessSection = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(facelessSection).getByText('posts.generationFaceLabel')).toBeInTheDocument();
    expect(within(facelessSection).getByText('posts.generationFaceless')).toBeInTheDocument();
    expect(within(facelessSection).queryByText('posts.generationWithFace')).not.toBeInTheDocument();
    expect(within(facelessSection).getByText('posts.noPersona')).toBeInTheDocument();
    unmount();

    // Persona direction: the face row must not claim Faceless for a face post.
    mockQueries({ slot: slotPayload() });
    render(<DetailPage />);
    const faceSection = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(faceSection).getByText('posts.generationWithFace')).toBeInTheDocument();
    expect(within(faceSection).queryByText('posts.generationFaceless')).not.toBeInTheDocument();
    expect(within(faceSection).getByText('Viva Leve')).toBeInTheDocument();
  });

  it('renders no row for a fact the post does not have', () => {
    // A null fact produces no row at all — not even the label.
    mockQueries({ slot: slotPayload() });
    render(<DetailPage />);

    const section = screen.getByRole('region', { name: 'posts.generationFactsLabel' });
    expect(within(section).queryByText('posts.generationLanguageLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationVoiceLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationFormatLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationNicheLabel')).not.toBeInTheDocument();
    expect(within(section).queryByText('posts.generationParagraphsLabel')).not.toBeInTheDocument();
    // ...while the always-rendered rows are still there.
    expect(within(section).getByText('posts.generationFaceLabel')).toBeInTheDocument();
    expect(within(section).getByText('posts.generationPersonaLabel')).toBeInTheDocument();
  });

  it('renders every fact row when the post has the full snapshot', () => {
    // Kills the "never push" mutants: each optional fact must appear with
    // its value when present.
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
    // The user's explicit "apenas como readOnly": no button, input or
    // checkbox may appear inside the section.
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
      error: new Error('Only a slot that has not started generating can be edited.'),
    } as never);
    const user = userEvent.setup();
    render(<DetailPage />);

    await user.click(screen.getByRole('button', { name: 'posts.editCaption' }));
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

//---------------
// Post identity — the redesigned detail page surfaces the post's own
// identity: its id with a copy button, the scheduled (or published) date
// rendered in the schedule's timezone, and the target accounts by name.
//---------------
describe('PostDetailPage — post identity', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    // jsdom ships no clipboard — the page calls it on copy.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('shows the post ID with a copy button that writes it to the clipboard', async () => {
    render(<DetailPage />);

    expect(screen.getByText('posts.postIdLabel')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();

    // fireEvent, not user.click: this matches the clipboard-copy tests in
    // api-keys-section/mcp-docs-section — user-event's pointer sequence
    // does not reach the handler under jsdom here.
    fireEvent.click(screen.getByRole('button', { name: 'posts.copyPostId' }));
    expect(writeText).toHaveBeenCalledWith('u1');
    expect(await screen.findByText('posts.copied')).toBeInTheDocument();
  });

  it('shows the scheduled date in the schedule timezone', () => {
    render(<DetailPage />);

    // 2030-06-01T10:00:00Z is 11:00 in Europe/Lisbon (UTC+1 in June) —
    // asserting the converted hour proves the zone is applied, not just
    // printed next to the viewer's local time.
    const section = screen.getByLabelText('posts.scheduleLabel');
    expect(section).toHaveTextContent('posts.scheduledForLabel');
    expect(section).toHaveTextContent('11:00');
    expect(section).toHaveTextContent('(Europe/Lisbon)');
  });

  it('shows the published date in the schedule timezone for published posts', () => {
    mockQueries({ slot: PUBLISHED_PAYLOAD });
    vi.mocked(useParams).mockReturnValue({ id: 'r1' });
    render(<DetailPage />);

    // 2020-01-01T10:05:00Z is 10:05 in Europe/Lisbon (UTC+0 in January).
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

      // The date must not blank: it renders in the viewer's zone instead.
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

  it('restarts the copied-indicator window on rapid clicks instead of extending it', () => {
    vi.useFakeTimers();
    try {
      render(<DetailPage />);

      const button = screen.getByRole('button', { name: 'posts.copyPostId' });
      fireEvent.click(button);
      expect(screen.getByText('posts.copied')).toBeInTheDocument();

      // 2s into the 2.5s window, click again: the window restarts.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      fireEvent.click(button);

      // 2s after the second click the indicator is still up (2s into the
      // restarted window); without the reset it would have cleared 0.5s
      // after the second click.
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
    // 0% after 40% is a regression; 50% after 0% is forward progress.
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
