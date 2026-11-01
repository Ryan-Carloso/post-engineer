import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'landing.pricingContactTitle': 'Talk to us to get tokens',
        'landing.pricingContactText': 'Contact us while in beta.',
        'landing.pricingWhatsappCta': 'Message us on WhatsApp',
        'landing.pricingEmailCta': 'Email us',
        'landing.pricingGithubTitle': 'Prefer to self-host?',
        'landing.pricingGithubText': 'Open source.',
        'landing.pricingGithubCta': 'View on GitHub',
        'landing.pricingWhatsappBeta': 'Hi! I would like tokens.',
      };
      return dict[key] ?? key;
    },
  }),
}));

import { PricingContactCard, SUPPORT_EMAIL, GITHUB_URL } from '../pricing-contact';

const WHATSAPP_ENV = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const TEST_NUMBER = '15551234567';
const origWhatsappEnv = process.env[WHATSAPP_ENV];

describe('PricingContactCard', () => {
  beforeEach(() => {
    process.env[WHATSAPP_ENV] = TEST_NUMBER;
  });

  afterEach(() => {
    if (origWhatsappEnv === undefined) delete process.env[WHATSAPP_ENV];
    else process.env[WHATSAPP_ENV] = origWhatsappEnv;
  });

  it('links WhatsApp with the beta message, email and GitHub, and shows no price', () => {
    const { container } = render(<PricingContactCard />);
    expect(screen.getByTestId('pricing-whatsapp-cta')).toHaveAttribute(
      'href',
      `https://wa.me/${TEST_NUMBER}?text=${encodeURIComponent('Hi! I would like tokens.')}`,
    );
    expect(screen.getByTestId('pricing-email-cta')).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL}`,
    );
    expect(screen.getByTestId('pricing-email-cta').textContent).toContain(SUPPORT_EMAIL);
    expect(screen.getByTestId('pricing-github-cta')).toHaveAttribute('href', GITHUB_URL);
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it('still shows email and GitHub when the WhatsApp number is not configured', () => {
    delete process.env[WHATSAPP_ENV];
    render(<PricingContactCard />);
    expect(screen.queryByTestId('pricing-whatsapp-cta')).toBeNull();
    expect(screen.getByTestId('pricing-email-cta')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-github-cta')).toBeInTheDocument();
  });
});
