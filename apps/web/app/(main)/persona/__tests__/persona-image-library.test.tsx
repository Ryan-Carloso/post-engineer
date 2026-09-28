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

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return { I18nProvider, useI18n: () => ({ t, locale: 'en', setLocale: vi.fn() }) };
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
    const pendingRows = container.querySelectorAll('input[type="file"] ~ div');
    expect(apiMocks.uploadMutateAsync).toHaveBeenCalledTimes(2);
    expect(pendingRows.length).toBeGreaterThan(0);
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
});
