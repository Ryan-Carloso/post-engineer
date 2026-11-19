import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  const useI18n = vi.fn(() => ({ t, locale: 'pt', setLocale: vi.fn() }));
  return {
    useI18n,
    I18nProvider,
  };
});

import { I18nProvider } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { PersonaCtaSection } from '../persona-cta-section';

const CTA_TYPE_KEYS = [
  'personas.ctaTypeFollow',
  'personas.ctaTypeComment',
  'personas.ctaTypeShare',
  'personas.ctaTypeSave',
  'personas.ctaTypeLink',
  'personas.ctaTypeBuy',
  'personas.ctaTypeOther',
];

const CTA_LINK_WHAT_KEYS = [
  'personas.ctaLinkYoutube',
  'personas.ctaLinkInstagram',
  'personas.ctaLinkBluesky',
  'personas.ctaLinkLinkedin',
  'personas.ctaLinkThreads',
  'personas.ctaLinkFacebook',
  'personas.ctaLinkPinterest',
  'personas.ctaLinkThreespeak',
  'personas.ctaLinkRumble',
  'personas.ctaLinkFanvue',
  'personas.ctaLinkTelegram',
];

function renderSection() {
  return render(
    <I18nProvider>
      <PersonaCtaSection />
    </I18nProvider>,
  );
}

async function selectType(user: ReturnType<typeof userEvent.setup>, typeKey: string) {
  await user.click(screen.getByTestId('persona-cta-type'));
  await user.click(screen.getByRole('option', { name: typeKey }));
}

describe('PersonaCtaSection', () => {
  beforeEach(() => {
    usePersonaStore.setState({ ctaType: 'follow', ctaUrl: '', ctaInstruction: '' });
  });

  it('defaults to follow: shows the follow preview, no URL or instruction field, no link table', () => {
    renderSection();

    expect(screen.getByText('personas.ctaPreviewFollow')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-cta-url')).toBeNull();
    expect(screen.queryByTestId('persona-cta-instruction')).toBeNull();
    expect(screen.queryByText('personas.ctaLinkTableTitle')).toBeNull();
  });

  it('lists all seven CTA types in the select', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByTestId('persona-cta-type'));
    for (const key of CTA_TYPE_KEYS) {
      expect(screen.getByRole('option', { name: key })).toBeInTheDocument();
    }
  });

  it('selecting link shows the URL field, the link preview and the per-network table', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeLink');

    expect(screen.getByTestId('persona-cta-url')).toBeInTheDocument();
    expect(screen.getByText('personas.ctaPreviewLink')).toBeInTheDocument();
    expect(screen.getByText('personas.ctaLinkTableTitle')).toBeInTheDocument();
    for (const key of CTA_LINK_WHAT_KEYS) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('row')).toHaveLength(12);
    expect(screen.getAllByText('personas.ctaLinkYes')).toHaveLength(9);
    expect(screen.getAllByText('personas.ctaLinkNo')).toHaveLength(2);
  });

  it('selecting other shows the instruction field and no URL field or link table', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeOther');

    expect(screen.getByTestId('persona-cta-instruction')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-cta-url')).toBeNull();
    expect(screen.queryByText('personas.ctaLinkTableTitle')).toBeNull();
    expect(screen.getByText('personas.ctaPreviewOther')).toBeInTheDocument();
  });

  it('typing a URL writes the store', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeLink');
    await user.type(screen.getByTestId('persona-cta-url'), 'https://example.com/course');

    expect(usePersonaStore.getState().ctaUrl).toBe('https://example.com/course');
  });

  it('typing an instruction writes the store', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeOther');
    await user.type(screen.getByTestId('persona-cta-instruction'), 'Invite to the WhatsApp group');

    expect(usePersonaStore.getState().ctaInstruction).toBe('Invite to the WhatsApp group');
  });

  it('switching link to comment clears the stored URL and hides the URL field', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeLink');
    await user.type(screen.getByTestId('persona-cta-url'), 'https://example.com/course');
    expect(usePersonaStore.getState().ctaUrl).toBe('https://example.com/course');

    await selectType(user, 'personas.ctaTypeComment');

    expect(usePersonaStore.getState().ctaUrl).toBe('');
    expect(screen.queryByTestId('persona-cta-url')).toBeNull();
    expect(screen.getByText('personas.ctaPreviewComment')).toBeInTheDocument();
  });

  it('switching other to follow clears the stored instruction and hides the instruction field', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeOther');
    await user.type(screen.getByTestId('persona-cta-instruction'), 'Invite to the WhatsApp group');
    expect(usePersonaStore.getState().ctaInstruction).toBe('Invite to the WhatsApp group');

    await selectType(user, 'personas.ctaTypeFollow');

    expect(usePersonaStore.getState().ctaInstruction).toBe('');
    expect(screen.queryByTestId('persona-cta-instruction')).toBeNull();
    expect(screen.getByText('personas.ctaPreviewFollow')).toBeInTheDocument();
  });

  it('switching link to buy keeps the stored URL', async () => {
    const user = userEvent.setup();
    renderSection();

    await selectType(user, 'personas.ctaTypeLink');
    await user.type(screen.getByTestId('persona-cta-url'), 'https://example.com/course');

    await selectType(user, 'personas.ctaTypeBuy');

    expect(usePersonaStore.getState().ctaUrl).toBe('https://example.com/course');
    expect(screen.getByTestId('persona-cta-url')).toBeInTheDocument();
    expect(screen.getByText('personas.ctaPreviewBuy')).toBeInTheDocument();
  });
});
