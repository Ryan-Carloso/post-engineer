import { describe, expect, it } from 'vitest';
import {
  CARD_STYLES,
  STYLE_PROMPT,
  parseIdentityCardValue,
  parseSceneValue,
} from '@/lib/contracts/persona-identity-card';

const FORBIDDEN_DESCRIPTION_WORDS = [
  'nude', 'naked', 'topless', 'lingerie', 'bikini', 'underwear', 'thong', 'revealing', 'sheer', 'transparent',
  'see-through', 'sexy', 'sexual', 'erotic', 'swimsuit', 'cleavage',
];

describe('card styles', () => {
  it('lists the nineteen styles', () => {
    expect(CARD_STYLES).toHaveLength(19);
    expect(new Set(CARD_STYLES).size).toBe(19);
  });

  it('describes every style and nothing else', () => {
    expect(Object.keys(STYLE_PROMPT).sort()).toEqual([...CARD_STYLES].sort());
    for (const style of CARD_STYLES) {
      expect(STYLE_PROMPT[style].label.length).toBeGreaterThan(0);
      expect(STYLE_PROMPT[style].description.length).toBeGreaterThan(0);
    }
  });

  it.each(CARD_STYLES)('keeps the %s description free of revealing or sexualised words', (style) => {
    const text = `${STYLE_PROMPT[style].label} ${STYLE_PROMPT[style].description}`.toLowerCase();
    for (const word of FORBIDDEN_DESCRIPTION_WORDS) {
      expect(text.includes(word), `${style} mentions ${word}`).toBe(false);
    }
  });

  it.each(CARD_STYLES)('passes the clothing and scene filters with the %s description', (style) => {
    const { label, description } = STYLE_PROMPT[style];
    const card = {
      version: 1,
      identity: { body: { height: 'tall' } },
      defaults: { outfit: { top: `${label}, ${description}`.slice(0, 80) } },
    };
    expect(parseIdentityCardValue(card).ok).toBe(true);
    const scene = { pose: description, setting: label, lighting: 'studio', framing: 'waist_up' };
    expect(parseSceneValue(scene).ok).toBe(true);
  });

  it('pins the safe wording of the styles that could drift toward revealing clothes', () => {
    expect(STYLE_PROMPT.sensual).toEqual({ label: 'sensual', description: 'fitted, elegant, confident' });
    expect(STYLE_PROMPT.beach).toEqual({ label: 'beachwear', description: 'linen, sundress, no swimwear' });
    expect(STYLE_PROMPT.party).toEqual({ label: 'party', description: 'festive evening outfit, no swimwear' });
    expect(STYLE_PROMPT.glamorous).toEqual({ label: 'glamorous', description: 'polished evening look, no swimwear' });
  });
});
