import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

//---------------
// Tests for /posts/new — the create-post screen.
//
// The screen is the only caller of POST /api/videos/generate-and-schedule in
// the web app, so what matters here is: the request the form builds, the
// guards that must send nothing at all, and the fact that a failure is never
// rendered as raw English server text nor followed by the success redirect.
// Network (lib/api) mocked; stores, i18n keys and slot math are real.
//---------------

const mockMutateAsync = vi.fn();
const mockPush = vi.fn();

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useCreatePostMutation: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/ui', () => {
  // The real module exports the icon set plus the two shared class
  // constants the screen composes with `cn`; a partial mock would make the
  // icons render as undefined components.
  const icons = [
    'AccountsIcon',
    'CalendarIcon',
    'CoinsIcon',
    'ComposeIcon',
    'FilmIcon',
    'GlobeIcon',
    // PersonaAvatar (components/persona-avatar) falls back to it.
    'ImageIcon',
    'PlusIcon',
    'TrashIcon',
    'AlertIcon',
    'CheckIcon',
    'SparklesIcon',
  ];
  return {
    SpinnerIcon: () => <span data-testid="icon-spinner" />,
    INPUT_CLASS: 'input-class',
    SECTION_LABEL_CLASS: 'section-label-class',
    ...Object.fromEntries(icons.map((name) => [name, () => <span data-testid={`icon-${name}`} />])),
  };
});

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      vars === undefined
        ? key
        : `${key}:${Object.entries(vars)
          .map(([name, value]) => `${name}=${value}`)
          .join(',')}`,
    locale: 'en',
    setLocale: vi.fn(),
  }));
  return { useI18n, I18nProvider };
});

import NewPostPage from '../page';
import {
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useBlueskyAccountsQuery,
  useCreatePostMutation,
} from '@/lib/api';
import { useNewPostStore, useUploadStore } from '@/lib/store';
import { MAX_POST_TOPICS } from '@/lib/schedule/slot-distribution';

const PERSONA = {
  id: 'p1',
  name: 'Viva Leve',
  createdAt: '2026-01-01T00:00:00.000Z',
  faceQuality: 'ok',
  avatarUrl: 'https://example.test/avatar.png',
  niche: 'Saúde',
};

// Second option in the picker: needs its own id, the first two share 'p1'.
const SECOND_PERSONA = { ...PERSONA, id: 'p2', name: 'Resenha Fut', niche: 'Futebol' };

// Inside the 3h-30d window relative to the frozen clock (2030-01-01).
const START_AT = '2030-01-05T09:00';
const START_INSTANT = '2030-01-05T09:00:00.000Z';

function mockQueries(overrides: { personas?: unknown[]; isLoading?: boolean; isError?: boolean } = {}) {
  vi.mocked(usePersonaListQuery).mockReturnValue({
    data: (overrides.personas ?? [PERSONA]) as never,
    isLoading: overrides.isLoading ?? false,
    isError: overrides.isError ?? false,
    refetch: vi.fn(),
  } as never);
  vi.mocked(useYouTubeAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ channelId: 'ch1', channelName: 'Europa Na Estrada' }] },
  } as never);
  vi.mocked(useInstagramAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [{ igUserId: 'ig1', username: 'vivalave' }] },
  } as never);
  vi.mocked(useLinkedinAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useBlueskyAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [] },
  } as never);
  vi.mocked(useCreatePostMutation).mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  } as never);
}

/** Fills the mandatory fields so each test only has to break one thing. */
function fillValidDraft(): void {
  useNewPostStore.getState().setPersonaId('p1');
  useNewPostStore.getState().setTopic(0, 'How to grow on YouTube');
  useNewPostStore.getState().setStartAt(START_AT);
  useNewPostStore.getState().setTimezone('UTC');
  useNewPostStore.getState().setTime(0, '09:00');
  useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Frozen clock: the schedule window (3h-30d) is time-dependent, so the
  // preview and the guards must not drift with the machine's date.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
  useNewPostStore.getState().reset();
  useUploadStore.getState().clearSelectedAccounts();
  mockQueries();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NewPostPage', () => {
  it('renders the create form', () => {
    render(<NewPostPage />);

    expect(screen.getByRole('radio', { name: 'Viva Leve' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'newPost.topicsLabel 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'newPost.submit' })).toBeInTheDocument();
  });

  it('renders no feedback banner before any submit', () => {
    render(<NewPostPage />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a skeleton while the persona list loads', () => {
    mockQueries({ isLoading: true });

    render(<NewPostPage />);

    expect(screen.queryByRole('button', { name: 'newPost.submit' })).not.toBeInTheDocument();
  });

  it('blocks submit and sends nothing when no persona is selected', async () => {
    useNewPostStore.getState().setTopic(0, 'A topic');
    useNewPostStore.getState().setStartAt(START_AT);
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.personaRequired');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks submit and sends nothing when no account is selected', async () => {
    useNewPostStore.getState().setPersonaId('p1');
    useNewPostStore.getState().setTopic(0, 'A topic');
    useNewPostStore.getState().setStartAt(START_AT);
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('publishing.mustSelectAccount');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks submit when every topic is blank', async () => {
    useNewPostStore.getState().setPersonaId('p1');
    useNewPostStore.getState().setStartAt(START_AT);
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.errorTopicsRequired');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('sends the generate-and-schedule payload and redirects to the posts list', async () => {
    mockMutateAsync.mockResolvedValue({
      success: true,
      scheduleId: 's1',
      slots: [{ slotId: 'slot-1', slotAt: START_INSTANT, topic: 'How to grow on YouTube', taskId: 't1', status: 'generating' }],
      replayed: false,
      error: null,
      code: null,
      need: null,
      have: null,
    });
    fillValidDraft();
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      personaId: 'p1',
      topics: ['How to grow on YouTube'],
      providers: ['youtube'],
      accounts: { youtube: ['ch1'] },
      startAt: START_INSTANT,
      times: ['09:00'],
      timezone: 'UTC',
      faceless: false,
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/posts'));
  });

  it('maps INSUFFICIENT_TOKENS to localized copy with the server numbers and stays on the screen', async () => {
    mockMutateAsync.mockResolvedValue({
      success: false,
      scheduleId: null,
      slots: [],
      replayed: false,
      error: 'You need 4 tokens, but only have 1.',
      code: 'INSUFFICIENT_TOKENS',
      need: 4,
      have: 1,
    });
    fillValidDraft();
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('newPost.errorInsufficientTokens');
    // need/have are interpolated from the server response, not the raw message.
    expect(alert.textContent).toContain('need=4');
    expect(alert.textContent).toContain('have=1');
    // The raw English server message is never rendered.
    expect(alert).not.toHaveTextContent('You need 4 tokens');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('falls back to the generic message for an unknown server code', async () => {
    mockMutateAsync.mockResolvedValue({
      success: false,
      scheduleId: null,
      slots: [],
      replayed: false,
      error: 'Something the UI has never seen',
      code: 'SOMETHING_NEW',
      need: null,
      have: null,
    });
    fillValidDraft();
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('newPost.errorGeneric');
    expect(alert).not.toHaveTextContent('SOMETHING_NEW');
  });

  it('flags a partial failure (schedule created, a video failed) instead of claiming success', async () => {
    mockMutateAsync.mockResolvedValue({
      success: false,
      scheduleId: 's9',
      slots: [{ slotId: 'slot-9', slotAt: START_INSTANT, topic: 'A', taskId: null, status: 'failed' }],
      replayed: false,
      error: 'Video generation failed.',
      code: 'INTERNAL_ERROR',
      need: null,
      have: null,
    });
    fillValidDraft();
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('newPost.errorGeneric');
    expect(alert).toHaveTextContent('newPost.successPartial');
    expect(mockPush).not.toHaveBeenCalled();
  });

  //---------------
  // The persona picker is a shadcn RadioGroup of persona cards, not a native
  // <select>: the face is the whole point of the choice, so it must show.
  //---------------
  it('picks the persona from cards that carry the face, not from a dropdown', async () => {
    mockQueries({ personas: [PERSONA, SECOND_PERSONA] });
    render(<NewPostPage />);

    expect(screen.getByRole('radiogroup', { name: 'newPost.personaLabel' })).toBeInTheDocument();
    expect(screen.getByAltText('Viva Leve')).toHaveAttribute('src', 'https://example.test/avatar.png');
    // Niche is the persona's second line, like the card in /personas.
    expect(screen.getByText('Saúde')).toBeInTheDocument();

    // Clicking the card (the label) selects it — the visible surface is not
    // the control itself, the sr-only RadioGroupItem is.
    await userEvent.click(screen.getByText('Resenha Fut'));

    expect(useNewPostStore.getState().personaId).toBe('p2');
    expect(screen.getByRole('radio', { name: 'Resenha Fut' })).toBeChecked();
  });

  it('falls back to initials when the persona has no avatar nor photo', () => {
    mockQueries({ personas: [{ ...PERSONA, avatarUrl: undefined }] });
    render(<NewPostPage />);

    expect(screen.queryByAltText('Viva Leve')).not.toBeInTheDocument();
    expect(screen.getByText('VL')).toBeInTheDocument();
  });

  it('says the niche is unset instead of rendering an empty line', () => {
    mockQueries({ personas: [{ ...PERSONA, niche: undefined }] });
    render(<NewPostPage />);

    expect(screen.getByText('newPost.personaNoNiche')).toBeInTheDocument();
  });

  it('selects accounts through the shared selection the accounts screen writes', async () => {
    useUploadStore.getState().toggleSelectedAccount('instagram', 'ig1');
    render(<NewPostPage />);

    expect(screen.getByRole('checkbox', { name: /@vivalave/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Europa Na Estrada/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: /Europa Na Estrada/ }));
    expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch1']);
  });

  it('sends every selected account, one provider per network with a selection', async () => {
    mockMutateAsync.mockResolvedValue({
      success: false,
      scheduleId: null,
      slots: [],
      replayed: false,
      error: 'nope',
      code: 'INTERNAL_ERROR',
      need: null,
      have: null,
    });
    fillValidDraft();
    useUploadStore.getState().toggleSelectedAccount('instagram', 'ig1');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      providers: ['youtube', 'instagram'],
      accounts: { youtube: ['ch1'], instagram: ['ig1'] },
    });
  });

  //---------------
  // "No face" is a per-post choice (personas are always faced): it flips the
  // priced case and travels as options.faceless.
  //---------------
  it('prices a faceless post at 1 token and sends the flag', async () => {
    mockMutateAsync.mockResolvedValue({
      success: true,
      scheduleId: 's1',
      slots: [],
      replayed: false,
      error: null,
      code: null,
      need: null,
      have: null,
    });
    fillValidDraft();
    useNewPostStore.getState().setFaceless(true);
    render(<NewPostPage />);

    // 1 token = the faceless price; the persona's face quality is irrelevant.
    expect(screen.getByText('newPost.costValueOne:cost=1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ faceless: true }));
  });

  it('sends faceless: false by default (the persona shows its face)', async () => {
    mockMutateAsync.mockResolvedValue({
      success: true,
      scheduleId: 's1',
      slots: [],
      replayed: false,
      error: null,
      code: null,
      need: null,
      have: null,
    });
    fillValidDraft();
    render(<NewPostPage />);

    expect(screen.getByRole('radio', { name: 'newPost.faceWithAvatar' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ faceless: false }));
  });

  it('switches the face choice from the form and reprices the batch', async () => {
    fillValidDraft();
    render(<NewPostPage />);

    // With the persona's face (quality ok): 2 tokens.
    expect(screen.getByText('newPost.costValue:cost=2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'newPost.faceFaceless' }));

    expect(screen.getByRole('radio', { name: 'newPost.faceFaceless' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('newPost.costValueOne:cost=1')).toBeInTheDocument();
    expect(useNewPostStore.getState().faceless).toBe(true);
  });

  it('uses the singular cost copy for one one-token video', () => {
    fillValidDraft();
    useNewPostStore.getState().setFaceless(true);
    render(<NewPostPage />);

    expect(screen.getByText('newPost.costValueOne:cost=1')).toBeInTheDocument();
    expect(screen.getByText('newPost.costHintOne:videos=1')).toBeInTheDocument();
  });

  it('switches to the plural copy once there is more than one', () => {
    fillValidDraft();
    useNewPostStore.getState().setFaceless(true);
    useNewPostStore.getState().addTopic();
    useNewPostStore.getState().setTopic(1, 'Another topic');
    render(<NewPostPage />);

    expect(screen.getByText('newPost.costValue:cost=2')).toBeInTheDocument();
    expect(screen.getByText('newPost.costHint:videos=2')).toBeInTheDocument();
  });

  it('pluralizes the token price too (a face video costs 2 tokens)', () => {
    fillValidDraft();
    render(<NewPostPage />);

    expect(screen.getByText('newPost.costValue:cost=2')).toBeInTheDocument();
    expect(screen.getByText('newPost.costHintOne:videos=1')).toBeInTheDocument();
  });

  it('previews the slots the API will create, using the chosen timezone', () => {
    fillValidDraft();
    render(<NewPostPage />);

    expect(screen.getByText('newPost.previewTitle')).toBeInTheDocument();
    expect(screen.getByText(/Jan 5, 2030/)).toBeInTheDocument();
    expect(screen.getByText(/How to grow on YouTube/)).toBeInTheDocument();
    expect(screen.queryByText(/newPost.previewOutOfWindow/)).not.toBeInTheDocument();
  });

  it('warns when a previewed slot falls outside the 3h-30d window', () => {
    fillValidDraft();
    // 40 days out: past the 30-day ceiling.
    useNewPostStore.getState().setStartAt('2030-02-10T09:00');
    render(<NewPostPage />);

    expect(
      screen.getByText('newPost.previewOutOfWindow:minHours=3,maxDays=30'),
    ).toBeInTheDocument();
  });

  it('never lets the form grow past the API topic limit', async () => {
    render(<NewPostPage />);

    const add = screen.getByRole('button', { name: 'newPost.addTopic' });
    for (let i = 0; i < MAX_POST_TOPICS + 5; i += 1) {
      if (!(add as HTMLButtonElement).disabled) await userEvent.click(add);
    }

    expect(useNewPostStore.getState().topics).toHaveLength(MAX_POST_TOPICS);
    expect(add).toBeDisabled();
  });

  it('does not replay a previous visit outcome when the screen is reopened', async () => {
    useNewPostStore.getState().setResult({
      success: true,
      scheduleId: 's-old',
      slotCount: 3,
      code: null,
      need: null,
      have: null,
    });
    fillValidDraft();

    render(<NewPostPage />);

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The typed draft is kept — only the outcome is dropped.
    expect(useNewPostStore.getState().topics).toEqual(['How to grow on YouTube']);
  });

  it('points at the persona screen when the user has no personas', () => {
    mockQueries({ personas: [] });

    render(<NewPostPage />);

    expect(screen.getByText('newPost.noPersonasTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'newPost.createPersona' })).toHaveAttribute('href', '/persona');
    expect(screen.queryByRole('button', { name: 'newPost.submit' })).not.toBeInTheDocument();
  });

  it('blocks the screen when the persona list fails to load', () => {
    mockQueries({ isError: true });

    render(<NewPostPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('posts.loadError');
    expect(screen.queryByRole('button', { name: 'newPost.submit' })).not.toBeInTheDocument();
  });
});
