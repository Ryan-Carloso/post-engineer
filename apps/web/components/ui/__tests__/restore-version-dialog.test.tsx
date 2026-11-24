import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RestoreVersionDialog from '@/components/ui/restore-version-dialog';

const base = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  title: 'Restore version 2?',
  body: 'Creates version 4 with this text.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Restore this version',
};

afterEach(() => {
  cleanup();
  base.onClose.mockReset();
  base.onConfirm.mockReset();
});

describe('RestoreVersionDialog', () => {
  it('shows the title and the body', () => {
    render(<RestoreVersionDialog {...base} />);
    expect(screen.getByText('Restore version 2?')).toBeInTheDocument();
    expect(screen.getByText('Creates version 4 with this text.')).toBeInTheDocument();
  });

  it('opens with focus on the cancel button, never on the confirm button', () => {
    render(<RestoreVersionDialog {...base} />);
    expect(screen.getByTestId('restore-cancel-button')).toHaveFocus();
    expect(screen.getByTestId('restore-confirm-button')).not.toHaveFocus();
  });

  it('closes on Escape', () => {
    render(<RestoreVersionDialog {...base} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(base.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus inside the dialog when tabbing past the last control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <RestoreVersionDialog {...base} />
      </>,
    );
    await user.tab();
    expect(screen.getByTestId('restore-confirm-button')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('restore-cancel-button')).toHaveFocus();
    expect(screen.getByText('outside')).not.toHaveFocus();
  });

  it('calls onClose from the cancel button and onConfirm from the confirm button', () => {
    render(<RestoreVersionDialog {...base} />);
    fireEvent.click(screen.getByTestId('restore-cancel-button'));
    expect(base.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('restore-confirm-button'));
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows a spinner while pending, and ignores Escape', () => {
    render(<RestoreVersionDialog {...base} pending />);
    expect(screen.getByTestId('restore-confirm-button')).toBeDisabled();
    expect(screen.getByTestId('restore-cancel-button')).toBeDisabled();
    expect(screen.getByTestId('restore-confirm-button').querySelector('svg')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(base.onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<RestoreVersionDialog {...base} open={false} />);
    expect(screen.queryByTestId('restore-dialog')).not.toBeInTheDocument();
  });
});
