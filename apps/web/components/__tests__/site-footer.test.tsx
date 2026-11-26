import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SiteFooter from '@/components/site-footer';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }) };
});

describe('components/site-footer — public links', () => {
  it('links /docs and /help', () => {
    render(<SiteFooter />);
    expect(screen.getByRole('link', { name: 'footer.docs' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('link', { name: 'footer.help' })).toHaveAttribute('href', '/help');
  });

  it('keeps the privacy and terms links', () => {
    render(<SiteFooter />);
    expect(screen.getByRole('link', { name: 'footer.privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: 'footer.terms' })).toHaveAttribute('href', '/terms');
  });
});
