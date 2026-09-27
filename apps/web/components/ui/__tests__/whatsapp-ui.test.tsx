import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'pricing.whatsappHelp': 'Hi! I need help.',
        'pricing.whatsappEnterprise': 'Hi! I need enterprise pricing.',
        'pricing.enterpriseTitle': 'Enterprise',
        'pricing.enterpriseDescription': 'High volume',
        'pricing.enterpriseCta': 'Talk to us',
      };
      return dict[key] ?? key;
    },
  }),
}));

import WhatsAppFloatingButton from '../whatsapp-button';
import { EnterpriseCard } from '../token-pack-cards';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const origWhatsappEnv = process.env[WHATSAPP_ENV];

describe('WhatsAppFloatingButton', () => {
  beforeEach(() => {
    process.env[WHATSAPP_ENV] = TEST_NUMBER;
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env[WHATSAPP_ENV];
    else process.env[WHATSAPP_ENV] = origWhatsappEnv;
  });

  it('renders the floating button with the configured number', () => {
    const { container } = render(<WhatsAppFloatingButton />);
    const link = screen.getByRole('link', { name: 'WhatsApp' });
    expect(link).toHaveAttribute(
      'href',
      `https://wa.me/${TEST_NUMBER}?text=${encodeURIComponent('Hi! I need help.')}`,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('renders nothing when the support number is not configured', () => {
    delete process.env[WHATSAPP_ENV];
    const { container } = render(<WhatsAppFloatingButton />);
    expect(container.firstChild).toBeNull();
  });
});

describe('EnterpriseCard', () => {
  beforeEach(() => {
    process.env[WHATSAPP_ENV] = TEST_NUMBER;
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env[WHATSAPP_ENV];
    else process.env[WHATSAPP_ENV] = origWhatsappEnv;
  });

  it('renders the enterprise card with the configured number', () => {
    render(<EnterpriseCard />);
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining(`https://wa.me/${TEST_NUMBER}`),
    );
  });

  it('renders nothing when the support number is not configured', () => {
    delete process.env[WHATSAPP_ENV];
    const { container } = render(<EnterpriseCard />);
    expect(container.firstChild).toBeNull();
  });
});
