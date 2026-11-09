import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyConnectDialog } from '@/components/ui/social-accounts-section';

//---------------
// KeyConnectDialog — the shared connect dialog for key-based providers
// (Bluesky app password, 3Speak Hive posting key). Pins the submit-button
// disabled logic (both fields non-blank, not pending), the idPrefix
// scoping of the dialog title/testids, and the error display.
//---------------
function renderDialog(overrides: Partial<React.ComponentProps<typeof KeyConnectDialog>> = {}) {
  const props: React.ComponentProps<typeof KeyConnectDialog> = {
    title: 'Connect your account',
    hint: 'Enter your credentials.',
    handleLabel: 'Handle',
    passwordLabel: 'Secret',
    submitLabel: 'Connect',
    securityHint: 'Keep your secret safe.',
    closeLabel: 'Close',
    handle: '',
    appPassword: '',
    error: null,
    pending: false,
    idPrefix: 'test',
    onHandleChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<KeyConnectDialog {...props} />);
  return props;
}

describe('KeyConnectDialog', () => {
  it('labels the dialog with its title and scopes testids by idPrefix', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Connect your account' })).toBeInTheDocument();
    expect(screen.getByTestId('test-handle-input')).toBeInTheDocument();
    expect(screen.getByTestId('test-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('test-connect-button')).toBeInTheDocument();
  });

  it('disables submit until both fields are non-blank', () => {
    renderDialog();
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('disables submit when only the handle is filled', () => {
    renderDialog({ handle: 'alice' });
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('disables submit when only the secret is filled', () => {
    renderDialog({ appPassword: '5K-secret' });
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('disables submit when the handle holds only whitespace', () => {
    renderDialog({ handle: '   ', appPassword: '5K-secret' });
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('disables submit when the secret holds only whitespace', () => {
    renderDialog({ handle: 'alice', appPassword: '   ' });
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('enables submit when both fields are filled and not pending', () => {
    const props = renderDialog({ handle: 'alice', appPassword: '5K-secret' });
    const button = screen.getByTestId('test-connect-button');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables submit while pending even with both fields filled', () => {
    renderDialog({ handle: 'alice', appPassword: '5K-secret', pending: true });
    expect(screen.getByTestId('test-connect-button')).toBeDisabled();
  });

  it('shows the error and reports field changes', () => {
    const props = renderDialog({ error: 'Something went wrong.' });
    expect(screen.getByTestId('test-connect-error')).toHaveTextContent('Something went wrong.');
    fireEvent.change(screen.getByTestId('test-handle-input'), { target: { value: 'alice' } });
    expect(props.onHandleChange).toHaveBeenCalledWith('alice');
    fireEvent.change(screen.getByTestId('test-password-input'), { target: { value: '5K-secret' } });
    expect(props.onPasswordChange).toHaveBeenCalledWith('5K-secret');
  });
});
