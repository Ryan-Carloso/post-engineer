import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'persona.errInsufficientTokens': 'Not enough tokens',
        'persona.upgradeHint': 'Upgrade your plan',
        'persona.upgradeCta': 'Upgrade plan',
        'persona.dialogClose': 'Close',
        'tokens.freeExhaustedTitle': 'Your free tokens ran out',
        'tokens.freeExhaustedHint': 'You already used your 3 free tokens.',
        'tokens.buyMore': 'Buy more tokens',
        'tokens.whatsappCta': 'WhatsApp us',
        'pricing.whatsappTokens': 'Hi! I want more tokens.',
      };
      let out = dict[key] ?? key;
      if (vars && typeof out === 'string') {
        for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
      }
      return out;
    },
  }),
}));

import { InsufficientTokensDialog } from '../insufficient-tokens-dialog';
import { useUpgradeDialogStore } from '@/lib/upgrade-dialog-store';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const origWhatsappEnv = process.env[WHATSAPP_ENV];

describe('InsufficientTokensDialog', () => {
  beforeEach(() => {
    useUpgradeDialogStore.setState({ isOpen: false, variant: 'generic' });
    process.env[WHATSAPP_ENV] = TEST_NUMBER;
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env[WHATSAPP_ENV];
    else process.env[WHATSAPP_ENV] = origWhatsappEnv;
  });

  it('renders nothing when closed', () => {
    render(<InsufficientTokensDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('generic 402: shows the plain insufficient copy without WhatsApp', () => {
    useUpgradeDialogStore.getState().open('generic');
    render(<InsufficientTokensDialog />);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Not enough tokens')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-cta')).toHaveTextContent('Upgrade plan');
    expect(screen.queryByTestId('whatsapp-cta')).toBeNull();
  });

  it('free exhausted: shows free copy, buy-more CTA and WhatsApp button', () => {
    useUpgradeDialogStore.getState().open('free');
    render(<InsufficientTokensDialog />);

    expect(screen.getByText('Your free tokens ran out')).toBeInTheDocument();
    expect(screen.getByText('You already used your 3 free tokens.')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-cta')).toHaveTextContent('Buy more tokens');

    const wa = screen.getByTestId('whatsapp-cta');
    expect(wa).toHaveAttribute('href', expect.stringContaining(`https://wa.me/${TEST_NUMBER}`));
    expect(wa.getAttribute('href')).toContain(encodeURIComponent('Hi! I want more tokens.'));
  });

  it('free exhausted: hides the WhatsApp button when the support number is not configured', () => {
    delete process.env[WHATSAPP_ENV];
    useUpgradeDialogStore.getState().open('free');
    render(<InsufficientTokensDialog />);

    expect(screen.getByText('Your free tokens ran out')).toBeInTheDocument();
    expect(screen.queryByTestId('whatsapp-cta')).toBeNull();
  });
});
