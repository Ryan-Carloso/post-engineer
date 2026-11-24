import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '@/components/ui/confirm-dialog';

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

describe('ConfirmDialog', () => {
  it('shows the title and the body', () => {
    render(<ConfirmDialog {...base} />);
    expect(screen.getByText('Restore version 2?')).toBeInTheDocument();
    expect(screen.getByText('Creates version 4 with this text.')).toBeInTheDocument();
  });

  it('renders no detail row without a detail and the detail text with one', () => {
    const { rerender } = render(<ConfirmDialog {...base} />);
    expect(screen.queryByTestId('confirm-dialog-detail')).not.toBeInTheDocument();
    rerender(<ConfirmDialog {...base} detail="Cash Carter" />);
    expect(screen.getByTestId('confirm-dialog-detail')).toHaveTextContent('Cash Carter');
  });

  it('opens with focus on the cancel button, never on the confirm button', () => {
    render(<ConfirmDialog {...base} />);
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveFocus();
    expect(screen.getByTestId('confirm-dialog-confirm')).not.toHaveFocus();
  });

  it('closes on Escape', () => {
    render(<ConfirmDialog {...base} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(base.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus inside the dialog when tabbing past the last control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <ConfirmDialog {...base} />
      </>,
    );
    await user.tab();
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveFocus();
    expect(screen.getByText('outside')).not.toHaveFocus();
  });

  it('calls onClose from the cancel button and onConfirm from the confirm button', () => {
    render(<ConfirmDialog {...base} />);
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(base.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows a spinner while pending, and ignores Escape', () => {
    render(<ConfirmDialog {...base} pending />);
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-confirm').querySelector('svg')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(base.onClose).not.toHaveBeenCalled();
  });

  it('styles the confirm button with the brand color by default and the destructive color for the destructive tone', () => {
    const { rerender } = render(<ConfirmDialog {...base} />);
    expect(screen.getByTestId('confirm-dialog-confirm').className).toContain('bg-brand');
    expect(screen.getByTestId('confirm-dialog-confirm').className).not.toContain('bg-destructive');
    rerender(<ConfirmDialog {...base} tone="destructive" />);
    expect(screen.getByTestId('confirm-dialog-confirm').className).toContain('bg-destructive');
    expect(screen.getByTestId('confirm-dialog-confirm').className).not.toContain('bg-brand');
  });

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...base} open={false} />);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });
});
