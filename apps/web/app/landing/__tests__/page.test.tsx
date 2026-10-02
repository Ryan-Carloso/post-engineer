import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Landing from '@/app/landing/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }) };
});

vi.mock('@/lib/ui', () => ({
  FacebookIcon: () => <span />,
  InstagramIcon: () => <span />,
}));

vi.mock('@/components/ui/token-pack-cards', () => ({
  TokenPackCards: () => <div />,
  EnterpriseCard: () => <div />,
  packActionClassName: () => '',
}));

vi.mock('@/components/site-footer', () => ({
  default: () => <div />,
}));

describe('app/landing/page — Landing', () => {
  it('renders the brand logo in the header and footer (not the legacy bolt mark)', () => {
    // Pins the AppLogo usages: a silent revert to the old brand mark on
    // the landing surface would otherwise pass CI.
    render(<Landing />);
    expect(screen.getAllByTestId('app-logo')).toHaveLength(2);
  });
});
