import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'pricing.cancelDialogTitle': 'Why did you cancel?',
        'pricing.cancelDialogDesc': 'Tell us in 5 seconds.',
        'pricing.cancelReasonPrice': 'Too expensive',
        'pricing.cancelReasonTesting': 'Just testing',
        'pricing.cancelReasonOther': 'Other',
        'pricing.cancelDetailsLabel': 'Add details?',
        'pricing.cancelDetailsPlaceholder': 'Details…',
        'pricing.cancelWhatsappCta': 'Send via WhatsApp',
        'pricing.cancelClose': 'Close',
        'pricing.whatsappCancel': 'Hi! I canceled my checkout. Reason: {reason}',
      };
      let out = dict[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
      }
      return out;
    },
  }),
}));

import { CheckoutCancelDialog } from '../checkout-cancel-dialog';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const origWhatsappEnv = process.env[WHATSAPP_ENV];

describe('CheckoutCancelDialog', () => {
  beforeEach(() => {
    process.env[WHATSAPP_ENV] = TEST_NUMBER;
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env[WHATSAPP_ENV];
    else process.env[WHATSAPP_ENV] = origWhatsappEnv;
  });

  it('renders nothing when closed', () => {
    render(<CheckoutCancelDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows reasons and a WhatsApp CTA with the default reason pre-filled', () => {
    render(<CheckoutCancelDialog open onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Why did you cancel?' })).toBeInTheDocument();
    expect(screen.getByTestId('cancel-reason-price')).toBeChecked();

    const wa = screen.getByTestId('cancel-whatsapp-cta');
    expect(wa).toHaveAttribute('href', expect.stringContaining(`https://wa.me/${TEST_NUMBER}`));
    expect(wa.getAttribute('href')).toContain(encodeURIComponent('Too expensive'));
  });

  it('updates the WhatsApp message when reason and details change', () => {
    render(<CheckoutCancelDialog open onClose={() => {}} />);

    fireEvent.click(screen.getByTestId('cancel-reason-other'));
    fireEvent.change(screen.getByTestId('cancel-details'), { target: { value: 'had a question' } });

    const wa = screen.getByTestId('cancel-whatsapp-cta');
    expect(wa.getAttribute('href')).toContain(encodeURIComponent('Other'));
    expect(wa.getAttribute('href')).toContain(encodeURIComponent('had a question'));
  });

  it('hides the WhatsApp CTA when the support number is not configured', () => {
    delete process.env[WHATSAPP_ENV];
    render(<CheckoutCancelDialog open onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Why did you cancel?' })).toBeInTheDocument();
    expect(screen.queryByTestId('cancel-whatsapp-cta')).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<CheckoutCancelDialog open onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cancel-dialog-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
