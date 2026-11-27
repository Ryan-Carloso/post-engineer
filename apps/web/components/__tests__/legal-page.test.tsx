import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => (key === 'legal.privacyBody' ? 'First paragraph.\n\nSecond paragraph.' : key) }),
}));
vi.mock('@/components/site-footer', () => ({ default: () => <footer data-testid="footer" /> }));

import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';

describe('LegalPage', () => {
  it('renders the privacy title, date and one paragraph per blank-line block', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('legal.privacyTitle');
    expect(screen.getByText('legal.privacyUpdated')).toBeInTheDocument();
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'madebyryandev@gmail.com' })).toHaveAttribute('href', 'mailto:madebyryandev@gmail.com');
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });

  it('renders the terms keys on the terms page', () => {
    render(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('legal.termsTitle');
    expect(screen.getByText('legal.termsUpdated')).toBeInTheDocument();
    expect(screen.getByText('legal.termsBody')).toBeInTheDocument();
  });
});
