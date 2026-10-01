import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { ProviderIcon } from '@/components/provider-icon';

//---------------
// ProviderIcon — one entry per social network in SOCIAL_PROVIDERS. The
// exhaustive icon map is enforced at compile time (satisfies
// Record<SocialProvider, ...>): adding a network to the registry without
// an icon breaks `tsc`. This suite pins the runtime side: every provider
// renders a labelled glyph.
//---------------

describe('ProviderIcon', () => {
  it('renders a labelled glyph for every social provider in the registry', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const { unmount } = render(<ProviderIcon provider={provider} />);
      expect(screen.getByRole('img', { name: provider })).toBeInTheDocument();
      unmount();
    }
  });

  it('hides the svg from assistive tech (the span carries the name)', () => {
    render(<ProviderIcon provider="youtube" />);
    const svg = screen.getByRole('img', { name: 'youtube' }).querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
