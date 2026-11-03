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

vi.mock('@/components/ui/pricing-contact', () => ({
  PricingContactCard: () => <div data-testid="pricing-contact" />,
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

  it('renders the beta pricing contact card instead of token pack prices', () => {
    render(<Landing />);
    expect(screen.getByTestId('pricing-contact')).toBeInTheDocument();
    expect(screen.getByText('landing.pricingTitle')).toBeInTheDocument();
  });

  it('does not render the removed +500 creators claim anywhere', () => {
    // Owner decision: no unverified creator count on the landing, in
    // either locale. The mock t() returns the key itself, so the
    // removed line would surface as 'landing.socialProof' if it came back.
    render(<Landing />);
    expect(screen.queryByText('landing.socialProof')).toBeNull();
    expect(screen.queryByText(/500/)).toBeNull();
  });

  it('states no creator count in either locale dictionary', () => {
    // The test above renders with a mocked t(), so it cannot see
    // dictionary text: assert the real values carry no count claim.
    expect(ptDictionary.landing.ctaFinalSubtitle.includes('centenas')).toBe(false);
    expect(ptDictionary.landing.ctaFinalSubtitle.includes('500')).toBe(false);
    expect(enDictionary.landing.ctaFinalSubtitle.includes('hundreds')).toBe(false);
    expect(enDictionary.landing.ctaFinalSubtitle.includes('500')).toBe(false);
  });
});
