import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
