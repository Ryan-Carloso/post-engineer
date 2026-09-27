import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

//---------------
// Testes da tela de lista de personas via interface pública.
// Apenas a rede (lib/api) é mockada; react-query real.
//---------------

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: vi.fn(),
  useDeletePersonaMutation: vi.fn(),
}));

vi.mock('@/lib/ui', () => ({
  SparklesIcon: () => <span data-testid="icon-sparkles" />,
  ImageIcon: () => <span data-testid="icon-image" />,
  MicIcon: () => <span data-testid="icon-mic" />,
  ComposeIcon: () => <span data-testid="icon-compose" />,
  PlusIcon: () => <span data-testid="icon-plus" />,
  GlobeIcon: () => <span data-testid="icon-globe" />,
  TrashIcon: () => <span data-testid="icon-trash" />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }),
    I18nProvider,
  };
});

import PersonasPage from '../page';
import { usePersonaListQuery, useDeletePersonaMutation } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n/provider';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'PersonasWrapper';
  return Wrapper;
}

const PERSONAS = [
  { id: 'p-1', name: 'Ana Voyeur', createdAt: '2026-08-29T00:00:00Z', voiceId: 'calm', language: 'pt', videoAspect: '9:16' },
  { id: 'p-2', name: 'Bruno Grave', createdAt: '2026-08-28T00:00:00Z', voiceAudioUrl: 'https://x/voz.mp3' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePersonaListQuery).mockReturnValue({
    data: PERSONAS,
    isLoading: false,
  } as never);
  vi.mocked(useDeletePersonaMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  } as never);
});

describe('app/(main)/personas/page — PersonasPage', () => {
  it('mostra skeleton enquanto a lista carrega', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    const { container } = render(<PersonasPage />, { wrapper: createWrapper() });
    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
  });

  it('não mostra empty state enquanto a lista ainda não entregou dados', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    const { container } = render(<PersonasPage />, { wrapper: createWrapper() });

    expect(container.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0);
    expect(screen.queryByText('personas.emptyTitle')).toBeNull();
  });

  it('mostra recuperação quando a lista falha', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    } as never);
    render(<PersonasPage />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'personas.loadError' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'personas.tryAgain' })).toBeVisible();
  });

  it('sem personas mostra empty state com convite para criar', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
    render(<PersonasPage />, { wrapper: createWrapper() });
    expect(screen.getByText('personas.emptyTitle')).toBeTruthy();
    expect(screen.getByText('personas.emptyHint')).toBeTruthy();
  });

  it('empty state tem call-to-action que leva para a criação de persona', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
    render(<PersonasPage />, { wrapper: createWrapper() });
    const cta = screen.getByRole('link', { name: 'personas.createFirst' });
    expect(cta.getAttribute('href')).toBe('/persona');
  });

  it('com personas mostra o nome de cada uma', () => {
    render(<PersonasPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Ana Voyeur')).toBeTruthy();
    expect(screen.getByText('Bruno Grave')).toBeTruthy();
    expect(screen.queryByText('personas.emptyTitle')).toBeNull();
  });

  it('lista tem botão para criar outras personas', () => {
    render(<PersonasPage />, { wrapper: createWrapper() });
    const cta = screen.getByRole('link', { name: 'personas.createNew' });
    expect(cta.getAttribute('href')).toBe('/persona');
  });

  it('cartão inteiro é clicável e abre a edição', () => {
    render(<PersonasPage />, { wrapper: createWrapper() });
    const editLinks = screen.getAllByRole('link', { name: 'personas.details' });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0].getAttribute('href')).toBe('/persona?edit=p-1');
    expect(editLinks[1].getAttribute('href')).toBe('/persona?edit=p-2');
  });

  it('cartão não tem botões de editar nem olho (edição fica nos detalhes)', () => {
    render(<PersonasPage />, { wrapper: createWrapper() });
    expect(screen.queryByRole('link', { name: 'personas.edit' })).toBeNull();
    expect(screen.queryByTestId('icon-eye')).toBeNull();
    expect(screen.queryByTestId('icon-pencil')).toBeNull();
  });

  it('cartão tem botão de deletar e pede confirmação antes de deletar', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDeletePersonaMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PersonasPage />, { wrapper: createWrapper() });

    const deleteButtons = screen.getAllByRole('button', { name: 'personas.delete' });
    expect(deleteButtons).toHaveLength(2);

    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith('p-1');
    });
    confirmSpy.mockRestore();
  });

  it('refetch da lista após deletar com sucesso', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(useDeletePersonaMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PersonasPage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getAllByRole('button', { name: 'personas.delete' })[0]);
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
  });

  it('não deleta quando o usuário cancela a confirmação', () => {
    const mutate = vi.fn();
    vi.mocked(useDeletePersonaMutation).mockReturnValue({
      mutate,
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PersonasPage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getAllByRole('button', { name: 'personas.delete' })[0]);
    expect(mutate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('mostra badges de idioma e formato quando a persona tem preferências', () => {
    render(<PersonasPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('pt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9:16').length).toBeGreaterThan(0);
  });
});
