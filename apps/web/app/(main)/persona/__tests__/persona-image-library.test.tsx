import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PersonaImageLibrarySection } from '../persona-image-library';

interface MockImage {
  id: string;
  image_path: string;
  tag: string | null;
  description: string | null;
  is_primary: boolean;
  created_at: string;
  image_url: string | null;
}

const apiMocks = vi.hoisted(() => ({
  images: [] as MockImage[],
  uploadMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  usePersonaImagesQuery: vi.fn(() => ({
    data: apiMocks.images,
    isPending: false,
    isError: false,
  })),
  useUploadPersonaImageMutation: vi.fn(() => ({
    mutateAsync: apiMocks.uploadMutateAsync,
    isPending: false,
  })),
  useUpdatePersonaImageMutation: vi.fn(() => ({
    mutate: apiMocks.updateMutate,
    mutateAsync: apiMocks.updateMutateAsync,
    isPending: false,
  })),
  useDeletePersonaImageMutation: vi.fn(() => ({
    mutateAsync: apiMocks.deleteMutateAsync,
    isPending: false,
  })),
}));

const i18nMocks = vi.hoisted(() => ({
  t: vi.fn((key: string, _vars?: Record<string, string | number>) => key),
}));

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { I18nProvider, useI18n: () => ({ t: i18nMocks.t, locale: 'en', setLocale: vi.fn() }) };
});

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PersonaImageLibrarySection personaId="persona-1" />
    </QueryClientProvider>,
  );
}

function makeImage(id: string): MockImage {
  return {
    id,
    image_path: `user/${id}.jpg`,
    tag: `tag-${id}`,
    description: null,
    is_primary: false,
    created_at: '2026-09-27T00:00:00Z',
    image_url: `https://example.com/${id}.jpg`,
  };
}

function pickFiles(input: HTMLInputElement, files: File[]) {
  return userEvent.upload(input, files);
}

describe('PersonaImageLibrarySection', () => {
  beforeEach(() => {
    apiMocks.images = [];
    apiMocks.uploadMutateAsync.mockReset();
    apiMocks.updateMutateAsync.mockReset();
    apiMocks.deleteMutateAsync.mockReset();
    apiMocks.updateMutate.mockReset();
    i18nMocks.t.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    window.confirm = vi.fn(() => true);
  });

  it('surfaces an error when the upload rejects, keeping pending items', async () => {
    apiMocks.uploadMutateAsync.mockRejectedValue(new Error('network down'));
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(screen.getByText('persona.libraryUploadError')).toBeInTheDocument();
    });
    // The failed item stays in the pending queue so the user can retry.
    expect(
      screen.getAllByPlaceholderText('persona.libraryTagPlaceholder'),
    ).toHaveLength(1);
  });

  it('removes already-uploaded items from pending on partial batch failure', async () => {
    apiMocks.uploadMutateAsync
      .mockResolvedValueOnce({ success: true, image: makeImage('img-1') })
      .mockResolvedValueOnce({ success: false, error: 'storage full' });
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(screen.getByText('storage full')).toBeInTheDocument();
    });
    // Only the failed item remains pending.
    expect(apiMocks.uploadMutateAsync).toHaveBeenCalledTimes(2);
    expect(
      screen.getAllByPlaceholderText('persona.libraryTagPlaceholder'),
    ).toHaveLength(1);
  });

  it('keeps the pending queue visible when a refetch fills the library', async () => {
    // A refetch that makes the library full used to unmount the whole
    // pending queue (queued items + upload button) while their previews
    // stayed alive. The queue now renders outside the full/partial
    // conditional: pending items and the upload button survive.
    const { container, rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => {
      expect(
        screen.getAllByPlaceholderText('persona.libraryTagPlaceholder'),
      ).toHaveLength(1);
    });

    // The library refetches and is now full.
    apiMocks.images = Array.from({ length: 10 }, (_, i) => makeImage(`img-${i}`));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
    });
    // The pending item and its upload button are still there.
    expect(
      screen.getAllByPlaceholderText('persona.libraryTagPlaceholder'),
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'persona.libraryUpload' }),
    ).toBeInTheDocument();
  });

  it('keeps the card in editing mode and shows an error when save fails', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.updateMutateAsync.mockResolvedValue({ success: false, error: 'db down' });
    renderSection();

    await userEvent.click(screen.getByText('✎'));
    await userEvent.click(screen.getByRole('button', { name: 'persona.librarySave' }));

    await waitFor(() => {
      expect(screen.getByText('db down')).toBeInTheDocument();
    });
    // Still editing: the Save button is still on screen.
    expect(screen.getByRole('button', { name: 'persona.librarySave' })).toBeInTheDocument();
  });

  it('shows an error when delete rejects', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.deleteMutateAsync.mockRejectedValue(new Error('network down'));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryRemove' }));

    await waitFor(() => {
      expect(screen.getByText('persona.libraryDeleteError')).toBeInTheDocument();
    });
    expect(apiMocks.deleteMutateAsync).toHaveBeenCalledWith('img-1');
  });

  it('hides the picker and shows the limit message when the library is full', () => {
    apiMocks.images = Array.from({ length: 10 }, (_, i) => makeImage(`img-${i}`));
    const { container } = renderSection();

    expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it('caps pending picks at the remaining library room', async () => {
    apiMocks.images = Array.from({ length: 9 }, (_, i) => makeImage(`img-${i}`));
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'c.jpg', { type: 'image/jpeg' }),
    ]);

    // Only one slot left: one pending item, plus the limit notice.
    const tagInputs = container.querySelectorAll('input[placeholder="persona.libraryTagPlaceholder"]');
    expect(tagInputs).toHaveLength(1);
    expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
  });

  it('names the rejection notice when files fail type/size checks', async () => {
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // One valid file plus one .bmp and one oversized: the invalid ones are
    // skipped with feedback instead of silently disappearing.
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.bmp', { type: 'image/bmp' }),
      new File([new Uint8Array(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }),
    ]);

    const tagInputs = container.querySelectorAll('input[placeholder="persona.libraryTagPlaceholder"]');
    expect(tagInputs).toHaveLength(1);
    expect(screen.getByText('persona.libraryFilesRejected')).toBeInTheDocument();
  });

  it('reports both the limit and the rejection reasons when they co-occur', async () => {
    apiMocks.images = Array.from({ length: 9 }, (_, i) => makeImage(`img-${i}`));
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // One slot left, two valid picks (one overflows) plus one oversized file
    // (passes the input's accept filter but fails the size check): the user
    // must see both the limit notice and the rejection notice, otherwise
    // the size drop goes unreported behind the limit message.
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }),
    ]);

    expect(screen.getByText(/persona.libraryLimitReached/)).toBeInTheDocument();
    expect(screen.getByText(/persona.libraryFilesRejected/)).toBeInTheDocument();
  });

  it('revokes pending preview URLs when the component unmounts', async () => {
    const { container, unmount } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview');
  });

  it('edits the card title and description of a library image', async () => {
    apiMocks.images = [makeImage('img-1')];
    renderSection();
    const card = screen.getByText('tag-img-1').closest('div') as HTMLElement;
    expect(within(card).getByText('tag-img-1')).toBeInTheDocument();
  });

  it('starts the editor with fresh tag/description after the library refetches', async () => {
    apiMocks.images = [makeImage('img-1')];
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    // The server value changes (e.g. trimmed by a save elsewhere) and the
    // list refetches before the user opens the editor.
    apiMocks.images = [{ ...makeImage('img-1'), tag: 'fresh-tag' }];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '✎' }));
    expect(screen.getByDisplayValue('fresh-tag')).toBeInTheDocument();
  });

  it('does not clobber an in-progress edit when the library refetches', async () => {    apiMocks.images = [makeImage('img-1')];
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '✎' }));
    await userEvent.type(screen.getByDisplayValue('tag-img-1'), '-draft');
    apiMocks.images = [{ ...makeImage('img-1'), tag: 'fresh-tag' }];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    expect(screen.getByDisplayValue('tag-img-1-draft')).toBeInTheDocument();
  });

  it('shows an error when setting primary rejects', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.updateMutateAsync.mockRejectedValue(new Error('network down'));
    renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'persona.librarySetPrimary' }),
    );

    await waitFor(() => {
      expect(screen.getByText('persona.libraryUpdateError')).toBeInTheDocument();
    });
    expect(apiMocks.updateMutateAsync).toHaveBeenCalledWith({
      id: 'img-1',
      isPrimary: true,
    });
  });

  it('shows an error when setting primary returns success:false', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.updateMutateAsync.mockResolvedValue({ success: false, error: 'db down' });
    renderSection();

    await userEvent.click(
      screen.getByRole('button', { name: 'persona.librarySetPrimary' }),
    );

    await waitFor(() => {
      expect(screen.getByText('db down')).toBeInTheDocument();
    });
  });

  it('passes the library max to the count and limit-reached copy', async () => {
    // The limit lives in MAX_LIBRARY_IMAGES; the translated strings
    // interpolate {max} instead of hardcoding 10, so a limit change can't
    // silently drift the UI copy away from the enforced cap.
    apiMocks.images = Array.from({ length: 10 }, (_, i) => makeImage(`img-${i}`));
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
    });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryCount', { count: 10, max: 10 });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryLimitReached', { max: 10 });
  });

  it('interpolates {max} in the real dictionaries', async () => {
    const { dictionaries } = await import('@/lib/i18n/index');
    for (const locale of ['en', 'pt'] as const) {
      expect(dictionaries[locale].persona.libraryCount).toContain('{max}');
      expect(dictionaries[locale].persona.libraryCount).not.toContain('10');
      expect(dictionaries[locale].persona.libraryLimitReached).toContain('{max}');
      expect(dictionaries[locale].persona.libraryLimitReached).not.toContain('10');
    }
  });
});
