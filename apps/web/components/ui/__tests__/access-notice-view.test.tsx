import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { dictionaries } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/types';

const localeRef = vi.hoisted(() => ({ current: 'en' as 'en' | 'pt' }));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined), dictionaries[localeRef.current]);
      return typeof value === 'string' ? value : key;
    },
    locale: localeRef.current,
  }),
}));

import { AccessNoticeView } from '../access-notice-view';

const CONTACT = 'https://wa.me/000000000';
const DISCORD = 'https://discord.gg/test';
const GITHUB = 'https://github.com/test/test';

function status(overrides: { active: boolean; reason: 'beta' | 'subscription' | 'none' }) {
  return { endsAt: 'x', ...overrides };
}

function renderNotice(locale: Locale, overrides: { active: boolean; reason: 'beta' | 'subscription' | 'none' }) {
  localeRef.current = locale;
  return render(<AccessNoticeView status={status(overrides)} contactUrl={CONTACT} discordUrl={DISCORD} githubUrl={GITHUB} />);
}

describe('AccessNoticeView', () => {
  it('asks an account awaiting the beta to request access on Discord, in English', () => {
    renderNotice('en', { active: false, reason: 'beta' });
    expect(screen.getByRole('alert')).toHaveTextContent("You're not in the beta yet");
    expect(screen.getByRole('alert')).toHaveTextContent('Request access on Discord.');
    expect(screen.getByTestId('access-discord-link')).toHaveTextContent('Request access on Discord ↗');
    expect(screen.getByTestId('access-discord-link')).toHaveAttribute('href', DISCORD);
    expect(screen.getByTestId('access-contact-link')).toHaveTextContent('Message us on WhatsApp ↗');
    expect(screen.getByTestId('access-contact-link')).toHaveAttribute('href', CONTACT);
    expect(screen.getByTestId('access-github-link')).toHaveTextContent('View on GitHub ↗');
    expect(screen.getByTestId('access-github-link')).toHaveAttribute('href', GITHUB);
  });

  it('asks an account awaiting the beta to request access on Discord, in Portuguese', () => {
    renderNotice('pt', { active: false, reason: 'beta' });
    expect(screen.getByRole('alert')).toHaveTextContent('Você ainda não está no beta');
    expect(screen.getByRole('alert')).toHaveTextContent('Peça acesso no Discord.');
    expect(screen.getByTestId('access-discord-link')).toHaveTextContent('Pedir acesso no Discord ↗');
    expect(screen.getByTestId('access-contact-link')).toHaveTextContent('Chamar no WhatsApp ↗');
    expect(screen.getByTestId('access-github-link')).toHaveTextContent('Ver no GitHub ↗');
  });

  it('opens every contact link in a new tab without a referrer', () => {
    renderNotice('en', { active: false, reason: 'beta' });
    for (const id of ['access-discord-link', 'access-contact-link', 'access-github-link']) {
      expect(screen.getByTestId(id)).toHaveAttribute('target', '_blank');
      expect(screen.getByTestId(id)).toHaveAttribute('rel', 'noreferrer');
    }
  });

  it('shows nothing for an admitted beta account', () => {
    const { container } = renderNotice('en', { active: true, reason: 'beta' });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for an active paid subscription', () => {
    const { container } = renderNotice('en', { active: true, reason: 'subscription' });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the subscription card, not the beta copy, when a paid account lapses', () => {
    renderNotice('en', { active: false, reason: 'none' });
    expect(screen.getByTestId('access-inactive-card')).toHaveTextContent('Your subscription is inactive');
    expect(screen.getByTestId('access-inactive-card')).not.toHaveTextContent("You're not in the beta yet");
    expect(screen.getByTestId('access-contact-link')).toHaveTextContent('Contact us on WhatsApp ↗');
    expect(screen.getByTestId('access-contact-link')).toHaveAttribute('href', CONTACT);
    expect(screen.getByTestId('access-discord-link')).toHaveAttribute('href', DISCORD);
    expect(screen.queryByTestId('access-github-link')).not.toBeInTheDocument();
  });
});
