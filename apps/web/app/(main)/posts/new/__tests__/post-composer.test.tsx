import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
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
  usePinterestBoardsQuery: () => ({ data: [], isLoading: false, isError: false }),
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
import { usePersonaListQuery, useSocialAccountsQuery } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n/provider';
import { publishExisting, uploadMediaFile } from '@/lib/post-composer/request';
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

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
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
    expect(await screen.findByText('composer.successScheduledTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'composer.successViewPost' })).toHaveAttribute(
      'href',
      '/posts/slot-1',
    );
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
});
