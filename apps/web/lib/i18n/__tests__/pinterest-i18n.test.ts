import { describe, expect, it } from 'vitest';
import { pinterestStrings } from '../pinterest-i18n';

// The Pinterest section of the accounts screen: its copy lives here because
// the main dictionaries may not grow. Pinned so a blanked string fails.
describe('pinterestStrings', () => {
  it('carries the label and the description in both locales', () => {
    expect(pinterestStrings.en.accounts).toEqual({
      pinterestLabel: 'Pinterest',
      pinterestDescription: 'Publish video Pins to your Pinterest boards.',
    });
    expect(pinterestStrings.pt.accounts).toEqual({
      pinterestLabel: 'Pinterest',
      pinterestDescription: 'Publique Pins de vídeo nos seus quadros do Pinterest.',
    });
  });

  it('no longer carries an MCP tool description (the tools card has one entry per tool)', () => {
    expect(pinterestStrings.en).not.toHaveProperty('apiKeys');
    expect(pinterestStrings.pt).not.toHaveProperty('apiKeys');
  });
});
