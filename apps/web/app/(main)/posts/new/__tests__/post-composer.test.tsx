import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} {...rest} />
  ),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string): string => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt' as const, setLocale: vi.fn() }),
    I18nProvider,
  };
});

vi.mock('@/lib/api', () => ({
  usePersonaListQuery: vi.fn(),
  useSocialAccountsQuery: vi.fn(),
}));

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountCardDisplay: vi.fn(),
}));

vi.mock('../boards', () => ({
  usePinterestBoardsQuery: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
}));

vi.mock('@/lib/post-composer/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/post-composer/request')>();
  return {
    ...actual,
    uploadMediaFile: vi.fn(),
    publishExisting: vi.fn(),
  };
});

import { PostComposer } from '../post-composer';
import NewPostPage from '../page';
import { usePersonaListQuery, useSocialAccountsQuery } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n/provider';
import { ComposerRequestError, publishExisting, uploadMediaFile } from '@/lib/post-composer/request';
import { usePinterestBoardsQuery } from '../boards';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';

const YOUTUBE_ACCOUNT = {
  provider: 'youtube' as const,
  recordId: 'record-1',
  channelId: 'ch-1',
  channelName: 'E2E Channel',
  email: 'e2e@example.com',
  connectedAt: 1,
  lastUsed: 1,
  status: 'ok' as const,
};

const PINTEREST_ACCOUNT = {
  provider: 'pinterest' as const,
  recordId: 'record-2',
  providerAccountId: 'pin-1',
  accountName: 'Pin Board',
  connectedAt: 1,
  lastUsed: 1,
  status: 'ok' as const,
};

const INSTAGRAM_ACCOUNT = {
  provider: 'instagram' as const,
  recordId: 'record-3',
  igUserId: 'ig-1',
  username: 'e2e.insta',
  name: 'E2E Insta',
  connectedAt: 1,
  lastUsed: 1,
  status: 'ok' as const,
};

function wrapper(client?: QueryClient) {
  const queryClient =
    client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  Wrapper.displayName = 'ComposerWrapper';
  return Wrapper;
}

function chooseVideo(): void {
  const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
}

function fillText(): void {
  fireEvent.change(screen.getByLabelText('composer.titleLabel'), {
    target: { value: 'A day in Lisbon' },
  });
  fireEvent.change(screen.getByLabelText('composer.descriptionLabel'), {
    target: { value: 'A short vlog.' },
  });
}

function fillTags(): void {
  fireEvent.change(screen.getByLabelText('composer.tagsLabel'), {
    target: { value: 'vlog, lisbon' },
  });
}

function pickAccount(): void {
  fireEvent.click(screen.getByTestId('account-card-select'));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(useSocialAccountsQuery).mockReturnValue({
    data: { authenticated: true, accounts: [YOUTUBE_ACCOUNT] },
    isLoading: false,
    isError: false,
  } as never);
  vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(usePinterestBoardsQuery).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  } as never);
  vi.mocked(uploadMediaFile).mockResolvedValue({ kind: 'upload', uploadId: 'upload-1' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PostComposer', () => {
  it('renders the media, account, text and schedule sections', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    expect(screen.getByTestId('composer-form')).toBeInTheDocument();
    expect(screen.getByTestId('composer-media')).toBeInTheDocument();
    expect(screen.getByText('E2E Channel')).toBeInTheDocument();
    expect(screen.getByLabelText('composer.scheduleAtLabel')).toBeInTheDocument();
    expect(screen.getByTestId('composer-submit')).toHaveTextContent('composer.submitScheduled');
  });

  it('blocks the submit without a file', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(screen.getByText('composer.validationMedia')).toBeInTheDocument();
    expect(uploadMediaFile).not.toHaveBeenCalled();
  });

  it('uploads the video and publishes it now to the selected account', async () => {
    vi.mocked(publishExisting).mockResolvedValue({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: true,
          results: [{ accountId: 'ch-1', success: true, videoUrl: 'https://youtu.be/x' }],
        },
      ],
    });
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    fireEvent.click(screen.getByRole('radio', { name: 'composer.modeAsap' }));
    pickAccount();
    fillText();
    fillTags();
    fireEvent.click(screen.getByTestId('composer-submit'));

    await waitFor(() => expect(publishExisting).toHaveBeenCalledTimes(1));
    expect(uploadMediaFile).toHaveBeenCalledWith(
      expect.any(File),
      'video/mp4',
      expect.any(Function),
    );
    const [plan, media, key] = vi.mocked(publishExisting).mock.calls[0];
    expect(media).toEqual({ kind: 'upload', uploadId: 'upload-1' });
    expect(typeof key).toBe('string');
    expect(plan.mode).toBe('asap');
    expect(plan.providers).toEqual(['youtube']);
    expect(plan.accounts).toEqual({ youtube: ['ch-1'] });
    expect(plan.title).toBe('A day in Lisbon');
    expect(plan.tags).toEqual(['vlog', 'lisbon']);
    expect(await screen.findByText('composer.successAsapTitle')).toBeInTheDocument();
  });

  it('schedules the post and links to the created slot', async () => {
    vi.mocked(publishExisting).mockResolvedValue({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'A day in Lisbon', status: 'ready' }],
    });
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));

    await waitFor(() => expect(publishExisting).toHaveBeenCalledTimes(1));
    const [plan] = vi.mocked(publishExisting).mock.calls[0];
    expect(plan.mode).toBe('scheduled');
    expect(plan.schedule).not.toBeNull();
    expect(plan.caption).toBeNull();
    expect(plan.tags).toBeUndefined();
    expect(plan.privacyStatus).toBeUndefined();
    expect(await screen.findByText('composer.successScheduledTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-1',
    );
  });

  it('invalidates the schedules query after a successful schedule', async () => {
    vi.mocked(publishExisting).mockResolvedValue({
      mode: 'scheduled',
      replayed: false,
      scheduleId: 'schedule-1',
      slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'A day in Lisbon', status: 'ready' }],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<PostComposer />, { wrapper: wrapper(client) });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));

    await waitFor(() => expect(screen.getByText('composer.successScheduledTitle')).toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedules'] });
  });

  it('preselects the accounts bound to the chosen persona', () => {
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['ch-1'];
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false, boundAccounts: bound }],
      isLoading: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(screen.getByTestId('account-card-select')).toBeChecked();
  });

  it('drops the video-only accounts when the media becomes an image', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    pickAccount();
    expect(screen.getByTestId('account-card-select')).toBeChecked();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.queryByText('E2E Channel')).not.toBeInTheDocument();
    expect(screen.getByText('composer.accountsImageEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText(/composer\.accountsImageHint/)).toBeInTheDocument();
    expect(screen.queryByText('composer.accountsEmptyTitle')).not.toBeInTheDocument();
  });

  it('keeps the hidden file input out of the tab order so only the localized button is focusable', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const input = screen.getByTestId('composer-file-input');
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(input).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: /composer\.mediaChoose/ })).toBeInTheDocument();
  });

  it('rejects a file type the server cannot publish', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const file = new File(['bytes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('composer.mediaUnsupported')).toBeInTheDocument();
  });

  it('renders the new-post page', () => {
    render(<NewPostPage />, { wrapper: wrapper() });
    expect(screen.getByTestId('composer-form')).toBeInTheDocument();
    expect(screen.getByText('composer.title')).toBeInTheDocument();
  });

  it('shows the accounts empty state when no accounts are connected', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [] },
      isLoading: false,
      isError: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    expect(screen.getByText('composer.accountsEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.accountsEmptyHint')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('rejects a file over the size limit', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('composer.mediaTooLarge')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-image-preview')).not.toBeInTheDocument();
  });

  it('accepts a file exactly at the size limit', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.queryByText('composer.mediaTooLarge')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-image-preview')).toBeInTheDocument();
  });

  it('shows the loading states while the lists are fetching', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({ isLoading: true } as never);
    vi.mocked(useSocialAccountsQuery).mockReturnValue({ isLoading: true } as never);
    vi.mocked(usePinterestBoardsQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    expect(screen.getByLabelText('composer.personaLabel')).toBeDisabled();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByTestId('composer-form')).toBeInTheDocument();
  });

  it('removes the chosen file and resets the draft', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    expect(screen.getByTestId('composer-video-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /composer\.mediaRemove/ }));
    expect(screen.queryByTestId('composer-video-preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /composer\.mediaChoose/ })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(screen.getByText('composer.validationMedia')).toBeInTheDocument();
  });

  it('toggles an account off when it is clicked again', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const select = screen.getByTestId('account-card-select');
    fireEvent.click(select);
    expect(select).toBeChecked();
    fireEvent.click(select);
    expect(select).not.toBeChecked();
  });

  it('keeps only one pinterest account selected at a time', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [YOUTUBE_ACCOUNT, PINTEREST_ACCOUNT] },
      isLoading: false,
      isError: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    const selects = screen.getAllByTestId('account-card-select');
    expect(selects).toHaveLength(2);
    fireEvent.click(selects[1]);
    expect(selects[1]).toBeChecked();
    fireEvent.click(selects[1]);
    expect(selects[1]).not.toBeChecked();
    fireEvent.click(selects[1]);
    expect(selects[1]).toBeChecked();
    expect(screen.getByLabelText('composer.boardLabel')).toBeInTheDocument();
  });

  it('shows the accounts validation issue when submitting without an account', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    fireEvent.change(screen.getByLabelText('composer.titleLabel'), {
      target: { value: 'A day in Lisbon' },
    });
    fireEvent.change(screen.getByLabelText('composer.descriptionLabel'), {
      target: { value: 'A short vlog.' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(screen.getByText('composer.validationAccounts')).toBeInTheDocument();
    expect(uploadMediaFile).not.toHaveBeenCalled();
  });

  it('shows the upload failure alert when the upload fails', async () => {
    vi.mocked(uploadMediaFile).mockRejectedValue(new Error('mint failed'));
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeInTheDocument());
    expect(screen.getByText('composer.errorTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.errorUpload')).toBeInTheDocument();
    expect(publishExisting).not.toHaveBeenCalled();
  });

  it('shows the publish failure alert when publishing fails', async () => {
    vi.mocked(publishExisting).mockRejectedValue(
      new ComposerRequestError('publish', 500, 'boom', null, null),
    );
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeInTheDocument());
    expect(screen.getByText('composer.errorPublish')).toBeInTheDocument();
  });

  it('retries the upload after an expired upload id', async () => {
    vi.mocked(publishExisting)
      .mockRejectedValueOnce(
        new ComposerRequestError('publish', 410, 'expired', null, 'VIDEO_UPLOAD_EXPIRED'),
      )
      .mockResolvedValueOnce({
        mode: 'scheduled',
        replayed: false,
        scheduleId: 'schedule-1',
        slots: [{ id: 'slot-1', slotAt: '2026-12-02T20:00:00Z', title: 'A day in Lisbon', status: 'ready' }],
      });
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeInTheDocument());
    expect(screen.getByText('composer.errorUpload')).toBeInTheDocument();
    expect(uploadMediaFile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(publishExisting).toHaveBeenCalledTimes(2));
    expect(uploadMediaFile).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('composer.successScheduledTitle')).toBeInTheDocument();
  });

  it('surfaces the server schedule error as a validation issue', async () => {
    vi.mocked(publishExisting).mockRejectedValue(
      new ComposerRequestError('publish', 400, 'too soon', 'publishing.schedule.publishAt', 'SCHEDULE_OUT_OF_RANGE'),
    );
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByText('composer.validationSchedule')).toBeInTheDocument());
    expect(screen.getByTestId('composer-error')).toBeInTheDocument();
  });

  it('surfaces the server timezone error as a validation issue', async () => {
    vi.mocked(publishExisting).mockRejectedValue(
      new ComposerRequestError('publish', 400, 'bad zone', 'publishing.schedule.timezone', null),
    );
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    pickAccount();
    fillText();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByText('composer.validationTimezone')).toBeInTheDocument());
  });

  it('resets the composer after a successful publish', async () => {
    vi.mocked(publishExisting).mockResolvedValue({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [
        {
          provider: 'youtube',
          success: true,
          results: [{ accountId: 'ch-1', success: true, videoUrl: 'https://youtu.be/x' }],
        },
      ],
    });
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    fireEvent.click(screen.getByRole('radio', { name: 'composer.modeAsap' }));
    pickAccount();
    fillText();
    fillTags();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByText('composer.successAsapTitle')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'composer.successAgain' }));
    expect(screen.getByTestId('composer-form')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-video-preview')).not.toBeInTheDocument();
    expect(screen.getByLabelText('composer.titleLabel')).toHaveValue('');
    expect(screen.getByTestId('composer-submit')).toHaveTextContent('composer.submitScheduled');
  });

  it('keeps the image accounts when the media becomes an image', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [YOUTUBE_ACCOUNT, INSTAGRAM_ACCOUNT] },
      isLoading: false,
      isError: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    const selects = screen.getAllByTestId('account-card-select');
    fireEvent.click(selects[0]);
    fireEvent.click(selects[1]);
    expect(selects[0]).toBeChecked();
    expect(selects[1]).toBeChecked();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.queryByText('E2E Channel')).not.toBeInTheDocument();
    expect(screen.getByText('@e2e.insta')).toBeInTheDocument();
    expect(screen.getByTestId('account-card-select')).toBeChecked();
  });

  it('shows the uploading label and ignores a second submit while busy', async () => {
    let resolveUpload!: (value: { kind: 'upload'; uploadId: string }) => void;
    vi.mocked(uploadMediaFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    vi.mocked(publishExisting).mockResolvedValue({
      mode: 'asap',
      success: true,
      replayed: false,
      publishes: [],
    });
    render(<PostComposer />, { wrapper: wrapper() });
    chooseVideo();
    fireEvent.click(screen.getByRole('radio', { name: 'composer.modeAsap' }));
    pickAccount();
    fillText();
    fillTags();
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('composer-submit')).toHaveTextContent('composer.uploading'),
    );
    fireEvent.submit(screen.getByTestId('composer-form'));
    expect(uploadMediaFile).toHaveBeenCalledTimes(1);
    const onProgress = vi.mocked(uploadMediaFile).mock.calls[0][2];
    onProgress(42);
    expect(screen.getByTestId('composer-submit')).toHaveTextContent('composer.uploading');
    resolveUpload({ kind: 'upload', uploadId: 'upload-1' });
    await waitFor(() => expect(publishExisting).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('composer.successAsapTitle')).toBeInTheDocument();
  });

  it('shows the persona empty state for a persona without bound accounts', () => {
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false }],
      isLoading: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(screen.getByText('composer.accountsBoundEmptyTitle')).toBeInTheDocument();
    expect(screen.getByText('composer.personaNoBound')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'composer.accountsEmptyAction' })).not.toBeInTheDocument();
  });

  it('shows the connect action when the persona has no bound accounts and nothing is connected', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [] },
      isLoading: false,
      isError: false,
    } as never);
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false }],
      isLoading: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(screen.getByText('composer.accountsEmptyTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('names the image reason when the persona is bound only to video accounts', () => {
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['ch-1'];
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false, boundAccounts: bound }],
      isLoading: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(screen.getByTestId('account-card-select')).toBeChecked();
    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(screen.getByText('composer.accountsImageEmptyTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
    expect(screen.queryByText('composer.accountsBoundEmptyTitle')).not.toBeInTheDocument();
  });

  it('names the disconnected reason when the persona is bound to accounts that are not connected', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [INSTAGRAM_ACCOUNT] },
      isLoading: false,
      isError: false,
    } as never);
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['ch-1'];
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false, boundAccounts: bound }],
      isLoading: false,
    } as never);
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    chooseVideo();
    expect(screen.getByText('composer.accountsDisconnectedEmptyTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.accountsEmptyAction' })).toHaveAttribute(
      'href',
      '/accounts',
    );
    expect(screen.queryByText('composer.accountsBoundEmptyTitle')).not.toBeInTheDocument();
  });

  it('shows the persona empty state when the chosen persona disappears from the list', () => {
    const bound = emptyPersonaDefaultAccounts();
    bound.youtube = ['ch-1'];
    vi.mocked(usePersonaListQuery).mockReturnValue({
      data: [{ id: 'persona-1', name: 'Ana', createdAt: '2026-01-01T00:00:00Z', aiLabel: false, boundAccounts: bound }],
      isLoading: false,
    } as never);
    const wrap = wrapper();
    const { rerender } = render(<PostComposer />, { wrapper: wrap });
    fireEvent.change(screen.getByLabelText('composer.personaLabel'), {
      target: { value: 'persona-1' },
    });
    expect(screen.getByTestId('account-card-select')).toBeChecked();
    vi.mocked(usePersonaListQuery).mockReturnValue({ data: [], isLoading: false } as never);
    rerender(<PostComposer />);
    expect(screen.getByText('composer.accountsBoundEmptyTitle')).toBeInTheDocument();
  });

  it('clears a stale pinterest board when the boards list no longer has it', () => {
    vi.mocked(useSocialAccountsQuery).mockReturnValue({
      data: { authenticated: true, accounts: [YOUTUBE_ACCOUNT, PINTEREST_ACCOUNT] },
      isLoading: false,
      isError: false,
    } as never);
    vi.mocked(usePinterestBoardsQuery).mockReturnValue({
      data: [{ id: 'board-1', name: 'Board One' }],
      isLoading: false,
      isError: false,
    } as never);
    const wrap = wrapper();
    const { rerender } = render(<PostComposer />, { wrapper: wrap });
    const selects = screen.getAllByTestId('account-card-select');
    fireEvent.click(selects[1]);
    fireEvent.change(screen.getByLabelText('composer.boardLabel'), { target: { value: 'board-1' } });
    expect(screen.getByLabelText('composer.boardLabel')).toHaveValue('board-1');
    vi.mocked(usePinterestBoardsQuery).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);
    rerender(<PostComposer />);
    expect(screen.getByLabelText('composer.boardLabel')).toHaveValue('');
  });

  it('updates the publish time when the timezone changes', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    const publishAt = screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement;
    const before = publishAt.value;
    fireEvent.change(screen.getByLabelText('composer.scheduleTimezoneLabel'), {
      target: { value: 'America/Sao_Paulo' },
    });
    expect(screen.getByLabelText('composer.scheduleTimezoneLabel')).toHaveValue('America/Sao_Paulo');
    expect((screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement).value).not.toBe(before);
  });

  it('updates the publish time when the datetime changes', () => {
    render(<PostComposer />, { wrapper: wrapper() });
    fireEvent.change(screen.getByLabelText('composer.scheduleAtLabel'), {
      target: { value: '2026-12-05T18:30' },
    });
    expect((screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement).value).toBe(
      '2026-12-05T18:30',
    );
    fireEvent.change(screen.getByLabelText('composer.scheduleTimezoneLabel'), {
      target: { value: 'UTC' },
    });
    expect(screen.getByLabelText('composer.scheduleTimezoneLabel')).toHaveValue('UTC');
    expect((screen.getByLabelText('composer.scheduleAtLabel') as HTMLInputElement).value).toBe(
      '2026-12-05T18:30',
    );
  });
});
