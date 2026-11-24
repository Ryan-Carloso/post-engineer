import { describe, it, expect } from 'vitest';

import { resolveEffectiveCta, validateCtaTake, type ResolvedCta } from '../cta-validation';

const FOLLOW: ResolvedCta = { type: 'follow', url: null, instruction: null };
const COMMENT: ResolvedCta = { type: 'comment', url: null, instruction: null };

const CONTENT = (text: string, cta = false) => ({ kind: 'content', text, cta });
const HOOK = (text: string, cta = false) => ({ kind: 'hook', text, cta });

describe('resolveEffectiveCta', () => {
  it('an explicit per-video override wins over the persona CTA', () => {
    expect(resolveEffectiveCta({ type: 'comment' }, FOLLOW)).toEqual({
      type: 'comment', url: null, instruction: null,
    });
    expect(
      resolveEffectiveCta({ type: 'link', url: 'https://example.com/x' }, FOLLOW),
    ).toEqual({ type: 'link', url: 'https://example.com/x', instruction: null });
  });

  it('an explicit null disables the CTA for that video', () => {
    expect(resolveEffectiveCta(null, FOLLOW)).toBeNull();
  });

  it('an absent override inherits the persona CTA, including a voiceover null', () => {
    expect(resolveEffectiveCta(undefined, FOLLOW)).toBe(FOLLOW);
    expect(resolveEffectiveCta(undefined, null)).toBeNull();
  });
});

describe('validateCtaTake', () => {
  it('passes when a CTA applies and a content take is marked', () => {
    expect(validateCtaTake(FOLLOW, [HOOK('Hook.'), CONTENT('Follow me.', true)])).toEqual({ ok: true });
  });

  it('passes when several content takes are marked', () => {
    expect(
      validateCtaTake(FOLLOW, [HOOK('Hook.'), CONTENT('Follow me.', true), CONTENT('And share.', true)]),
    ).toEqual({ ok: true });
  });

  it('passes with no CTA and no marker (voiceover, or a null override)', () => {
    expect(validateCtaTake(null, [HOOK('Hook.'), CONTENT('Body.')])).toEqual({ ok: true });
    expect(validateCtaTake(null, undefined)).toEqual({ ok: true });
  });

  it('400s when a CTA applies but no take is marked', () => {
    const check = validateCtaTake(FOLLOW, [HOOK('Hook.'), CONTENT('Body.')]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.field).toBe('options.segments');
      expect(check.message).toContain('cta: true');
    }
    expect(validateCtaTake(FOLLOW, undefined).ok).toBe(false);
  });

  it('400s when the hook is the marked take', () => {
    const check = validateCtaTake(FOLLOW, [HOOK('Hook.', true), CONTENT('Body.')]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.field).toBe('options.segments');
      expect(check.message).toContain('hook cannot be the CTA take');
    }
  });

  it('400s when a comment CTA take has no question mark', () => {
    const check = validateCtaTake(COMMENT, [HOOK('Hook.'), CONTENT('Tell me below.', true)]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.field).toBe('options.segments');
      expect(check.message).toContain('must ask a question');
    }
  });

  it('passes a comment CTA whose marked take ends with a question about this video', () => {
    expect(
      validateCtaTake(COMMENT, [HOOK('Hook.'), CONTENT('What did your first squat feel like?', true)]),
    ).toEqual({ ok: true });
  });

  it('400s when a take is marked but the CTA is disabled', () => {
    const check = validateCtaTake(null, [HOOK('Hook.'), CONTENT('Follow me.', true)]);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.field).toBe('options.segments');
      expect(check.message).toContain('CTA is disabled');
    }
  });
});
