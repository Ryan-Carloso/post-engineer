import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans', className: '' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono', className: '' }),
}));

vi.mock('../providers', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../globals.css', () => ({}));

import RootLayout from '../layout';


describe('app/layout — RootLayout', () => {
  it('renders html shell with providers and children', () => {
    render(
      <RootLayout>
        <span data-testid="child">hello</span>
      </RootLayout>,
    );
    expect(screen.getByTestId('providers')).toContainElement(screen.getByTestId('child'));
  });

  it('sets lang attribute to pt-BR', () => {
    render(<RootLayout>content</RootLayout>);
    const html = document.querySelector('html');
    expect(html).toHaveAttribute('lang', 'pt-BR');
  });

  it('applies font CSS variable classes', () => {
    render(<RootLayout>content</RootLayout>);
    const html = document.querySelector('html');
    expect(html?.className).toContain('--font-geist-sans');
    expect(html?.className).toContain('--font-geist-mono');
  });

  it('renders body with min-h-dvh', () => {
    render(<RootLayout>content</RootLayout>);
    const body = document.querySelector('body');
    expect(body).toBeTruthy();
    expect(body?.className).toContain('min-h-dvh');
  });

  it('renders the WhatsApp support button when the support number is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '15551234567');
    try {
      render(<RootLayout>content</RootLayout>);
      const link = screen.getByRole('link', { name: 'WhatsApp' });
      expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/15551234567'));
      expect(link).toHaveAttribute('target', '_blank');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('hides the WhatsApp support button when no support number is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '');
    try {
      render(<RootLayout>content</RootLayout>);
      expect(screen.queryByRole('link', { name: 'WhatsApp' })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('root layout metadata icons', () => {
  it('declares every icon role in config (config icons do not merge with file-convention icons)', async () => {
    // Next.js 15 skips file-convention icons entirely once any config
    // `icons` object exists — omitting `apple:` here once silently dropped
    // the apple-touch-icon link with zero CI signal.
    const { metadata } = await import('../layout');
    expect(metadata.icons).toEqual({ icon: '/icon-128.png', apple: '/apple-icon.png' });
  });

  it('every declared icon resolves to a real file under apps/web/public/', async () => {
    const { metadata } = await import('../layout');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const publicDir = join(findRepoRoot(import.meta.url), 'apps', 'web', 'public');
    const icons = metadata.icons as { icon: string; apple: string };
    for (const href of [icons.icon, icons.apple]) {
      expect(href.startsWith('/'), `${href} must be a public/ path`).toBe(true);
      expect(existsSync(join(publicDir, href.slice(1))), `${href} does not exist under public/`).toBe(true);
    }
  });
});
