import { describe, it, expect } from 'vitest';

import { parsePersonaCtaType, validateCtaCoherence } from '@/lib/persona-schema';

describe('validateCtaCoherence', () => {
  it('accepts each type with its facts and nothing extra', () => {
    expect(validateCtaCoherence('follow', null, null)).toBeNull();
    expect(validateCtaCoherence('comment', null, null)).toBeNull();
    expect(validateCtaCoherence('share', null, null)).toBeNull();
    expect(validateCtaCoherence('save', null, null)).toBeNull();
    expect(validateCtaCoherence('link', 'https://example.com/x', null)).toBeNull();
    expect(validateCtaCoherence('buy', 'https://example.com/x', null)).toBeNull();
    expect(validateCtaCoherence('other', null, 'invite to the WhatsApp group')).toBeNull();
  });

  it('rejects a link or buy CTA without a URL', () => {
    expect(validateCtaCoherence('link', null, null)).toBe('A link CTA needs a URL.');
    expect(validateCtaCoherence('buy', '', null)).toBe('A buy CTA needs a URL.');
  });

  it('rejects an other CTA without an instruction', () => {
    expect(validateCtaCoherence('other', null, null)).toBe('An other CTA needs an instruction.');
    expect(validateCtaCoherence('other', null, '')).toBe('An other CTA needs an instruction.');
  });

  it('rejects facts that belong to another type', () => {
    expect(validateCtaCoherence('link', 'https://example.com/x', 'join the group')).toBe(
      'A link CTA takes a URL, not an instruction.',
    );
    expect(validateCtaCoherence('other', 'https://example.com/x', 'join the group')).toBe(
      'An other CTA takes an instruction, not a URL.',
    );
    expect(validateCtaCoherence('follow', 'https://example.com/x', null)).toBe(
      'A follow, comment, share or save CTA takes no URL or instruction.',
    );
    expect(validateCtaCoherence('comment', null, 'ask them')).toBe(
      'A follow, comment, share or save CTA takes no URL or instruction.',
    );
  });

  it('treats an absent type as follow, so facts without a type are incoherent', () => {
    expect(validateCtaCoherence(null, 'https://example.com/x', null)).toBe(
      'A follow, comment, share or save CTA takes no URL or instruction.',
    );
    expect(validateCtaCoherence(null, null, null)).toBeNull();
  });
});

describe('parsePersonaCtaType', () => {
  it('passes through every known type', () => {
    for (const type of ['follow', 'comment', 'share', 'save', 'link', 'buy', 'other'] as const) {
      expect(parsePersonaCtaType(type)).toBe(type);
    }
  });

  it('defaults legacy, absent and unknown values to follow', () => {
    expect(parsePersonaCtaType(null)).toBe('follow');
    expect(parsePersonaCtaType(undefined)).toBe('follow');
    expect(parsePersonaCtaType('')).toBe('follow');
    expect(parsePersonaCtaType('subscribe')).toBe('follow');
  });
});
