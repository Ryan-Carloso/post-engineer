import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import SocialAccountsSection from '@/components/ui/social-accounts-section';

function renderSection(overrides: Partial<React.ComponentProps<typeof SocialAccountsSection>> = {}): void {
  render(
    <SocialAccountsSection
      icon={<span data-testid="network-icon" />}
      label="YouTube"
      description="Publish videos"
      connectedLabel="2 accounts connected"
      count={2}
      accounts={[<div key="account">Channel Alpha</div>]}
      isLoading={false}
      loadError={null}
      connectLabel="+ Connect another account"
      connectError={null}
      connectDisabled={false}
      retryLabel="Try again"
      onConnect={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SocialAccountsSection', () => {
  it('renders the shared network header and account slot', () => {
    renderSection();

    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('Channel Alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Connect another account' })).toBeInTheDocument();
  });

  it('calls the connection callback from the shared slot', () => {
    const onConnect = vi.fn();
    renderSection({ connectLabel: 'Connect an account', onConnect });

    fireEvent.click(screen.getByRole('button', { name: 'Connect an account' }));

    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('renders loading and recoverable error states', () => {
    renderSection({ isLoading: true });
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();

    const onRetry = vi.fn();
    renderSection({ loadError: 'Could not load accounts', onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders an injected dialog without owning its state', () => {
    const dialog: ReactNode = <div role="dialog">Bluesky form</div>;
    renderSection({ dialog });

    expect(screen.getByRole('dialog')).toHaveTextContent('Bluesky form');
  });
});
