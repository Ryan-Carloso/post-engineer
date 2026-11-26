import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Landing from '@/app/landing/page';
import { enDictionary } from '@/lib/i18n/en';
import { ptDictionary } from '@/lib/i18n/pt';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ComponentProps<'img'>) => <img alt={alt} {...props} />,
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }) };
});

vi.mock('@/lib/ui', () => ({
  FacebookIcon: () => <span />,
  InstagramIcon: () => <span />,
}));

vi.mock('@/components/ui/pricing-contact', () => ({
  PricingContactCard: () => <div data-testid="pricing-contact" />,
}));

vi.mock('@/components/site-footer', () => ({
  default: () => <div />,
}));

describe('app/landing/page — Landing', () => {
  it('renders the brand logo in the header and footer (not the legacy bolt mark)', () => {
    render(<Landing />);
    expect(screen.getAllByTestId('app-logo')).toHaveLength(2);
  });

  it('renders the beta pricing contact card instead of token pack prices', () => {
    render(<Landing />);
    expect(screen.getByTestId('pricing-contact')).toBeInTheDocument();
    expect(screen.getByText('landing.pricingTitle')).toBeInTheDocument();
  });

  it('does not render the removed +500 creators claim anywhere', () => {
    render(<Landing />);
    expect(screen.queryByText('landing.socialProof')).toBeNull();
    expect(screen.queryByText(/500/)).toBeNull();
  });

  it('states no creator count in either locale dictionary', () => {
    expect(ptDictionary.landing.ctaFinalSubtitle.includes('centenas')).toBe(false);
    expect(ptDictionary.landing.ctaFinalSubtitle.includes('500')).toBe(false);
    expect(enDictionary.landing.ctaFinalSubtitle.includes('hundreds')).toBe(false);
    expect(enDictionary.landing.ctaFinalSubtitle.includes('500')).toBe(false);
  });

  it('renders the publish feature card with its title, hint and icon background', () => {
    render(<Landing />);
    expect(screen.getByText('landing.featurePublish')).toBeInTheDocument();
    expect(screen.getByText('landing.featurePublishHint')).toBeInTheDocument();
    const title = screen.getByText('landing.featurePublish');
    const card = title.closest('div')?.parentElement;
    expect(card?.querySelector('span')).toHaveClass('bg-[#eef2ff]');
  });
});
