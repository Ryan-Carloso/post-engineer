import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    locale: 'en',
  }),
}));

import { TrialNoticeView } from '../trial-notice-view';

const CONTACT = 'https://wa.me/000000000';

describe('TrialNoticeView', () => {
  it('shows the days left and the contact link while the trial runs', () => {
    render(<TrialNoticeView status={{ endsAt: 'x', active: true, daysLeft: 5 }} contactUrl={CONTACT} />);
    expect(screen.getByTestId('trial-banner')).toHaveTextContent('trial.bannerDaysLeft:{"days":5}');
    expect(screen.queryByTestId('trial-expired-card')).not.toBeInTheDocument();
    const link = screen.getByTestId('trial-contact-link');
    expect(link).toHaveAttribute('href', CONTACT);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('says it is the last day when one day or less is left', () => {
    render(<TrialNoticeView status={{ endsAt: 'x', active: true, daysLeft: 1 }} contactUrl={CONTACT} />);
    expect(screen.getByTestId('trial-banner')).toHaveTextContent('trial.bannerLastDay');
  });

  it('shows the expired card with the contact link once the trial has ended', () => {
    render(<TrialNoticeView status={{ endsAt: 'x', active: false, daysLeft: 0 }} contactUrl={CONTACT} />);
    expect(screen.getByRole('alert')).toHaveTextContent('trial.expiredTitle');
    expect(screen.getByRole('alert')).toHaveTextContent('trial.expiredText');
    expect(screen.queryByTestId('trial-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('trial-contact-link')).toHaveAttribute('href', CONTACT);
  });
});
