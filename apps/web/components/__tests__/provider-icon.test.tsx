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

  it('renders the 3Speak play-triangle glyph', () => {
    render(<ProviderIcon provider="3speak" />);
    const img = screen.getByRole('img', { name: '3speak' });
    expect(img).toHaveClass('text-foreground');
    expect(img.querySelector('svg path')).toHaveAttribute('d', 'M8 5.5v13l11-6.5-11-6.5Z');
  });

  it('renders the Rumble glyph in Rumble green with the evenodd play mark', () => {
    render(<ProviderIcon provider="rumble" />);
    const img = screen.getByRole('img', { name: 'rumble' });
    expect(img).toHaveClass('text-[#85c742]');
    const path = img.querySelector('path');
    expect(path).toHaveAttribute('fill-rule', 'evenodd');
    expect(path).toHaveAttribute(
      'd',
      'M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3ZM10 8.2v7.6L16.8 12 10 8.2Z',
    );
  });
});
