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
  image_url_error?: true;
}

const apiMocks = vi.hoisted(() => ({
  images: [] as MockImage[],
  imagesQueryError: false,
  uploadMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  usePersonaImagesQuery: vi.fn(() => ({
    data: apiMocks.images,
    isPending: false,
    isError: apiMocks.imagesQueryError,
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

function makeUnsignableImage(id: string): MockImage {
  return { ...makeImage(id), image_url: null, image_url_error: true as const };
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

  it('marks the primary image with a badge and shows the description of a described one', () => {
    apiMocks.images = [
      { ...makeImage('a'), is_primary: true, description: 'Front-facing portrait' },
      makeImage('b'),
    ];
    renderSection();

    const badges = screen.getAllByText('persona.libraryPrimary');
    expect(badges).toHaveLength(1);
    expect(badges[0].className).toContain('bg-ink');
    expect(badges[0].className).toContain('text-on-ink');
    expect(screen.getByText('Front-facing portrait')).toHaveClass('text-muted-text');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces an error when the upload rejects, keeping pending items', async () => {
    apiMocks.uploadMutateAsync.mockRejectedValue(new Error('network down'));
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(screen.getByText('persona.libraryUploadError (a.jpg)')).toBeInTheDocument();
    });
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
      expect(screen.getByText('persona.libraryUploadError (b.jpg)')).toBeInTheDocument();
    });
    expect(apiMocks.uploadMutateAsync).toHaveBeenCalledTimes(2);
    expect(
      screen.getAllByPlaceholderText('persona.libraryTagPlaceholder'),
    ).toHaveLength(1);
  });

  it('keeps the pending queue visible when a refetch fills the library', async () => {
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

    apiMocks.images = Array.from({ length: 10 }, (_, i) => makeImage(`img-${i}`));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
    });
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

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryEdit' }));
    await userEvent.click(screen.getByRole('button', { name: 'persona.librarySave' }));

    await waitFor(() => {
      expect(screen.getByText('persona.libraryUpdateError')).toBeInTheDocument();
    });
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

    const tagInputs = container.querySelectorAll('input[placeholder="persona.libraryTagPlaceholder"]');
    expect(tagInputs).toHaveLength(1);
    expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
  });

  it('names the rejection notice when files fail type/size checks', async () => {
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
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
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(11 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' }),
    ]);

    expect(screen.getByText(/persona.libraryLimitReached/)).toBeInTheDocument();
    expect(screen.getByText(/persona.libraryFilesRejected/)).toBeInTheDocument();
  });

  it('disables the Add button while an upload is in flight', async () => {
    let release!: (value: { success: boolean }) => void;
    apiMocks.uploadMutateAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    const addButton = screen.getByRole('button', { name: 'persona.libraryAdd' });
    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(addButton).toBeDisabled();
    });
    release({ success: true });
    await waitFor(() => {
      expect(addButton).not.toBeDisabled();
    });
  });

  it('disables pending remove buttons and inputs while an upload is in flight', async () => {
    let release!: (value: { success: boolean }) => void;
    apiMocks.uploadMutateAsync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'persona.libraryRemove' })).toBeDisabled();
    });
    expect(screen.getByLabelText('persona.libraryTag')).toBeDisabled();
    expect(screen.getByLabelText('persona.libraryDescription')).toBeDisabled();
    release({ success: true });
  });

  it('suppresses the empty-state hint when the images query errors', async () => {
    apiMocks.imagesQueryError = true;
    renderSection();
    expect(screen.queryByText('persona.libraryEmpty')).not.toBeInTheDocument();
    apiMocks.imagesQueryError = false;
  });

  it('passes the library max to the empty-state copy', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('persona.libraryEmpty')).toBeInTheDocument();
    });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryEmpty', { max: 10 });
  });

  it('keeps uploaded previews alive until the queue updates', async () => {
    let releaseSecond!: (value: { success: boolean }) => void;
    apiMocks.uploadMutateAsync
      .mockResolvedValueOnce({ success: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSecond = resolve;
          }),
      );
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(apiMocks.uploadMutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    releaseSecond({ success: true });
    await waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    });
  });

  it('surfaces server warnings when the upload succeeds with warnings', async () => {
    apiMocks.uploadMutateAsync.mockResolvedValue({
      success: true,
      warnings: ['primary_swap_failed'],
    });
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await pickFiles(input, [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryUpload' }));

    await waitFor(() => {
      expect(
        screen.getByText('persona.libraryWarningPrimarySwap'),
      ).toBeInTheDocument();
    });
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
    apiMocks.images = [{ ...makeImage('img-1'), tag: 'fresh-tag' }];
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryEdit' }));
    expect(screen.getByDisplayValue('fresh-tag')).toBeInTheDocument();
  });

  it('does not clobber an in-progress edit when the library refetches', async () => {    apiMocks.images = [makeImage('img-1')];
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PersonaImageLibrarySection personaId="persona-1" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryEdit' }));
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
      expect(screen.getByText('persona.libraryUpdateError')).toBeInTheDocument();
    });
  });

  it('passes the library max to the count and limit-reached copy', async () => {
    apiMocks.images = Array.from({ length: 10 }, (_, i) => makeImage(`img-${i}`));
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('persona.libraryLimitReached')).toBeInTheDocument();
    });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryCount', { count: 10, max: 10 });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryLimitReached', { max: 10 });
    expect(i18nMocks.t).toHaveBeenCalledWith('persona.libraryHint', { max: 10, sizeMb: 10 });
  });

  it('interpolates {max} in the real dictionaries', async () => {
    const { dictionaries } = await import('@/lib/i18n/index');
    for (const locale of ['en', 'pt'] as const) {
      expect(dictionaries[locale].persona.libraryCount).toContain('{max}');
      expect(dictionaries[locale].persona.libraryCount).not.toContain('10');
      expect(dictionaries[locale].persona.libraryLimitReached).toContain('{max}');
      expect(dictionaries[locale].persona.libraryLimitReached).not.toContain('10');
      expect(dictionaries[locale].persona.libraryHint).toContain('{max}');
      expect(dictionaries[locale].persona.libraryHint).toContain('{sizeMb}');
      expect(dictionaries[locale].persona.libraryHint).not.toContain('10');
      expect(dictionaries[locale].persona.libraryFilesRejected).toContain('{sizeMb}');
      expect(dictionaries[locale].persona.libraryFilesRejected).not.toContain('10MB');
      expect(dictionaries[locale].persona.libraryEmpty).toContain('{max}');
      expect(dictionaries[locale].persona.libraryEmpty).not.toContain('10');
    }
  });

  it('mapPersonaImageWarnings maps codes through i18n and falls back to a localized message for unknown codes', async () => {
    const { mapPersonaImageWarnings } = await import('../persona-image-library');
    const t = (key: string) => `t:${key}`;
    expect(
      mapPersonaImageWarnings(['primary_swap_failed', 'metadata_save_failed'], t),
    ).toBe('t:persona.libraryWarningPrimarySwap t:persona.libraryWarningMetadataSave');
    expect(mapPersonaImageWarnings(['some_future_code'], t)).toBe(
      't:persona.libraryWarningUnknown',
    );
  });

  it('mapPersonaImageError maps known server failure classes to localized copy, never raw English', async () => {
    const { mapPersonaImageError } = await import('../persona-image-library');
    const t = (key: string) => `t:${key}`;
    expect(mapPersonaImageError('Image library is full (10 images max).', t, 'persona.libraryUploadError')).toBe(
      't:persona.libraryErrorFull',
    );
    expect(
      mapPersonaImageError('Voiceover persona must not include library images.', t, 'persona.libraryUploadError'),
    ).toBe('t:persona.libraryErrorVoiceover');
    expect(
      mapPersonaImageError('tag must be at most 100 characters.', t, 'persona.libraryUpdateError'),
    ).toBe('t:persona.libraryErrorTooLong');
    expect(mapPersonaImageError('Image not found.', t, 'persona.libraryDeleteError')).toBe(
      't:persona.libraryErrorNotFound',
    );
    expect(
      mapPersonaImageError('Something broke in English.', t, 'persona.libraryUploadError'),
    ).toBe('t:persona.libraryUploadError');
    expect(mapPersonaImageError(undefined, t, 'persona.libraryUpdateError')).toBe(
      't:persona.libraryUpdateError',
    );
  });

  it('renders the retry copy (not a bare gray box) when signing failed', async () => {
    apiMocks.images = [makeUnsignableImage('img-1')];
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('persona.libraryImageUrlError')).toBeInTheDocument();
    });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the editor open with the typed values when the metadata save fails with a warning', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.updateMutateAsync.mockResolvedValue({
      success: true,
      warnings: ['metadata_save_failed'],
    });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryEdit' }));
    const tagInput = screen.getByPlaceholderText('persona.libraryTagPlaceholder');
    await userEvent.clear(tagInput);
    await userEvent.type(tagInput, 'retry-tag');
    await userEvent.click(screen.getByRole('button', { name: 'persona.librarySave' }));

    await waitFor(() => {
      expect(screen.getByText('persona.libraryWarningMetadataSave')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'persona.librarySave' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('retry-tag')).toBeInTheDocument();
  });

  it('closes the editor on success without warnings', async () => {
    apiMocks.images = [makeImage('img-1')];
    apiMocks.updateMutateAsync.mockResolvedValue({ success: true });
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'persona.libraryEdit' }));
    await userEvent.click(screen.getByRole('button', { name: 'persona.librarySave' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'persona.librarySave' }),
      ).not.toBeInTheDocument();
    });
  });
});
