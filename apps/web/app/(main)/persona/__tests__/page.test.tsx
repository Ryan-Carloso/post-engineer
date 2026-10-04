import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const navigation = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const emblaOptions = vi.hoisted(() => ({ value: undefined as unknown }));
const autoplayOptions = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('embla-carousel-autoplay', () => ({
  default: vi.fn((options: unknown) => {
    autoplayOptions.value = options;
    return { stop: vi.fn() };
  }),
}));

vi.mock('embla-carousel-react', () => ({
  default: vi.fn((options: unknown) => {
    emblaOptions.value = options;
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
  usePathname: () => '/persona',
  useRouter: () => navigation,
  useSearchParams: () => searchParams.value,
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
import { useVoicesQuery, useVoiceSampleLanguagesQuery, createPersona, useUpdatePersonaMutation, usePersonaListQuery, useSchedulesQuery, useYouTubeAccountsQuery, useInstagramAccountsQuery, useLinkedinAccountsQuery } from '@/lib/api';
import type { AccountData, InstagramAccountData } from '@/lib/types';
import type { LinkedinAccountData } from '@/lib/providers/registry';
import { I18nProvider, useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const VOICES = [
  { id: 'calm' },
  { id: 'energetic' },
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

function mockConnectedAccounts() {
  vi.mocked(useYouTubeAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: YOUTUBE_ACCOUNTS },
    isLoading: false,
  });
  vi.mocked(useInstagramAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: INSTAGRAM_ACCOUNTS },
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
  vi.mocked(useLinkedinAccountsQuery, { partial: true }).mockReturnValue({
    data: { authenticated: true, accounts: [] },
    isLoading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useI18n).mockReturnValue({ t: (key: string) => key, locale: 'pt', setLocale: vi.fn() });
  usePersonaStore.getState().resetForm();
  searchParams.value = new URLSearchParams();
  emblaOptions.value = undefined;
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
    expect(screen.getByText('persona.voiceCalm')).toBeTruthy();
    expect(screen.getByText('persona.voiceEnergetic')).toBeTruthy();
  });

  it('escolher uma voz marca a opção como selecionada', async () => {
    const user = userEvent.setup();
    render(<PersonaPage />, { wrapper: createWrapper() });

    await user.click(screen.getByText('persona.voiceEnergetic'));

    expect(usePersonaStore.getState().voiceId).toBe('energetic');
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
    expect(formData.get('voiceId')).toBe('calm');
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
  await user.click(screen.getByText('persona.voiceCalm'));
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
    voiceId: 'calm',
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
    await user.click(screen.getByRole('button', { name: 'persona.voiceCalm' }));

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('/voice-samples/calm-pt-br.mp3');
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
    await user.click(screen.getByRole('button', { name: 'persona.voiceCalm' }));

    expect(created).toHaveLength(1);
    expect(created[0].url).toBe('/voice-samples/calm-en-uk.mp3');
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
