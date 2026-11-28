import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'landing.pricingContactTitle': 'Talk to us to get tokens',
        'landing.pricingContactText': 'Contact us while in beta.',
        'landing.pricingWhatsappCta': 'Message us on WhatsApp',
        'landing.pricingDiscordCta': 'Join the Discord',
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

import { PricingContactCard } from '../pricing-contact';

const SUPPORT_EMAIL_LITERAL = 'madebyryandev@gmail.com';
const GITHUB_URL_LITERAL = 'https://github.com/Ryan-Carloso/post-engineer';

describe('PricingContactCard', () => {
  it('links WhatsApp with the beta message, Discord, email and GitHub, and shows no price', () => {
    const { container } = render(<PricingContactCard />);
    expect(screen.getByTestId('pricing-whatsapp-cta')).toHaveAttribute(
      'href',
      `https://wa.me/351962248268?text=${encodeURIComponent('Hi! I would like tokens.')}`,
    );
    expect(screen.getByTestId('pricing-whatsapp-cta').textContent).toBe(
      'Message us on WhatsApp ↗',
    );
    expect(screen.getByTestId('pricing-discord-cta')).toHaveAttribute('href', 'https://discord.gg/ukmCXMCDJ');
    expect(screen.getByTestId('pricing-discord-cta').textContent).toBe('Join the Discord ↗');
    expect(screen.getByTestId('pricing-email-cta')).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL_LITERAL}`,
    );
    expect(screen.getByTestId('pricing-email-cta').textContent).toBe(
      `Email us · ${SUPPORT_EMAIL_LITERAL}`,
    );
    expect(screen.getByTestId('pricing-github-cta')).toHaveAttribute(
      'href',
      GITHUB_URL_LITERAL,
    );
    expect(screen.getByTestId('pricing-github-cta').textContent).toBe('View on GitHub ↗');
    expect(
      screen.getByRole('heading', { name: 'Talk to us to get tokens' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Contact us while in beta.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Prefer to self-host?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Open source.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it('renders the WhatsApp and Discord buttons with the same style', () => {
    render(<PricingContactCard />);
    expect(screen.getByTestId('pricing-discord-cta').className).toBe(
      screen.getByTestId('pricing-whatsapp-cta').className,
    );
  });
});
