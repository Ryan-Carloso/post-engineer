import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';
import { dictionaries } from '@/lib/i18n';
import { PROVIDER_BRANDS, ProviderBrandIcon } from '@/components/provider-brand-icon';

function lookup(dictionary: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (
    typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined
  ), dictionary);
}

describe('ProviderBrandIcon', () => {
  it('renders a tinted tile with a glyph for every social provider', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const { unmount } = render(<ProviderBrandIcon provider={provider} />);
      const tile = screen.getByTestId(`provider-brand-${provider}`);
      for (const token of PROVIDER_BRANDS[provider].tileClassName.split(' ')) {
        expect(tile).toHaveClass(token);
      }
      expect(tile.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('keeps the brand colors the accounts page sections already used', () => {
    render(<ProviderBrandIcon provider="youtube" />);
    expect(screen.getByTestId('provider-brand-youtube')).toHaveClass('bg-destructive-soft', 'text-destructive');
  });

  it('names every provider with a label that exists in both locales', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      const key = PROVIDER_BRANDS[provider].labelKey;
      expect(typeof lookup(dictionaries.en, key), `${provider} en`).toBe('string');
      expect(typeof lookup(dictionaries.pt, key), `${provider} pt`).toBe('string');
    }
  });
});
