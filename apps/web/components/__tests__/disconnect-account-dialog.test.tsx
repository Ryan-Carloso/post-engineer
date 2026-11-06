import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DisconnectAccountDialog from '@/components/ui/disconnect-account-dialog';

describe('DisconnectAccountDialog', () => {
  const base = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    accountName: 'Cash Carter',
    title: 'Disconnect this account?',
    body: 'The account leaves your accounts list.',
    cancelLabel: 'Cancel',
    confirmLabel: 'Disconnect',
  };

  it('renders the title, body and the account name', () => {
    render(<DisconnectAccountDialog {...base} />);
    expect(screen.getByText(base.title)).toBeTruthy();
    expect(screen.getByText(base.body)).toBeTruthy();
    expect(screen.getByTestId('disconnect-dialog-account').textContent).toContain(base.accountName);
  });

  it('starts with initial focus on the cancel button', () => {
    render(<DisconnectAccountDialog {...base} />);
    expect(document.activeElement).toBe(screen.getByTestId('disconnect-cancel-button'));
  });

  it('calls onClose when the cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<DisconnectAccountDialog {...base} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('disconnect-cancel-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<DisconnectAccountDialog {...base} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('disconnect-confirm-button'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables the confirm button while pending', () => {
    render(<DisconnectAccountDialog {...base} pending />);
    const confirm = screen.getByTestId('disconnect-confirm-button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<DisconnectAccountDialog {...base} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render anything when closed', () => {
    render(<DisconnectAccountDialog {...base} open={false} />);
    expect(screen.queryByTestId('disconnect-dialog')).toBeNull();
  });
});
