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
  useVoicesQuery: vi.fn(),
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
    'PlayIcon',
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
  useVoicesQuery,
} from '@/lib/api';
import { useNewPostStore, useUploadStore } from '@/lib/store';

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

function mockQueries(
  overrides: {
    personas?: unknown[];
    isLoading?: boolean;
    isError?: boolean;
    voices?: Array<{ id: string }>;
    voicesError?: boolean;
  } = {},
) {
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
  vi.mocked(useVoicesQuery).mockReturnValue({
    data: overrides.voices ?? [{ id: 'calm' }, { id: 'energetic' }],
    isError: overrides.voicesError ?? false,
  } as never);
}

/** Fills the mandatory fields so each test only has to break one thing. */
/** Fills a persona-backed draft (the common case). */
function fillValidDraft(): void {
  useNewPostStore.getState().setPersonaId('p1');
  useNewPostStore.getState().setTopic('How to grow on YouTube');
  useNewPostStore.getState().setStartAt(START_AT);
  useNewPostStore.getState().setTimezone('UTC');
  useNewPostStore.getState().setTime(0, '09:00');
  useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
}

/** Fills a persona-LESS draft: no persona, an explicit voice instead. */
function fillPersonaLessDraft(): void {
  useNewPostStore.getState().setWithoutPersona(true);
  useNewPostStore.getState().setVoiceId('calm');
  useNewPostStore.getState().setTopic('A topic with no persona');
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
    expect(screen.getByRole('textbox', { name: 'newPost.topicLabel' })).toBeInTheDocument();
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

  it('blocks submit and sends nothing when neither a persona nor "no persona" was chosen', async () => {
    // An untouched personaId means "not chosen yet", which is different from
    // an explicit "no persona" — the form must ask, not assume.
    useNewPostStore.getState().setTopic('A topic');
    useNewPostStore.getState().setStartAt(START_AT);
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.personaRequired');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks submit and sends nothing when no voice is chosen for a persona-less post', async () => {
    // A post with no persona inherits no voice, and the engine refuses a job
    // that speaks with none — so the form must not send it.
    useNewPostStore.getState().setWithoutPersona(true);
    useNewPostStore.getState().setTopic('A topic');
    useNewPostStore.getState().setStartAt(START_AT);
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.voiceRequired');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks submit and sends nothing when no account is selected', async () => {
    useNewPostStore.getState().setPersonaId('p1');
    useNewPostStore.getState().setTopic('A topic');
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

  it('blocks submit when every schedule time is blank', async () => {
    fillValidDraft();
    useNewPostStore.getState().setTime(0, '   ');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.errorInvalidScheduleTime');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks submit when the start date cannot be parsed', async () => {
    fillValidDraft();
    useNewPostStore.getState().setStartAt('not-a-date');
    render(<NewPostPage />);

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('newPost.previewEmpty');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('sends the generate-and-schedule payload and opens the new post detail page', async () => {
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
      mode: 'scheduled',
      startAt: START_INSTANT,
      times: ['09:00'],
      timezone: 'UTC',
      faceless: false,
    });
    // The created slot's own page, not the list: it is where the video and
    // its live progress are.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/posts/slot-1'));
  });

  it('stays on the form when a successful response carries no slot to open', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    // Navigating to /posts/null would 404; the outcome stays readable here.
    expect(mockPush).not.toHaveBeenCalled();
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

  it('prices zero videos while the topic is still blank', () => {
    useNewPostStore.getState().setPersonaId('p1');
    useNewPostStore.getState().setStartAt(START_AT);
    render(<NewPostPage />);

    expect(screen.getByText('newPost.costValue:cost=0')).toBeInTheDocument();
    expect(screen.getByText('newPost.costHint:videos=0')).toBeInTheDocument();
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

  it('offers a single topic field with no add/remove controls', () => {
    render(<NewPostPage />);

    expect(screen.getAllByRole('textbox', { name: 'newPost.topicLabel' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'newPost.addTopic' })).not.toBeInTheDocument();
  });

  it('does not replay a previous visit outcome when the screen is reopened', async () => {
    useNewPostStore.getState().setResult({
      success: true,
      scheduleId: 's-old',
      scheduleMode: 'scheduled',
      slotId: 'slot-old',
      slotCount: 1,
      code: null,
      need: null,
      have: null,
    });
    fillValidDraft();

    render(<NewPostPage />);

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The typed draft is kept — only the outcome is dropped.
    expect(useNewPostStore.getState().topic).toBe('How to grow on YouTube');
  });

  it('still offers the form (persona-less) when the user has no personas', () => {
    // A persona is optional now, so "no personas" is an explanation plus a
    // shortcut to create one — NOT a dead end. The form below is the point.
    mockQueries({ personas: [] });

    render(<NewPostPage />);

    expect(screen.getByText('newPost.noPersonasTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'newPost.createPersona' })).toHaveAttribute('href', '/persona');
    // The persona picker is dropped (a lone "no persona" card teaches nothing)
    // and the persona-less mode is entered automatically.
    expect(screen.queryByRole('radio', { name: 'newPost.personaNone' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'newPost.voiceLabel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'newPost.submit' })).toBeInTheDocument();
  });

  it('blocks the screen when the persona list fails to load', () => {
    mockQueries({ isError: true });

    render(<NewPostPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('posts.loadError');
    expect(screen.queryByRole('button', { name: 'newPost.submit' })).not.toBeInTheDocument();
  });

  describe('without a persona', () => {
    it('offers "no persona" as a card and a voice picker', () => {
      render(<NewPostPage />);

      expect(screen.getByRole('radio', { name: 'newPost.personaNone' })).toBeInTheDocument();
      // The voice field only exists in this mode — with a persona the voice
      // comes from it and the control would be dead weight.
      expect(screen.queryByRole('combobox', { name: 'newPost.voiceLabel' })).not.toBeInTheDocument();
    });

    it('reveals the voice picker and drops the face choice when "no persona" is picked', async () => {
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('radio', { name: 'newPost.personaNone' }));

      expect(screen.getByRole('combobox', { name: 'newPost.voiceLabel' })).toBeInTheDocument();
      // With no persona there is no face to render: only the stock option is
      // offered, never "with the persona's face".
      expect(screen.queryByRole('radio', { name: 'newPost.faceWithAvatar' })).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'newPost.faceFaceless' })).toBeInTheDocument();
    });

    it('hides the voice picker again when a persona is picked', async () => {
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('radio', { name: 'newPost.personaNone' }));
      expect(screen.getByRole('combobox', { name: 'newPost.voiceLabel' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('radio', { name: 'Viva Leve' }));
      expect(screen.queryByRole('combobox', { name: 'newPost.voiceLabel' })).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'newPost.faceWithAvatar' })).toBeInTheDocument();
    });

    it('surfaces a voice-catalog failure instead of an empty picker', async () => {
      mockQueries({ voicesError: true });
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('radio', { name: 'newPost.personaNone' }));

      // The picker would render with no options, which reads as "choose
      // nothing"; the error has to say why the list is empty.
      expect(screen.getByRole('alert')).toHaveTextContent('newPost.voiceLoadError');
      expect(screen.queryByRole('combobox', { name: 'newPost.voiceLabel' })).not.toBeInTheDocument();
    });

    it('sends no personaId, forces faceless and carries the chosen voice', async () => {
      mockMutateAsync.mockResolvedValue({
        success: true,
        scheduleId: 's1',
        slots: [{ slotId: 'slot-1', slotAt: START_INSTANT, topic: 'A topic with no persona', taskId: 't1', status: 'generating' }],
        replayed: false,
        error: null,
        code: null,
        need: null,
        have: null,
      });
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('radio', { name: 'newPost.personaNone' }));
      // The draft helper sets the persona-less mode too, so it goes first and
      // the user's voice choice is the last write.
      fillPersonaLessDraft();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'newPost.voiceLabel' }), 'energetic');
      await userEvent.click(screen.getByRole('button', { name: 'newPost.submit' }));

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      const sent = mockMutateAsync.mock.calls[0][0];
      // The key is ABSENT, not empty: the API reads absence as "no persona".
      expect('personaId' in sent).toBe(false);
      expect(sent.faceless).toBe(true);
      expect(sent.voiceId).toBe('energetic');
    });

    it('prices the persona-less post at the faceless rate, not at zero', () => {
      fillPersonaLessDraft();

      render(<NewPostPage />);

      // No persona means no face quality to read — quoting 0 would promise a
      // free video that the server then charges for.
      expect(screen.getByText('newPost.costValueOne:cost=1')).toBeInTheDocument();
    });
  });

  describe('ASAP publish mode', () => {
    /** Fills everything ASAP needs: no date or times, just the post itself. */
    function fillAsapDraft(): void {
      useNewPostStore.getState().setPersonaId('p1');
      useNewPostStore.getState().setTopic('How to grow on YouTube');
      useNewPostStore.getState().setPublishMode('asap');
      useUploadStore.getState().toggleSelectedAccount('youtube', 'ch1');
    }

    it('offers Schedule and ASAP, with the schedule inputs visible by default', () => {
      render(<NewPostPage />);

      expect(screen.getByRole('radio', { name: 'newPost.publishModeScheduled' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'newPost.publishModeAsap' })).toBeInTheDocument();
      // Scheduled is the default: the date/time inputs render.
      expect(screen.getByLabelText('newPost.startAtLabel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'newPost.submit' })).toBeInTheDocument();
    });

    it('hides the schedule inputs and explains ASAP when the mode is picked', async () => {
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('radio', { name: 'newPost.publishModeAsap' }));

      // Unmounted, not hidden: stale values can never leak into the request.
      expect(screen.queryByLabelText('newPost.startAtLabel')).not.toBeInTheDocument();
      expect(screen.getByText('newPost.publishModeAsapHint')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'newPost.submitAsap' })).toBeInTheDocument();
    });

    it('sends mode asap with no schedule plan and opens the post detail page', async () => {
      mockMutateAsync.mockResolvedValue({
        success: true,
        scheduleId: 's1',
        scheduleMode: 'asap',
        slots: [{ slotId: 'slot-1', slotAt: '2030-01-01T00:05:00.000Z', topic: 'How to grow on YouTube', taskId: 't1', status: 'generating' }],
        replayed: false,
        error: null,
        code: null,
        need: null,
        have: null,
      });
      fillAsapDraft();
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('button', { name: 'newPost.submitAsap' }));

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      const sent = mockMutateAsync.mock.calls[0][0];
      expect(sent.mode).toBe('asap');
      expect('startAt' in sent).toBe(false);
      expect('times' in sent).toBe(false);
      // The browser zone still travels for display.
      expect(sent.timezone).toBe('UTC');
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/posts/slot-1'));
    });

    it('does not require a date in ASAP mode', async () => {
      // The draft helper never sets a date: with the old guards this would
      // reject with previewEmpty before any network call.
      mockMutateAsync.mockResolvedValue({
        success: true,
        scheduleId: 's1',
        scheduleMode: 'asap',
        slots: [],
        replayed: false,
        error: null,
        code: null,
        need: null,
        have: null,
      });
      fillAsapDraft();
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('button', { name: 'newPost.submitAsap' }));

      await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the ASAP success copy after an ASAP create', async () => {
      mockMutateAsync.mockResolvedValue({
        success: true,
        scheduleId: 's1',
        scheduleMode: 'asap',
        slots: [],
        replayed: false,
        error: null,
        code: null,
        need: null,
        have: null,
      });
      fillAsapDraft();
      render(<NewPostPage />);

      await userEvent.click(screen.getByRole('button', { name: 'newPost.submitAsap' }));

      expect(await screen.findByRole('status')).toHaveTextContent('newPost.successTitleAsap');
      expect(screen.getByRole('status')).toHaveTextContent('newPost.successHintAsap');
    });
  });
});
