// Per-persona CTA intent shape (issue #639): the MCP tool shape and the
// shared contract must accept/reject the same intent values, and the
// client flattens the nested object to the route's flat FormData fields.
import { describe, expect, it } from 'vitest';
import { PersonaCtaSchema } from '../contracts/personas.js';
import { PERSONA_CTA_TYPES } from '../limits.js';
import { appendPersonaCtaFields, PersonaCtaShape } from '../persona-cta-shape.js';

const CASES: Array<{ cta: unknown; accepts: boolean }> = [
  { cta: { type: 'follow' }, accepts: true },
  { cta: { type: 'comment' }, accepts: true },
  { cta: { type: 'share' }, accepts: true },
  { cta: { type: 'save' }, accepts: true },
  { cta: { type: 'link', url: 'https://example.com/course' }, accepts: true },
  { cta: { type: 'buy', url: 'https://example.com/buy' }, accepts: true },
  { cta: { type: 'other', instruction: 'Invite to the WhatsApp group' }, accepts: true },
  { cta: { type: 'link' }, accepts: false },
  { cta: { type: 'buy' }, accepts: false },
  { cta: { type: 'other' }, accepts: false },
  { cta: { type: 'follow', url: 'https://example.com/x' }, accepts: false },
  { cta: { type: 'comment', instruction: 'Ask a question' }, accepts: false },
  { cta: { type: 'link', url: 'not-a-url' }, accepts: false },
  { cta: { type: 'link', url: `https://example.com/${'x'.repeat(2048)}` }, accepts: false },
  { cta: { type: 'other', instruction: 'x'.repeat(501) }, accepts: false },
  { cta: { type: 'shout' }, accepts: false },
];

describe('persona CTA shape (issue #639)', () => {
  it('accepts every intent type with its facts and rejects incoherent ones', () => {
    for (const { cta, accepts } of CASES) {
      expect(PersonaCtaShape.safeParse(cta).success, JSON.stringify(cta)).toBe(accepts);
    }
  });

  it('agrees with the shared contract schema on every case', () => {
    // The tool fails fast locally with the same rule the server enforces:
    // a case the tool accepts must pass the contract, and one it rejects
    // must fail there too.
    for (const { cta, accepts } of CASES) {
      expect(PersonaCtaSchema.safeParse(cta).success, JSON.stringify(cta)).toBe(accepts);
    }
  });

  it('reuses the contract type list instead of defining its own', () => {
    expect([...PERSONA_CTA_TYPES]).toEqual(['follow', 'comment', 'share', 'save', 'link', 'buy', 'other']);
  });

  it('flattens the nested intent to the route flat fields, leaving absent facts untouched', () => {
    const formData = new FormData();
    appendPersonaCtaFields(formData, undefined);
    expect([...formData.keys()]).toEqual([]);

    appendPersonaCtaFields(formData, { type: 'link', url: 'https://example.com/course' });
    expect(formData.get('ctaType')).toBe('link');
    expect(formData.get('ctaUrl')).toBe('https://example.com/course');
    expect(formData.has('ctaInstruction')).toBe(false);

    const update = new FormData();
    appendPersonaCtaFields(update, { type: 'other', instruction: 'Invite to the WhatsApp group' });
    expect(update.get('ctaType')).toBe('other');
    expect(update.get('ctaInstruction')).toBe('Invite to the WhatsApp group');
    // An absent fact sends nothing, so an update never clears a fact the
    // caller did not mention.
    expect(update.has('ctaUrl')).toBe(false);
  });
});
