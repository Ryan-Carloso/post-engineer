import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// DeletePersonaModal behavioral tests.
// Network (lib/api) is mocked; the component owns loading, preview,
// type-to-confirm, delete, and error states.
//---------------

vi.mock('@/lib/api', () => ({
  fetchDeletePreview: vi.fn(),
  deletePersona: vi.fn(),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'en', setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { DeletePersonaModal } from '../delete-persona-modal';
import { fetchDeletePreview, deletePersona } from '@/lib/api';

const PERSONA = { id: 'persona-1', name: 'Ryan' };

const PREVIEW = {
  success: true,
  persona: { id: 'persona-1', name: 'Ryan' },
  counts: { schedules: 2, upcomingSlots: 3, publishedSlots: 0, failedSlots: 0, generatedVideos: 2, personaImages: 1 },
  videos: [
    { taskId: 'task-aaa', topic: 'Topic one', status: 'completed', downloadUrl: '/dl/task-aaa/f.mp4' },
    { taskId: 'task-bbb', topic: 'Topic two', status: 'failed', downloadUrl: null },
  ],
};

function renderModal(props: Partial<Parameters<typeof DeletePersonaModal>[0]> = {}) {
  return render(
    <DeletePersonaModal
      persona={PERSONA}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDeletePreview).mockResolvedValue(PREVIEW);
  vi.mocked(deletePersona).mockResolvedValue({ success: true });
});

describe('DeletePersonaModal', () => {
  it('renders nothing when closed', () => {
    renderModal({ persona: null });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchDeletePreview).not.toHaveBeenCalled();
  });

  it('shows counts and the no-refund warning from the preview', async () => {
    renderModal();
    await waitFor(() => expect(fetchDeletePreview).toHaveBeenCalledWith('persona-1'));
    expect(await screen.findByText('personas.deleteDialogNoRefund')).toBeInTheDocument();
    // Counts render as <strong> values next to the (mocked) i18n keys.
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('lists videos with download links, unavailable when no URL', async () => {
    renderModal();
    const link = await screen.findByRole('link', { name: 'personas.deleteDialogDownload' });
    expect(link).toHaveAttribute('href', '/dl/task-aaa/f.mp4');
    expect(
      await screen.findByText('personas.deleteDialogDownloadUnavailable'),
    ).toBeInTheDocument();
  });

  it('keeps Delete disabled until the typed name matches exactly', async () => {
    renderModal();
    await screen.findByText('personas.deleteDialogNoRefund');
    const confirm = screen.getByRole('button', { name: 'personas.deleteConfirm' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'rya' },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    expect(confirm).toBeEnabled();
  });

  it('deletes on confirm and notifies the parent', async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    renderModal({ onClose, onDeleted });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));

    await waitFor(() => expect(deletePersona).toHaveBeenCalledWith('persona-1'));
    expect(onDeleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error when the delete fails and stays open', async () => {
    const onClose = vi.fn();
    vi.mocked(deletePersona).mockResolvedValue({ success: false, error: 'boom' });
    renderModal({ onClose });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));

    expect(await screen.findByText('personas.deleteDialogDeleteError')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error with retry when the preview fails to load', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({ success: false, error: 'db down' });
    renderModal();
    expect(await screen.findByText('personas.deleteDialogLoadError')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'personas.tryAgain' }));
    await waitFor(() => expect(fetchDeletePreview).toHaveBeenCalledTimes(2));
  });

  it('shows the load error (not a stuck spinner) when the preview rejects', async () => {
    vi.mocked(fetchDeletePreview).mockRejectedValue(new Error('network down'));
    renderModal();
    expect(await screen.findByText('personas.deleteDialogLoadError')).toBeInTheDocument();
    // Retry is offered — the dialog is not wedged in 'loading'.
    expect(screen.getByRole('button', { name: 'personas.tryAgain' })).toBeEnabled();
  });

  it('shows the delete error (dialog stays usable) when the delete rejects', async () => {
    vi.mocked(deletePersona).mockRejectedValue(new Error('timeout'));
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));

    expect(await screen.findByText('personas.deleteDialogDeleteError')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Cancel is re-enabled — the user is not trapped in 'deleting'.
    expect(screen.getByRole('button', { name: 'personas.cancel' })).toBeEnabled();
  });

  it('hints when the typed name does not match', async () => {
    renderModal();
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Rya' },
    });
    expect(screen.getByText('personas.deleteDialogNameMismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'personas.deleteConfirm' })).toBeDisabled();
  });

  it('uses singular labels for a count of 1', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({
      ...PREVIEW,
      counts: { schedules: 1, upcomingSlots: 1, publishedSlots: 0, failedSlots: 0, generatedVideos: 1, personaImages: 1 },
    });
    renderModal();
    await screen.findByText('personas.deleteDialogNoRefund');
    expect(screen.getByText('personas.deleteDialogSchedule')).toBeInTheDocument();
    expect(screen.getByText('personas.deleteDialogSlot')).toBeInTheDocument();
    expect(screen.getByText('personas.deleteDialogVideo')).toBeInTheDocument();
    expect(screen.getByText('personas.deleteDialogImage')).toBeInTheDocument();
    expect(screen.queryByText('personas.deleteDialogSchedules')).not.toBeInTheDocument();
  });

  it('notes when the video list was truncated', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({
      ...PREVIEW,
      counts: { schedules: 0, upcomingSlots: 0, publishedSlots: 0, failedSlots: 0, generatedVideos: 25, personaImages: 0 },
      videosTruncated: true,
    });
    // The t mock returns the key; assert the key renders with interpolation params.
    const { container } = renderModal();
    await screen.findByText('personas.deleteDialogVideosTruncated');
    expect(container.textContent).toContain('personas.deleteDialogVideosTruncated');
  });

  it('warns with retry when download links are incomplete', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({
      ...PREVIEW,
      linksIncomplete: true,
    });
    renderModal();
    await screen.findByText('personas.deleteDialogLinksIncomplete');
    fireEvent.click(screen.getByRole('button', { name: 'personas.tryAgain' }));
    await waitFor(() => expect(fetchDeletePreview).toHaveBeenCalledTimes(2));
  });

  it('disables the links-incomplete retry while a delete is in flight', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({ ...PREVIEW, linksIncomplete: true });
    // Delete hangs so the dialog stays in 'deleting'.
    vi.mocked(deletePersona).mockImplementation(() => new Promise(() => {}));
    renderModal();
    await screen.findByText('personas.deleteDialogLinksIncomplete');
    // Arm the confirm gate and start the delete.
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));
    await waitFor(() => expect(deletePersona).toHaveBeenCalled());
    // The retry must not fire a preview refresh mid-delete.
    const retry = screen.getByRole('button', { name: 'personas.tryAgain' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(fetchDeletePreview).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed name when retrying incomplete links', async () => {
    vi.mocked(fetchDeletePreview)
      .mockResolvedValueOnce({ ...PREVIEW, linksIncomplete: true })
      .mockResolvedValueOnce(PREVIEW);
    renderModal();
    await screen.findByText('personas.deleteDialogLinksIncomplete');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.tryAgain' }));
    await waitFor(() => expect(fetchDeletePreview).toHaveBeenCalledTimes(2));
    // The confirmation name survives the link refresh.
    expect(screen.getByLabelText('personas.deleteDialogTypeName')).toHaveValue('Ryan');
    expect(screen.getByRole('button', { name: 'personas.deleteConfirm' })).toBeEnabled();
  });

  it('resets the typed name when the modal is closed and reopened', async () => {
    const { rerender } = renderModal();
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    expect(screen.getByRole('button', { name: 'personas.deleteConfirm' })).toBeEnabled();

    // Close (persona -> null) and reopen the same persona.
    rerender(
      <DeletePersonaModal persona={null} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    rerender(
      <DeletePersonaModal persona={PERSONA} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );

    await screen.findByText('personas.deleteDialogNoRefund');
    // The gate is re-armed: the name field is empty and Delete is disabled.
    expect(screen.getByLabelText('personas.deleteDialogTypeName')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'personas.deleteConfirm' })).toBeDisabled();
  });

  it('focuses the name input when the preview is ready', async () => {
    renderModal();
    const input = await screen.findByLabelText('personas.deleteDialogTypeName');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('closes on Escape unless a delete is in flight', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while a delete is in flight', async () => {
    const onClose = vi.fn();
    vi.mocked(deletePersona).mockImplementation(() => new Promise(() => {}));
    renderModal({ onClose });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));
    await waitFor(() => expect(deletePersona).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes and refetches when the preview reports PERSONA_NOT_FOUND', async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    vi.mocked(fetchDeletePreview).mockResolvedValue({
      success: false,
      code: 'PERSONA_NOT_FOUND',
    });
    renderModal({ onClose, onDeleted });
    // No retry loop for a permanent failure: close and refetch.
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes and refetches when the delete reports PERSONA_NOT_FOUND', async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    vi.mocked(deletePersona).mockResolvedValue({
      success: false,
      error: 'Persona not found.',
      code: 'PERSONA_NOT_FOUND',
    });
    renderModal({ onClose, onDeleted });
    await screen.findByText('personas.deleteDialogNoRefund');
    fireEvent.change(screen.getByLabelText('personas.deleteDialogTypeName'), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'personas.deleteConfirm' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders published and failed slot history counts', async () => {
    vi.mocked(fetchDeletePreview).mockResolvedValue({
      ...PREVIEW,
      counts: { ...PREVIEW.counts, publishedSlots: 1, failedSlots: 2 },
    });
    renderModal();
    await screen.findByText('personas.deleteDialogPublishedSlot');
    expect(screen.getByText('personas.deleteDialogFailedSlots')).toBeInTheDocument();
  });
});
