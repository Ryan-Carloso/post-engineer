import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
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

describe('WhatsAppFloatingButton', () => {
  it('renders the floating button with the built-in number', () => {
    render(<WhatsAppFloatingButton />);
    const link = screen.getByRole('link', { name: 'WhatsApp' });
    expect(link).toHaveAttribute(
      'href',
      `https://wa.me/351962248268?text=${encodeURIComponent('Hi! I need help.')}`,
    );
  });

  it('opens the chat in a new tab', () => {
    render(<WhatsAppFloatingButton />);
    const link = screen.getByRole('link', { name: 'WhatsApp' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
