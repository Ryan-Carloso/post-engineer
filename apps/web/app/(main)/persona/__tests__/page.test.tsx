import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const navigation = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
// The current route: '/persona' by default; legacy-path tests point it at
// /personas/<id>/edit to exercise resolveEditingPersonaId.
const pathname = vi.hoisted(() => ({ value: '/persona' }));
const emblaOptions = vi.hoisted(() => ({ value: undefined as unknown }));
const emblaPlugins = vi.hoisted(() => ({ value: undefined as unknown }));
const autoplayOptions = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('embla-carousel-autoplay', () => ({
  default: vi.fn((options: unknown) => {
    autoplayOptions.value = options;
    return { stop: vi.fn() };
  }),
}));

vi.mock('embla-carousel-react', () => ({
  default: vi.fn((options: unknown, plugins: unknown) => {
    emblaOptions.value = options;
    emblaPlugins.value = plugins;
    return [vi.fn(), undefined];
  }),
}));

//---------------
// Tests for the persona creation screen via its public interface.
// Uses the REAL store (zustand is an internal collaborator, not a boundary);
// only the network (lib/api) is mocked.
//---------------

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => navigation,
  useSearchParams: () => searchParams.value,
}));

vi.mock('@/lib/scroll-to-error', () => ({
  scrollToErrorField: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useVoicesQuery: vi.fn(),
  useVoiceSampleLanguagesQuery: vi.fn(),
  createPersona: vi.fn(),
  useUpdatePersonaMutation: vi.fn(),
  usePersonaListQuery: vi.fn(),
  useSchedulesQuery: vi.fn(),
  useYouTubeAccountsQuery: vi.fn(),
  useInstagramAccountsQuery: vi.fn(),
  useBlueskyAccountsQuery: vi.fn(),
  useLinkedinAccountsQuery: vi.fn(),
  usePersonaImagesQuery: vi.fn(() => ({ data: [], isPending: false, isError: false })),
  useUploadPersonaImageMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdatePersonaImageMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeletePersonaImageMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/lib/ui', () => ({
  AlertIcon: () => <span data-testid="icon-alert" />,
  CheckIcon: () => <span data-testid="icon-check" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  UploadIcon: () => <span data-testid="icon-upload" />,
  SpinnerIcon: () => <span data-testid="icon-spinner" />,
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  MicIcon: () => <span data-testid="icon-mic" />,
  FilmIcon: () => <span data-testid="icon-film" />,
  SECTION_LABEL_CLASS: '',
  INPUT_CLASS: '',
  formatFileSize: (v: number) => `${v} B`,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t, locale: 'pt', setLocale: vi.fn() }));
  return {
    useI18n,
    I18nProvider,
  };
});

import PersonaPage from '../page';
import { useVoicesQuery, useVoiceSampleLanguagesQuery, createPersona, useUpdatePersonaMutation, usePersonaListQuery, useSchedulesQuery, useYouTubeAccountsQuery, useInstagramAccountsQuery, useBlueskyAccountsQuery, useLinkedinAccountsQuery } from '@/lib/api';
import type { AccountData, InstagramAccountData } from '@/lib/types';
import type { BlueskyAccountData, LinkedinAccountData } from '@/lib/providers/registry';
import { I18nProvider, useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { scrollToErrorField } from '@/lib/scroll-to-error';

// The QueryClient of the most recent render: spying on its
// invalidateQueries pins the exact query key the submit path invalidates.
let lastQueryClient: QueryClient | null = null;

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = client;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'PersonaWrapper';
  return Wrapper;
}

// The engine's Chatterbox catalog, provider-qualified. The picker shows the
// bare name (the `chatterbox:` prefix and underscores stripped), which is what
// the assertions below click on.
const VOICES = [
  { id: 'chatterbox:ryan' },
  { id: 'chatterbox:en_us_female_01' },
];

const YOUTUBE_ACCOUNTS: AccountData[] = [
  { provider: 'youtube', recordId: 'yt-record', channelId: 'yt-1', channelName: 'Meu canal', connectedAt: 0, lastUsed: 0 },
];

const INSTAGRAM_ACCOUNTS: InstagramAccountData[] = [
  { provider: 'instagram', recordId: 'ig-record', igUserId: 'ig-1', username: 'meu.user', connectedAt: 0, lastUsed: 0 },
];

const LINKEDIN_ACCOUNTS: LinkedinAccountData[] = [
  { provider: 'linkedin', recordId: 'li-record', providerAccountId: 'urn:li:person:1', accountName: 'Ryan Pessoa', accountMetadata: { kind: 'member' }, connectedAt: 0, lastUsed: 0 },
];

const BLUESKY_ACCOUNTS: BlueskyAccountData[] = [
  { provider: 'bluesky', recordId: 'bsky-record', did: 'did:plc:test', handle: 'test.bsky.social', connectedAt: 0, lastUsed: 0 },
];

function mockConnectedAccounts() {
  vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: YOUTUBE_ACCOUNTS },
    isLoading: false,
  });
  vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: INSTAGRAM_ACCOUNTS },
    isLoading: false,
  });
  vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: BLUESKY_ACCOUNTS },
    isLoading: false,
  });
  vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: LINKEDIN_ACCOUNTS },
    isLoading: false,
  });
}

function mockNoAccounts() {
  vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
  });
  vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
  });
  vi.mocked(useBlueskyAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
  });
  vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // PersonaPublishingAccountsSection loads its defaults via fetch on mount;
  // stub it to empty defaults so edit-mode renders stay network-free.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          defaults: { youtube: [], instagram: [], bluesky: [], linkedin: [] },
        }),
    }),
  );
  // The photo preview calls URL.createObjectURL on the picked file; the
  // jsdom/vitest Blob shim cannot serialize a test File, so the preview
  // URL is stubbed (the tests assert on the picked file, not the URL).
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-photo');
  vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() });
  usePersonaStore.getState().resetForm();
  searchParams.value = new URLSearchParams();
  pathname.value = '/persona';
  emblaOptions.value = undefined;
  emblaPlugins.value = undefined;
  autoplayOptions.value = undefined;
  vi.mocked(useVoicesQuery).mockReturnValue({
    data: VOICES,
    isLoading: false,
  } as never);
  vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
    data: [
      { code: 'pt-br', label: 'Português (BR)' },
      { code: 'en-uk', label: 'English (UK)' },
    ],
    isLoading: false,
  } as never);
  vi.mocked(createPersona).mockResolvedValue({ success: true, personaId: 'p-1' } as never);
  vi.mocked(useSchedulesQuery).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
  mockConnectedAccounts();
});

describe('app/(main)/persona/page — PersonaPage', () => {
  it('mostra skeleton enquanto as vozes carregam', () => {
    vi.mocked(useVoicesQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });
    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('não depende mais de contas conectadas para carregar', () => {
    vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByText('persona.title')).toBeTruthy();
    // Loading the persona form must not depend on connected accounts, and
    // no scheduling UI may render while it does.
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(screen.queryByText('publishing.mustSelectAccount')).toBeNull();
  });

  it('mostra uma página de erro e permite tentar carregar as vozes novamente', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: undefined,
      error: new Error('Voices service unreachable.'),
      isError: true,
      isLoading: false,
      isFetching: false,
      refetch,
    } as never);

    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'persona.loadError' })).toBeTruthy();
    expect(screen.getByText('persona.loadErrorHint')).toBeTruthy();
    expect(screen.queryByLabelText('persona.name')).toBeNull();
    // Not fetching: no spinner next to the retry button.
    expect(screen.queryByTestId('icon-spinner')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renderiza o cabeçalho da página', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('persona.title')).toBeTruthy();
    expect(screen.getByText('persona.subtitle')).toBeTruthy();
  });

  it('renderiza campo de nome da persona', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('persona.name')).toBeTruthy();
  });

  it('renderiza abas para escolher um personagem ou enviar uma foto', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('tab', { name: 'persona.characterTab' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'persona.uploadTab' })).toBeTruthy();
  });

  it('aba de personagens mostra os rostos disponíveis sem geração por IA', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'persona.characterLabel 1' })).toBeTruthy();
    expect(screen.queryByText('persona.generate')).toBeNull();
  });

  it('mostra os personagens em um carrossel horizontal infinito com autoplay e imagens 9:16', () => {
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('region')).toHaveAttribute('aria-roledescription', 'carousel');
    expect(container.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(14);
    const firstCharacterImage = screen
      .getByRole('button', { name: 'persona.characterLabel 1' })
      .querySelector('img');
    expect(firstCharacterImage).toHaveClass('aspect-9/16');
  });

  it('para o autoplay e seleciona o personagem clicado', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    const character = screen.getByRole('button', { name: 'persona.characterLabel 2' });
    await user.click(character);

    expect(character).toHaveAttribute('aria-pressed', 'true');
    expect(usePersonaStore.getState().avatarUrl).toBe('/caracter-samples/file-2.png');
  });

  it('inicia o carrossel no avatar da persona em edição sem scroll manual', async () => {
    searchParams.value = new URLSearchParams('edit=p-1');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'p-1', name: 'Persona editada', avatarUrl: '/caracter-samples/file-7.png' }],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'persona.characterLabel 7' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(emblaOptions.value).toMatchObject({ startIndex: 6 });
    expect(autoplayOptions.value).toMatchObject({ delay: 1_000_000 });
  });

  it('aba de upload mostra o seletor de foto', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(screen.getByText('persona.photoUpload')).toBeTruthy();
  });

  it('mantém as imagens dos personagens montadas ao trocar de aba', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    const anaImage = screen.getByRole('button', { name: 'persona.characterLabel 1' });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(anaImage).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'persona.characterTab' }));
    expect(screen.getByRole('button', { name: 'persona.characterLabel 1' })).toBe(anaImage);
  });

  it('lista as vozes da casa para escolha', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('ryan')).toBeTruthy();
    expect(screen.getByText('en us female 01')).toBeTruthy();
  });

  it('escolher uma voz marca a opção como selecionada', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText('en us female 01'));

    expect(usePersonaStore.getState().voiceId).toBe('chatterbox:en_us_female_01');
  });

  it('submit sem nome mostra erro de validação', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText('persona.submit'));

    expect(createPersona).not.toHaveBeenCalled();
    expect(screen.getByText('persona.errName')).toBeTruthy();
  });

  //---------------
  // preencherFormularioValido — fluxo completo: personagem + nome + voz
  //---------------

  it('submit válido envia a persona e mostra sucesso', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => {
      expect(createPersona).toHaveBeenCalledTimes(1);
    });
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('name')).toBe('Zé Persona');
    expect(formData.get('voiceId')).toBe('chatterbox:ryan');
    expect(formData.get('videoAspect')).toBe('9:16');
    expect(await screen.findByText('persona.created')).toBeTruthy();
    // Creating a persona lands on the personas list, where the user sees
    // the persona that was just created.
    expect(navigation.push).toHaveBeenCalledWith('/personas');
  });

  it('mostra o aviso de sucesso parcial quando a criação retorna warnings', async () => {
    vi.mocked(createPersona).mockResolvedValue({
      success: true,
      personaId: 'p-1',
      imageIds: ['img-1'],
      warnings: ['primary_swap_failed'],
    } as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    // The warning code is mapped through i18n (t returns the key in tests).
    expect(await screen.findByText('persona.libraryWarningPrimarySwap')).toBeTruthy();
  });

  it('criação envia as preferências de conteúdo escolhidas', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByRole('button', { name: '16:9' }));
    await user.type(screen.getByLabelText('personas.scriptLabel'), 'Storytelling forte');
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('videoAspect')).toBe('16:9');
    expect(formData.get('language')).toBe('pt');
    expect(formData.has('paragraphNumber')).toBe(false);
    expect(formData.get('scriptPrompt')).toBe('Storytelling forte');
  });

  it('creation sends the chosen layout (persona on top, b-roll below)', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByRole('button', { name: 'personas.layoutReact' }));
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('videoLayout')).toBe('react');
  });

  it('criação usa o idioma do app como default do roteiro e cai para inglês', async () => {
    const user = userEvent.setup();
    const mockSetLocale = vi.fn();
    vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'en', setLocale: mockSetLocale });
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('language')).toBe('en');
  });

  it('criação envia o nicho preenchido', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.type(screen.getByLabelText('personas.nicheLabel'), 'finanças pessoais');
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('niche')).toBe('finanças pessoais');
  });

  it('nicho vazio não é enviado no FormData', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.has('niche')).toBe(false);
  });

  it('erro do servidor mostra feedback de falha com a mensagem', async () => {
    const user = userEvent.setup();
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: [
        { code: 'pt-br', label: 'Português (BR)' },
        { code: 'en-uk', label: 'English (UK)' },
      ],
      isLoading: false,
    } as never);
    vi.mocked(createPersona).mockResolvedValue({ success: false, error: 'deu ruim' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.failed')).toBeTruthy();
    expect(screen.getByText('deu ruim')).toBeTruthy();
  });

  it('resultado de sucesso renderiza botão de criar outra', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.createAnother')).toBeTruthy();
  });
});

//---------------
// fillValidForm — full flow: character + name + voice
// (lives at file level for reuse across describes)
//---------------
async function preencherFormularioValido(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'persona.characterLabel 1' }));
  await user.type(screen.getByLabelText('persona.name'), 'Zé Persona');
  await user.click(screen.getByText('ryan'));
}

describe('app/(main)/persona/page — persona enxuta (sem schedule)', () => {
  it('NÃO renderiza seção de agendamento (contas, dias, horários)', () => {
    mockConnectedAccounts();
    render(<PersonaPage />, { wrapper: createWrapper() });

    // Scheduling has no screen of its own, so the persona form must not
    // carry account pickers, weekday toggles or time inputs. Asserted on
    // what the page actually renders, not on translation keys.
    expect(screen.queryByTitle('Meu canal')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(document.querySelector('[data-testid="schedule-new-tile"]')).toBeNull();
  });

  it('submit NÃO exige contas conectadas e chama POST /api/persona (persona sozinha)', async () => {
    mockNoAccounts();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(createPersona).mock.calls[0][0] as FormData;
    expect(formData.get('name')).toBe('Zé Persona');
    expect(formData.has('schedule')).toBe(false);
  });

  it('sucesso na criação leva o usuário para a lista de personas', async () => {
    mockNoAccounts();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/personas'));
  });

  it('não mostra erro de conta obrigatória nunca mais', async () => {
    mockNoAccounts();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalled());
    expect(screen.queryByText('publishing.mustSelectAccount')).toBeNull();
  });
});

describe('app/(main)/persona/page — modo edição (mesma página do create)', () => {
  const EDIT_PERSONA = {
    id: 'p-9',
    name: 'Persona editada',
    avatarUrl: '/caracter-samples/file-3.png',
    voiceId: 'chatterbox:ryan',
    videoAspect: '9:16',
    scriptPrompt: '',
    niche: '',
  };

  function mockEditMode() {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA],
      isLoading: false,
    } as never);
  }

  it('botão de submit mostra "Salvar alterações" em vez de "Criar persona"', () => {
    mockEditMode();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'personas.save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'persona.submit' })).toBeNull();
  });

  it('cabeçalho mostra título e subtítulo de edição', () => {
    mockEditMode();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByText('personas.editTitle')).toBeTruthy();
    expect(screen.getByText('personas.editSubtitle')).toBeTruthy();
    expect(screen.queryByText('persona.title')).toBeNull();
  });

  //---------------
  // Opening layout round-trip. The column is nullable (migration 018), so an
  // older persona has no layout at all — the editor must show the default and
  // send it, never drop the field on an unrelated save.
  //---------------
  it('in edit mode the saved layout shows selected and is sent back on save', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, videoLayout: 'react' }],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'personas.layoutReact' })).toHaveAttribute('aria-pressed', 'true'),
    );
    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = mutateAsync.mock.calls[0][0].formData as FormData;
    expect(formData.get('videoLayout')).toBe('react');
  });

  it('in edit mode a persona with no saved layout shows the default and sends it', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    const user = userEvent.setup();
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, videoLayout: undefined }],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'personas.layoutStandard' })).toHaveAttribute('aria-pressed', 'true'),
    );
    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = mutateAsync.mock.calls[0][0].formData as FormData;
    expect(formData.get('videoLayout')).toBe('standard');
  });

  it('submit em edição usa a mutation de update (não o POST de criação)', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    const user = userEvent.setup();
    mockEditMode();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'p-9' }),
    );
    expect(createPersona).not.toHaveBeenCalled();
  });

  //---------------
  // Persona with a user-uploaded PHOTO (photo_path): no chosen character. The
  // editor used `avatarUrl ?? photoUrl`, which put the signed URL (expires in
  // 1h) where a character belongs and re-sent it as avatarUrl on every save —
  // breaking the photo_path+avatar_url check and, without it, swapping the
  // user's face for one they never picked.
  //---------------
  it('em edição, persona com foto não ganha avatarUrl a partir da photoUrl assinada', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [
        {
          ...EDIT_PERSONA,
          avatarUrl: undefined,
          photoUrl: 'https://abc.supabase.co/storage/v1/object/sign/personas/u/9a42.png?token=SECRET',
        },
      ],
      isLoading: false,
    } as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    // The stored photo is shown in the upload tab instead of an empty uploader.
    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(screen.getByText('persona.photoCurrent')).toBeTruthy();

    // No character is selected in the carousel...
    expect(usePersonaStore.getState().avatarUrl).toBeNull();

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(mutateAsync).mock.calls[0][0].formData as FormData;
    // ...and the save never sends a signed storage URL as avatarUrl.
    expect(formData.has('avatarUrl')).toBe(false);
  });

  it('em edição, persona com foto mostra o avatar atual na aba de personagens', async () => {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, avatarUrl: undefined, photoUrl: 'https://abc.supabase.co/p.png' }],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    // No house character is highlighted (the persona has its own photo).
    expect(screen.getByRole('button', { name: 'persona.characterLabel 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('modo criação mantém o botão "Criar persona" e o cabeçalho de criação', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'persona.submit' })).toBeTruthy();
    expect(screen.getByText('persona.title')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'personas.save' })).toBeNull();
  });

  it('em edição, o idioma da amostra inicia com o idioma da persona (es), não pt-br', () => {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, language: 'es' }],
      isLoading: false,
    } as never);
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: [
        { code: 'pt-br', label: 'Português (BR)' },
        { code: 'es', label: 'Español' },
        { code: 'en-uk', label: 'English (UK)' },
      ],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('es');
  });

  it('em edição, idioma da persona sem código exato usa o prefixo mais próximo (pt → pt-br)', () => {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, language: 'pt' }],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('pt-br');
  });

  it('em edição, idioma da persona sem amostra correspondente mantém o padrão pt-br', () => {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, language: 'de' }],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('pt-br');
  });

  it('na criação, o idioma da amostra continua pt-br por padrão', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('pt-br');
  });

  it('trocar o idioma da amostra em edição toca o áudio no idioma escolhido', async () => {
    const created: { url: string; play: ReturnType<typeof vi.fn> }[] = [];
    class FakeAudio {
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      constructor(url: string) {
        created.push({ url, play: this.play });
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ ...EDIT_PERSONA, language: 'es' }],
      isLoading: false,
    } as never);
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: [
        { code: 'pt-br', label: 'Português (BR)' },
        { code: 'es', label: 'Español' },
      ],
      isLoading: false,
    } as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    // Starts at es (the persona's language)…
    expect(screen.getByTestId('sample-language')).toHaveValue('es');
    // …but the user's manual choice wins.
    await user.selectOptions(screen.getByTestId('sample-language'), 'pt-br');
    await user.click(screen.getByRole('button', { name: 'ryan' }));

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('/voice-samples/chatterbox%3Aryan-pt-br.mp3');
    vi.unstubAllGlobals();
  });
});

describe('app/(main)/persona/page — sample language', () => {
  it('mudar o idioma do sample altera a language do áudio tocado', async () => {
    const created: { url: string; play: ReturnType<typeof vi.fn> }[] = [];
    class FakeAudio {
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      constructor(url: string) {
        created.push({ url, play: this.play });
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByTestId('sample-language'), 'en-uk');
    await user.click(screen.getByRole('button', { name: 'ryan' }));

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('/voice-samples/chatterbox%3Aryan-en-uk.mp3');
    vi.unstubAllGlobals();
  });

  it('shows the image library for every edited persona, including a legacy one with no face', async () => {
    // Every persona is faced now, so there is no faceless gate left: the
    // library is exactly how a legacy persona (created without a photo or a
    // character) gets the face it needs. It only needs the loaded data — see
    // the loading test below.
    searchParams.value = new URLSearchParams('edit=p-1');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'p-1', name: 'Legacy editor' }],
      isLoading: false,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLabel')).toBeInTheDocument();
    });
  });

  it('hides the image library while the persona list is still loading', async () => {
    // While editingPersona is undefined the gate must not flash the library:
    // the section is edit-only, and rendering it for a persona that may not
    // exist would offer an upload the server cannot accept.
    searchParams.value = new URLSearchParams('edit=p-1');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.queryByText('persona.libraryLabel')).not.toBeInTheDocument();
    });
  });

  it('never renders the legacy faceless creation mode or the face-mix slider', async () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.queryByRole('radiogroup', { name: 'persona.modeLabel' })).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('face-mix-slider')).not.toBeInTheDocument();
    // The face choice always exists: the avatar section is always rendered.
    expect(screen.getByText('persona.photoLabel')).toBeInTheDocument();
  });
});

//---------------
// Helpers for the coverage suites below: a deferred promise for the
// pending-button tests, a stubbed Audio for the sample tests, and the
// hidden file input for the photo-picker tests.
//---------------
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubAudio() {
  const created: { url: string; play: ReturnType<typeof vi.fn> }[] = [];
  class FakeAudio {
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    constructor(url: string) {
      created.push({ url, play: this.play });
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  return created;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

const EDIT_PERSONA_FULL = {
  id: 'p-9',
  name: 'Persona editada',
  avatarUrl: '/caracter-samples/file-3.png',
  voiceId: 'chatterbox:ryan',
  videoAspect: '9:16',
  scriptPrompt: '',
  niche: '',
};

function mockEditMode(persona: Record<string, unknown>) {
  searchParams.value = new URLSearchParams(`edit=${String(persona.id)}`);
  vi.mocked(usePersonaListQuery).mockReturnValue({
    data: [persona],
    isLoading: false,
  } as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app/(main)/persona/page — validação do submit (guards do store)', () => {
  it('submit com nome só com espaços usa o erro do store, não o do RHF', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.type(screen.getByLabelText('persona.name'), 'Zé Persona');
    await user.click(screen.getByRole('button', { name: 'persona.characterLabel 1' }));
    await user.click(screen.getByText('ryan'));
    // The store name diverges from the field behind the form's back (the
    // form field still holds a valid name, so RHF passes and the
    // store-level trim guard is the one that must fire).
    usePersonaStore.getState().setName('   ');
    await user.click(screen.getByText('persona.submit'));

    expect(createPersona).not.toHaveBeenCalled();
    expect(screen.getByText('persona.errName')).toBeTruthy();
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('name');
  });

  it('submit com nome e voz mas sem avatar mostra erro de avatar', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.type(screen.getByLabelText('persona.name'), 'Zé Persona');
    await user.click(screen.getByText('ryan'));
    await user.click(screen.getByText('persona.submit'));

    expect(createPersona).not.toHaveBeenCalled();
    expect(screen.getByText('persona.errAvatar')).toBeTruthy();
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('avatar');
  });

  it('submit com nome e personagem mas sem voz mostra erro de voz', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.type(screen.getByLabelText('persona.name'), 'Zé Persona');
    await user.click(screen.getByRole('button', { name: 'persona.characterLabel 1' }));
    await user.click(screen.getByText('persona.submit'));

    expect(createPersona).not.toHaveBeenCalled();
    expect(screen.getByText('persona.errVoice')).toBeTruthy();
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('voice');
  });

  it('submit com foto (sem personagem) não mostra erro de avatar', async () => {
    const user = userEvent.setup();
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    await user.upload(fileInput(container), new File(['conteudo'], 'foto.png', { type: 'image/png' }));
    await user.type(screen.getByLabelText('persona.name'), 'Zé Persona');
    await user.click(screen.getByText('ryan'));
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(createPersona).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('persona.errAvatar')).toBeNull();
  });

  it('rejeição do servidor mostra errServer no diálogo', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockRejectedValue(new Error('boom'));
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.errServer')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('prompt_rejected na criação mostra erro inline no roteiro', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockResolvedValue({ success: false, error: 'prompt_rejected' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.errPromptRejected')).toBeTruthy();
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('script');
    // prompt_rejected renders BOTH the inline field error and the error
    // dialog (PersonaFeedback only suppresses the dialog for field errors).
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('erro genérico na criação não mostra erro de prompt nem rola até o roteiro', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockResolvedValue({ success: false, error: 'deu ruim' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });
    const invalidateSpy = vi.spyOn(lastQueryClient as QueryClient, 'invalidateQueries');

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('deu ruim')).toBeTruthy();
    expect(screen.queryByText('persona.errPromptRejected')).toBeNull();
    expect(vi.mocked(scrollToErrorField)).not.toHaveBeenCalledWith('script');
    expect(navigation.push).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('criação com sucesso invalida a lista e navega para personas', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    const invalidateSpy = vi.spyOn(lastQueryClient as QueryClient, 'invalidateQueries');

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/personas'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['persona-list'] });
  });

  it('botão desabilitado enquanto cria e volta a habilitar depois', async () => {
    const gate = deferred<{ success: boolean; personaId: string }>();
    vi.mocked(createPersona).mockImplementation(() => gate.promise as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    const submit = screen.getByText('persona.submit');
    await user.click(submit);

    await waitFor(() => expect(screen.getByText('persona.submitting')).toBeTruthy());
    expect(screen.getByRole('button', { name: /persona\.submitting/ })).toBeDisabled();

    gate.resolve({ success: true, personaId: 'p-1' });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/personas'));
    await waitFor(() => expect(screen.getByText('persona.submit')).toBeEnabled());
  });

  it('criação com warnings vazios não mostra banner âmbar', async () => {
    const user = userEvent.setup();
    vi.mocked(createPersona).mockResolvedValue({ success: true, personaId: 'p-1', warnings: [] } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.created')).toBeTruthy();
    expect(container.querySelector('.text-amber-700')).toBeNull();
  });

  it('sucesso mostra rótulo do resultado e dica', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.click(screen.getByText('persona.submit'));

    expect(await screen.findByText('persona.result')).toBeTruthy();
    expect(screen.getByText('persona.createdHint')).toBeTruthy();
  });

  it('criar outra limpa os campos e o store', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await preencherFormularioValido(user);
    await user.type(screen.getByTestId('persona-niche'), 'finanças');
    await user.click(screen.getByText('persona.submit'));
    expect(await screen.findByText('persona.createAnother')).toBeTruthy();

    await user.click(screen.getByText('persona.createAnother'));

    expect((screen.getByLabelText('persona.name') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('persona-niche') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('personas.scriptLabel') as HTMLTextAreaElement).value).toBe('');
    expect(usePersonaStore.getState().voiceId).toBeNull();
    expect(usePersonaStore.getState().avatarUrl).toBeNull();
  });

  it.each([
    'persona.errName',
    'persona.errAvatar',
    'persona.errVoice',
    'publishing.mustSelectAccount',
  ])('erro de campo %s não abre o diálogo de erro', (error) => {
    usePersonaStore.getState().setResult({ success: false, error });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('diálogo de erro fecha ao clicar em tentar novamente', async () => {
    const user = userEvent.setup();
    usePersonaStore.getState().setResult({ success: false, error: 'deu ruim' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByText('persona.tryAgain')).toBeTruthy();
    await user.click(screen.getByText('persona.tryAgain'));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(usePersonaStore.getState().result).toBeNull();
  });

  it('erro inline de nome aparece com setResult errName e some no sucesso', () => {
    usePersonaStore.getState().setResult({ success: false, error: 'persona.errName' });
    const { unmount } = render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('persona.errName')).toBeTruthy();
    unmount();

    usePersonaStore.getState().setResult({ success: true, error: 'persona.errName' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('persona.errName')).toBeNull();
  });

  it('erro inline de voz aparece com setResult errVoice e some no sucesso', () => {
    usePersonaStore.getState().setResult({ success: false, error: 'persona.errVoice' });
    const { unmount } = render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('persona.errVoice')).toBeTruthy();
    unmount();

    usePersonaStore.getState().setResult({ success: true, error: 'persona.errVoice' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('persona.errVoice')).toBeNull();
  });

  it('erro inline de avatar aparece com setResult errAvatar e some no sucesso', () => {
    usePersonaStore.getState().setResult({ success: false, error: 'persona.errAvatar' });
    const { unmount } = render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('persona.errAvatar')).toBeTruthy();
    unmount();

    usePersonaStore.getState().setResult({ success: true, error: 'persona.errAvatar' } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('persona.errAvatar')).toBeNull();
  });

  it('placeholders e rótulos das seções renderizam', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByLabelText('persona.name')).toHaveAttribute('placeholder', 'persona.namePlaceholder');
    expect(screen.getByText('persona.voiceLabel')).toBeTruthy();
    expect(screen.getByText('personas.preferencesLabel')).toBeTruthy();
    expect(screen.getByText('personas.aspectLabel')).toBeTruthy();
    expect(screen.getByText('persona.sampleLanguage')).toBeTruthy();
    expect(screen.getByText('persona.photoLabel')).toBeTruthy();
  });
});

describe('app/(main)/persona/page — abas, carrossel e seletor de voz', () => {
  it('abas alternam visibilidade, aria-selected e estilo', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    const characterTab = screen.getByRole('tab', { name: 'persona.characterTab' });
    const uploadTab = screen.getByRole('tab', { name: 'persona.uploadTab' });
    expect(characterTab).toHaveAttribute('aria-selected', 'true');
    expect(uploadTab).toHaveAttribute('aria-selected', 'false');
    expect(characterTab.className).toContain('bg-white');
    expect(uploadTab.className).toContain('text-neutral-500');
    const firstCharacter = screen.getByRole('button', { name: 'persona.characterLabel 1' });
    expect(firstCharacter).toBeVisible();
    expect(screen.getByText('persona.photoUpload')).not.toBeVisible();

    await user.click(uploadTab);

    expect(characterTab).toHaveAttribute('aria-selected', 'false');
    expect(uploadTab).toHaveAttribute('aria-selected', 'true');
    expect(characterTab.className).toContain('text-neutral-500');
    expect(uploadTab.className).toContain('bg-white');
    expect(firstCharacter).not.toBeVisible();
    expect(screen.getByText('persona.photoUpload')).toBeVisible();

    await user.click(characterTab);
    expect(firstCharacter).toBeVisible();
  });

  it('carrossel usa autoplay com stopOnInteraction e opções start/loop', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(emblaOptions.value).toMatchObject({ align: 'start', loop: true, startIndex: 0 });
    expect(autoplayOptions.value).toMatchObject({ delay: 5000, stopOnInteraction: true });
    // No character selected: the carousel autoplays.
    expect(emblaPlugins.value).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'persona.characterLabel 1' }));
    // A selected character stops the autoplay plugin entirely.
    expect(emblaPlugins.value).toEqual([]);
  });

  it('carrossel mostra rótulos e personagens', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByText('persona.characterLabel')).toBeTruthy();
    expect(screen.getByText('persona.characterHint')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'persona.characterLabel' })).toBeTruthy();
  });

  it('personagem selecionado ganha borda e selo, os demais não', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.queryByTestId('icon-check')).toBeNull();
    const first = screen.getByRole('button', { name: 'persona.characterLabel 1' });
    const second = screen.getByRole('button', { name: 'persona.characterLabel 2' });

    await user.click(second);

    expect(second.className).toContain('border-accent');
    expect(first.className).toContain('border-border');
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('voz selecionada marca aria-pressed, destaca o card e mostra o selo', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    const ryanButton = screen.getByText('ryan').closest('button') as HTMLButtonElement;
    const otherButton = screen.getByText('en us female 01').closest('button') as HTMLButtonElement;
    expect(screen.queryByTestId('icon-check')).toBeNull();

    await user.click(ryanButton);

    expect(ryanButton).toHaveAttribute('aria-pressed', 'true');
    expect(otherButton).toHaveAttribute('aria-pressed', 'false');
    expect(ryanButton.className).toContain('border-accent');
    expect(otherButton.className).toContain('border-neutral-200');
    expect(ryanButton.querySelector('span')?.className).toContain('bg-accent');
    expect(otherButton.querySelector('span')?.className).toContain('bg-neutral-100');
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('voz com prefixo no meio do id não perde o prefixo', () => {
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: [{ id: 'xxchatterbox:foo' }, { id: 'chatterbox:ryan' }],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    // voiceLabel only strips a LEADING chatterbox: — the anchored ^ matters.
    expect(screen.getByText('xxchatterbox:foo')).toBeTruthy();
    expect(screen.queryByText('xxfoo')).toBeNull();
  });

  it('áudio padrão do sample é pt-br na criação', async () => {
    const created = stubAudio();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText('ryan'));

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('/voice-samples/chatterbox%3Aryan-pt-br.mp3');
  });

  it('trocar o idioma após ouvir repete o sample no novo idioma', async () => {
    const created = stubAudio();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText('ryan'));
    await user.selectOptions(screen.getByTestId('sample-language'), 'en-uk');

    expect(created).toHaveLength(2);
    expect(created[1].url).toBe('/voice-samples/chatterbox%3Aryan-en-uk.mp3');
  });

  it('trocar o idioma sem voz ouvida não toca nada', async () => {
    const created = stubAudio();
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.selectOptions(screen.getByTestId('sample-language'), 'en-uk');

    expect(created).toHaveLength(0);
  });
});

describe('app/(main)/persona/page — seletor de foto', () => {
  it('upload de foto mostra nome, tamanho e botão de trocar', async () => {
    const user = userEvent.setup();
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(screen.getByText('persona.photoHint')).toBeTruthy();
    const input = fileInput(container);
    const clickSpy = vi.spyOn(input, 'click');

    await user.click(screen.getByText('persona.photoUpload'));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await user.upload(input, new File(['conteudo'], 'foto.png', { type: 'image/png' }));

    expect(usePersonaStore.getState().photo?.name).toBe('foto.png');
    expect(screen.getByText('foto.png')).toBeTruthy();
    expect(screen.getByText('8 B')).toBeTruthy();
    expect(screen.getByAltText('persona.photoLabel')).toBeTruthy();
    expect(input.value).toBe('');

    await user.click(screen.getByRole('button', { name: 'persona.photoUpload' }));
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('upload cancelado limpa a foto', async () => {
    const user = userEvent.setup();
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    const input = fileInput(container);
    await user.upload(input, new File(['conteudo'], 'foto.png', { type: 'image/png' }));
    expect(usePersonaStore.getState().photo?.name).toBe('foto.png');

    // No file picked (dialog cancelled): files is null, not an empty list.
    fireEvent.change(input, { target: { files: null } });
    expect(usePersonaStore.getState().photo).toBeNull();

    await user.upload(input, new File(['conteudo'], 'foto.png', { type: 'image/png' }));
    // Empty file list: files[0] is undefined, so the fallback must be null.
    fireEvent.change(input, { target: { files: [] } });
    expect(usePersonaStore.getState().photo).toBeNull();
  });

  it('foto atual em edição mostra a foto guardada e permite trocar', async () => {
    const user = userEvent.setup();
    mockEditMode({
      ...EDIT_PERSONA_FULL,
      avatarUrl: undefined,
      photoUrl: 'https://abc.supabase.co/p.png',
    });
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(screen.getByText('persona.photoCurrent')).toBeTruthy();
    expect(screen.getByAltText('persona.photoLabel')).toBeTruthy();

    const clickSpy = vi.spyOn(fileInput(container), 'click');
    await user.click(screen.getByRole('button', { name: 'persona.photoUpload' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('foto nova vence a foto guardada', async () => {
    const user = userEvent.setup();
    mockEditMode({
      ...EDIT_PERSONA_FULL,
      avatarUrl: undefined,
      photoUrl: 'https://abc.supabase.co/p.png',
    });
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));
    expect(screen.getByText('persona.photoCurrent')).toBeTruthy();

    await user.upload(fileInput(container), new File(['conteudo'], 'nova.png', { type: 'image/png' }));

    expect(screen.getByText('nova.png')).toBeTruthy();
    expect(screen.queryByText('persona.photoCurrent')).toBeNull();
  });

  it('sem foto nem foto guardada, o uploader fica vazio', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: 'persona.uploadTab' }));

    expect(screen.queryByText('persona.photoCurrent')).toBeNull();
    expect(screen.getByText('persona.photoUpload')).toBeTruthy();
  });
});

describe('app/(main)/persona/page — modo edição e sincronização', () => {
  it('caminho legado /personas/<id>/edit abre o modo edição', () => {
    // No ?edit= param: the legacy path alone must resolve the edit id.
    pathname.value = '/personas/p-9/edit';
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA_FULL],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'personas.save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'persona.submit' })).toBeNull();
    expect(screen.getByText('persona.libraryLabel')).toBeTruthy();
  });

  it('caminho com prefixo antes de /personas não é edição', () => {
    pathname.value = '/foo/personas/p-9/edit';
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA_FULL],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'persona.submit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'personas.save' })).toBeNull();
  });

  it('caminho /personas/<id>/edit/extra não é edição', () => {
    pathname.value = '/personas/p-9/edit/extra';
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA_FULL],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'persona.submit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'personas.save' })).toBeNull();
  });

  it('edição encontra a persona certa entre várias', () => {
    searchParams.value = new URLSearchParams('edit=p-2');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [
        { ...EDIT_PERSONA_FULL, id: 'p-1', name: 'Primeira' },
        { ...EDIT_PERSONA_FULL, id: 'p-2', name: 'Segunda' },
      ],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect((screen.getByLabelText('persona.name') as HTMLInputElement).value).toBe('Segunda');
  });

  it('edição com id desconhecido não quebra', () => {
    searchParams.value = new URLSearchParams('edit=p-unknown');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA_FULL],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'personas.save' })).toBeTruthy();
    for (let index = 1; index <= 14; index += 1) {
      expect(screen.getByRole('button', { name: `persona.characterLabel ${index}` })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  it('edição de persona com foto não seleciona personagem da lista', () => {
    searchParams.value = new URLSearchParams('edit=p-2');
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [
        { ...EDIT_PERSONA_FULL, id: 'p-1' },
        { ...EDIT_PERSONA_FULL, id: 'p-2', avatarUrl: undefined, photoUrl: 'https://abc.supabase.co/p.png' },
      ],
      isLoading: false,
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: 'persona.characterLabel 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('lista de personas recarregada atualiza a persona em edição', async () => {
    searchParams.value = new URLSearchParams('edit=p-9');
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
    const { rerender } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.queryByText('persona.libraryLabel')).toBeNull();

    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [EDIT_PERSONA_FULL],
      isLoading: false,
    } as never);
    rerender(<PersonaPage />);

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLabel')).toBeTruthy();
    });
    expect(usePersonaStore.getState().name).toBe('Persona editada');
  });

  it('edição sem campos opcionais usa os padrões', () => {
    mockEditMode({ id: 'p-9', name: 'Só nome' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    const state = usePersonaStore.getState();
    expect(state.videoAspect).toBe('9:16');
    expect(state.scriptPrompt).toBe('');
    expect(state.niche).toBe('');
    expect(state.voiceId).toBeNull();
    expect(state.avatarUrl).toBeNull();
    expect((screen.getByLabelText('personas.scriptLabel') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByTestId('persona-niche') as HTMLInputElement).value).toBe('');
  });

  it('edição com valores preenche os campos', () => {
    mockEditMode({
      ...EDIT_PERSONA_FULL,
      videoAspect: '16:9',
      scriptPrompt: 'Roteiro X',
      niche: 'Nicho Y',
    });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect((screen.getByLabelText('persona.name') as HTMLInputElement).value).toBe('Persona editada');
    expect((screen.getByLabelText('personas.scriptLabel') as HTMLTextAreaElement).value).toBe('Roteiro X');
    expect((screen.getByTestId('persona-niche') as HTMLInputElement).value).toBe('Nicho Y');
    expect(usePersonaStore.getState().videoAspect).toBe('16:9');
    expect(usePersonaStore.getState().scriptPrompt).toBe('Roteiro X');
    expect(usePersonaStore.getState().niche).toBe('Nicho Y');
  });

  it('valores iniciais do store viram defaultValues do formulário', () => {
    usePersonaStore.getState().setName('Nome prévio');
    usePersonaStore.getState().setNiche('Nicho prévio');
    usePersonaStore.getState().setScriptPrompt('Roteiro prévio');
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect((screen.getByLabelText('persona.name') as HTMLInputElement).value).toBe('Nome prévio');
    expect((screen.getByTestId('persona-niche') as HTMLInputElement).value).toBe('Nicho prévio');
    expect((screen.getByLabelText('personas.scriptLabel') as HTMLTextAreaElement).value).toBe(
      'Roteiro prévio',
    );
  });

  it('skeleton quando as vozes carregam mesmo com dados', () => {
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: VOICES,
      isLoading: true,
      isPending: false,
    } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('skeleton quando as vozes não têm dados nem estão carregando', () => {
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
    } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('skeleton quando os idiomas carregam mesmo com dados', () => {
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: [
        { code: 'pt-br', label: 'Português (BR)' },
        { code: 'en-uk', label: 'English (UK)' },
      ],
      isLoading: true,
      isPending: false,
    } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('skeleton quando os idiomas não têm dados nem estão carregando', () => {
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
    } as never);
    const { container } = render(<PersonaPage />, { wrapper: createWrapper() });

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('retry chama só o refetch da query com erro (idiomas)', async () => {
    const voicesRefetch = vi.fn().mockResolvedValue(undefined);
    const sampleRefetch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: VOICES,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: voicesRefetch,
    } as never);
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: undefined,
      error: new Error('Languages down.'),
      isError: true,
      isLoading: false,
      isFetching: false,
      refetch: sampleRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));

    expect(sampleRefetch).toHaveBeenCalledTimes(1);
    expect(voicesRefetch).not.toHaveBeenCalled();
  });

  it('retry chama o refetch de personas quando só ela falha', async () => {
    const personasRefetch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      error: new Error('Personas down.'),
      isError: true,
      isLoading: false,
      refetch: personasRefetch,
    } as never);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'persona.tryAgain' }));

    expect(personasRefetch).toHaveBeenCalledTimes(1);
  });

  it('erro de carregamento mostra spinner enquanto busca', () => {
    vi.mocked(useVoicesQuery).mockReturnValue({
      data: undefined,
      error: new Error('Voices down.'),
      isError: true,
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('icon-spinner')).toBeTruthy();
  });
});

describe('app/(main)/persona/page — preferências e limites', () => {
  it('aspecto: botões existem e o padrão é 9:16', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: '16:9' }));

    expect(usePersonaStore.getState().videoAspect).toBe('16:9');
    expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '9:16' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('aspecto selecionado ganha destaque', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('button', { name: '9:16' }).className).toContain('border-accent');
    expect(screen.getByRole('button', { name: '16:9' }).className).toContain('border-neutral-200');

    await user.click(screen.getByRole('button', { name: '16:9' }));

    expect(screen.getByRole('button', { name: '16:9' }).className).toContain('border-accent');
    expect(screen.getByRole('button', { name: '9:16' }).className).toContain('border-neutral-200');
  });

  it('nicho com 301 caracteres mostra erro ao sair do campo', async () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    const niche = screen.getByTestId('persona-niche');

    fireEvent.change(niche, { target: { value: 'x'.repeat(301) } });
    fireEvent.blur(niche);

    expect(await screen.findByText('personas.nicheMaxError')).toBeTruthy();
  });

  it('roteiro com 2001 caracteres mostra erro ao sair do campo', async () => {
    render(<PersonaPage />, { wrapper: createWrapper() });
    const script = screen.getByLabelText('personas.scriptLabel');

    fireEvent.change(script, { target: { value: 'x'.repeat(2001) } });
    fireEvent.blur(script);

    expect(await screen.findByText('personas.scriptMaxError')).toBeTruthy();
  });

  it('nicho e roteiro têm placeholders e o roteiro tem altura mínima', () => {
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('persona-niche')).toHaveAttribute(
      'placeholder',
      'personas.nichePlaceholder',
    );
    const script = screen.getByLabelText('personas.scriptLabel');
    expect(script).toHaveAttribute('placeholder', 'personas.scriptPlaceholder');
    expect(script.className).toContain('min-h-28');
  });
});

describe('app/(main)/persona/page — submit em edição', () => {
  it('edição salva o formulário com valores aparados', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.clear(screen.getByLabelText('persona.name'));
    await user.type(screen.getByLabelText('persona.name'), '  Nova  ');
    await user.type(screen.getByLabelText('personas.scriptLabel'), '  Roteiro  ');
    await user.type(screen.getByTestId('persona-niche'), '  Nicho  ');
    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(mutateAsync).mock.calls[0][0].formData as FormData;
    expect(formData.get('name')).toBe('Nova');
    expect(formData.get('avatarUrl')).toBe('/caracter-samples/file-3.png');
    expect(formData.get('voiceId')).toBe('chatterbox:ryan');
    expect(formData.get('videoAspect')).toBe('9:16');
    expect(formData.get('scriptPrompt')).toBe('Roteiro');
    expect(formData.get('niche')).toBe('Nicho');
  });

  it('edição com roteiro e nicho só com espaços não os envia', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.type(screen.getByLabelText('personas.scriptLabel'), '   ');
    await user.type(screen.getByTestId('persona-niche'), '   ');
    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(mutateAsync).mock.calls[0][0].formData as FormData;
    expect(formData.has('scriptPrompt')).toBe(false);
    expect(formData.has('niche')).toBe(false);
  });

  it('edição com videoAspect vazio não envia o formato', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode({ ...EDIT_PERSONA_FULL, videoAspect: '' });
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(mutateAsync).mock.calls[0][0].formData as FormData;
    expect(formData.has('videoAspect')).toBe(false);
    expect(formData.get('avatarUrl')).toBe('/caracter-samples/file-3.png');
  });

  it('edição com falha mostra diálogo e não volta', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false, error: 'deu ruim' });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    const invalidateSpy = vi.spyOn(lastQueryClient as QueryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    expect(await screen.findByText('deu ruim')).toBeTruthy();
    expect(navigation.back).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('edição com sucesso volta e invalida a lista', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });
    const invalidateSpy = vi.spyOn(lastQueryClient as QueryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(navigation.back).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['persona-list'] });
  });

  it('edição com prompt_rejected mostra erro inline no roteiro', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: false, error: 'prompt_rejected' });
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    expect(await screen.findByText('persona.errPromptRejected')).toBeTruthy();
    expect(vi.mocked(scrollToErrorField)).toHaveBeenCalledWith('script');
    expect(navigation.back).not.toHaveBeenCalled();
  });

  it('botão mostra Salvando… em edição enquanto salva', async () => {
    const gate = deferred<{ success: boolean }>();
    const mutateAsync = vi.fn().mockImplementation(() => gate.promise);
    vi.mocked(useUpdatePersonaMutation).mockReturnValue({ mutateAsync, isPending: false } as never);
    mockEditMode(EDIT_PERSONA_FULL);
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: 'personas.save' }));

    await waitFor(() => expect(screen.getByText('personas.saving')).toBeTruthy());
    expect(screen.getByRole('button', { name: /personas\.saving/ })).toBeDisabled();

    gate.resolve({ success: true });
    await waitFor(() => expect(navigation.back).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'personas.save' })).toBeEnabled(),
    );
  });

  it('dica de salvar aparece em edição e dica de criar na criação', () => {
    mockEditMode(EDIT_PERSONA_FULL);
    const { unmount } = render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('personas.saveHint')).toBeTruthy();
    unmount();

    searchParams.value = new URLSearchParams();
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
    render(<PersonaPage />, { wrapper: createWrapper() });
    expect(screen.getByText('persona.submitHint')).toBeTruthy();
  });
});

describe('app/(main)/persona/page — idioma da amostra', () => {
  function mockEditWithLanguage(
    language: string,
    languages: Array<{ code: string; label: string }>,
  ) {
    mockEditMode({ ...EDIT_PERSONA_FULL, language });
    vi.mocked(useVoiceSampleLanguagesQuery).mockReturnValue({
      data: languages,
      isLoading: false,
    } as never);
  }

  it('espaços no idioma da persona são ignorados', () => {
    mockEditWithLanguage('  es  ', [
      { code: 'pt-br', label: 'Português (BR)' },
      { code: 'es', label: 'Español' },
    ]);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('es');
  });

  it('prefixo casa o primeiro grupo (en → en-uk)', () => {
    mockEditWithLanguage('en', [
      { code: 'pt-br', label: 'Português (BR)' },
      { code: 'en-uk', label: 'English (UK)' },
    ]);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('en-uk');
  });

  it('prefixo reverso casa o código mais curto (pt-br → pt)', () => {
    mockEditWithLanguage('pt-br', [
      { code: 'es', label: 'Español' },
      { code: 'pt', label: 'Português' },
    ]);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('pt');
  });

  it('código em maiúsculas casa por prefixo sem case', () => {
    mockEditWithLanguage('pt', [{ code: 'PT-BR', label: 'Português (BR)' }]);
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId('sample-language')).toHaveValue('PT-BR');
  });
});

describe('app/(main)/persona/page — índice do personagem', () => {
  it('carrossel começa no avatar de dois dígitos (file-12 → 11)', () => {
    mockEditMode({ ...EDIT_PERSONA_FULL, avatarUrl: '/caracter-samples/file-12.png' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(emblaOptions.value).toMatchObject({ startIndex: 11 });
  });

  it('avatar fora do intervalo volta a 0 (file-15)', () => {
    mockEditMode({ ...EDIT_PERSONA_FULL, avatarUrl: '/caracter-samples/file-15.png' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(emblaOptions.value).toMatchObject({ startIndex: 0 });
  });

  it('avatar file-0 volta a 0', () => {
    mockEditMode({ ...EDIT_PERSONA_FULL, avatarUrl: '/caracter-samples/file-0.png' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(emblaOptions.value).toMatchObject({ startIndex: 0 });
  });

  it('sufixo após .png ignora o avatar (âncora $)', () => {
    mockEditMode({ ...EDIT_PERSONA_FULL, avatarUrl: '/caracter-samples/file-7.png?x=1' });
    render(<PersonaPage />, { wrapper: createWrapper() });

    expect(emblaOptions.value).toMatchObject({ startIndex: 0 });
  });
});
