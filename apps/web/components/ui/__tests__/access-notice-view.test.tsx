import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    locale: 'en',
  }),
}));

import { AccessNoticeView } from '../access-notice-view';

const CONTACT = 'https://wa.me/000000000';
const DISCORD = 'https://discord.gg/test';

function status(overrides: { active: boolean; daysLeft: number; reason: 'trial' | 'subscription' | 'none' }) {
  return { endsAt: 'x', ...overrides };
}

describe('AccessNoticeView', () => {
  it('shows the days left and the contact link while the trial runs', () => {
    render(<AccessNoticeView status={status({ active: true, daysLeft: 5, reason: 'trial' })} contactUrl={CONTACT} discordUrl={DISCORD} />);
    expect(screen.getByTestId('trial-banner')).toHaveTextContent('trial.bannerDaysLeft:{"days":5}');
    expect(screen.queryByTestId('access-inactive-card')).not.toBeInTheDocument();
    const link = screen.getByTestId('access-contact-link');
    expect(link).toHaveAttribute('href', CONTACT);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByTestId('access-discord-link')).toHaveAttribute('href', DISCORD);
    expect(screen.getByTestId('access-discord-link')).toHaveTextContent('trial.discordCta');
  });

  it('says it is the last day when one day or less is left', () => {
    render(<AccessNoticeView status={status({ active: true, daysLeft: 1, reason: 'trial' })} contactUrl={CONTACT} discordUrl={DISCORD} />);
    expect(screen.getByTestId('trial-banner')).toHaveTextContent('trial.bannerLastDay');
  });

  it('shows nothing for an active paid subscription', () => {
    const { container } = render(
      <AccessNoticeView status={status({ active: true, daysLeft: 300, reason: 'subscription' })} contactUrl={CONTACT} discordUrl={DISCORD} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the trial card with the contact link once the trial has ended', () => {
    render(<AccessNoticeView status={status({ active: false, daysLeft: 0, reason: 'trial' })} contactUrl={CONTACT} discordUrl={DISCORD} />);
    expect(screen.getByRole('alert')).toHaveTextContent('trial.expiredTitle');
    expect(screen.getByRole('alert')).toHaveTextContent('trial.expiredText');
    expect(screen.queryByTestId('trial-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('access-contact-link')).toHaveAttribute('href', CONTACT);
    expect(screen.getByTestId('access-discord-link')).toHaveAttribute('href', DISCORD);
    expect(screen.getByTestId('access-discord-link')).toHaveTextContent('access.discordCta');
  });

  it('shows the subscription card, not the trial copy, when a paid account lapses', () => {
    render(<AccessNoticeView status={status({ active: false, daysLeft: 0, reason: 'none' })} contactUrl={CONTACT} discordUrl={DISCORD} />);
    expect(screen.getByTestId('access-inactive-card')).toHaveTextContent('access.inactiveTitle');
    expect(screen.getByTestId('access-inactive-card')).toHaveTextContent('access.inactiveText');
    expect(screen.getByTestId('access-inactive-card')).not.toHaveTextContent('trial.expiredTitle');
    expect(screen.getByTestId('access-contact-link')).toHaveAttribute('href', CONTACT);
  });
});
