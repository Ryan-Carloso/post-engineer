import { describe, expect, it } from 'vitest';

import {
  resolvePersonaVoice,
  VOICE_FALLBACK_REASONS,
  VOICE_FALLBACK_WARNING_CODE,
} from '@/lib/voice-fallback';

describe('resolvePersonaVoice', () => {
  describe('valid voices pass through untouched', () => {
    it('accepts the no-voice sentinel', () => {
      expect(resolvePersonaVoice('no-voice', 'en-US')).toEqual({ kind: 'valid', voiceId: 'no-voice' });
    });

    it('accepts the legacy none sentinel in any case', () => {
      expect(resolvePersonaVoice('None', 'en-US')).toEqual({ kind: 'valid', voiceId: 'None' });
    });

    it('accepts an ElevenLabs id', () => {
      expect(resolvePersonaVoice('elevenlabs:abc123', 'en-US')).toEqual({
        kind: 'valid',
        voiceId: 'elevenlabs:abc123',
      });
    });

    it('accepts an OpenRouter id whose voice half carries its own colons', () => {
      expect(resolvePersonaVoice('openrouter:microsoft/mai-voice-2.1:en-US-Harper:MAI-Voice-2.1', 'en-US')).toEqual({
        kind: 'valid',
        voiceId: 'openrouter:microsoft/mai-voice-2.1:en-US-Harper:MAI-Voice-2.1',
      });
    });

    it('accepts a house catalog id when the served catalog lists it', () => {
      const catalogIds = new Set(['chatterbox:kokoro_af_heart']);
      expect(resolvePersonaVoice('chatterbox:kokoro_af_heart', 'en-US', { catalogIds })).toEqual({
        kind: 'valid',
        voiceId: 'chatterbox:kokoro_af_heart',
      });
    });

    it('accepts a house catalog id without a served catalog (shape only)', () => {
      expect(resolvePersonaVoice('chatterbox:some_voice', 'en-US')).toEqual({
        kind: 'valid',
        voiceId: 'chatterbox:some_voice',
      });
    });

    it('accepts a ready clone without a served catalog and reports its key', () => {
      expect(resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US')).toEqual({
        kind: 'clone',
        voiceId: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
        key: 'uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('accepts a clone the served catalog lists', () => {
      const catalogIds = new Set(['chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb']);
      expect(resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { catalogIds })).toEqual({
        kind: 'valid',
        voiceId: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('accepts a legacy chatterbox: clone when the catalog serves chatterbox_nano:<same key>', () => {
      const catalogIds = new Set(['chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb']);
      expect(resolvePersonaVoice('chatterbox:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { catalogIds })).toEqual({
        kind: 'valid',
        voiceId: 'chatterbox:uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('accepts a chatterbox_nano: clone when the catalog still lists chatterbox:<same key>', () => {
      const catalogIds = new Set(['chatterbox:uaaaaaaaaaaaa_bbbbbbbbbbbb']);
      expect(resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { catalogIds })).toEqual({
        kind: 'valid',
        voiceId: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('accepts a clone the caller reports as available', () => {
      expect(
        resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { cloneAvailable: true }),
      ).toEqual({
        kind: 'clone',
        voiceId: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
        key: 'uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('accepts a valid voice for any English spelling of the language', () => {
      for (const language of ['en', 'en-US', 'en-GB', 'English', 'inglês', 'ingles', null, '']) {
        expect(resolvePersonaVoice('elevenlabs:abc123', language)).toEqual({
          kind: 'valid',
          voiceId: 'elevenlabs:abc123',
        });
      }
    });
  });

  describe('invalid voices fall back instead of failing', () => {
    it('swaps a bare display name for the language default', () => {
      expect(resolvePersonaVoice('energetic', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'energetic',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('swaps a removed-provider Edge id for the language default', () => {
      expect(resolvePersonaVoice('en-US-GuyNeural', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'en-US-GuyNeural',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('keeps the gender a -Female suffix spells out', () => {
      expect(resolvePersonaVoice('en-US-GuyNeural-Female', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'en-US-GuyNeural-Female',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('swaps a male-suffixed voice for the male default', () => {
      expect(resolvePersonaVoice('default-Male', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'default-Male',
        toVoice: 'chatterbox:kokoro_am_michael',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('reads gender from a Modal underscore id (en_us_female_01 / en_us_male_01)', () => {
      const emptyCatalog = new Set<string>();
      expect(resolvePersonaVoice('chatterbox:en_us_female_01', 'en-US', { catalogIds: emptyCatalog })).toEqual({
        kind: 'fallback',
        fromVoice: 'chatterbox:en_us_female_01',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.RETIRED_HOUSE_VOICE,
      });
      expect(resolvePersonaVoice('chatterbox:en_us_male_01', 'en-US', { catalogIds: emptyCatalog })).toEqual({
        kind: 'fallback',
        fromVoice: 'chatterbox:en_us_male_01',
        toVoice: 'chatterbox:kokoro_am_michael',
        reason: VOICE_FALLBACK_REASONS.RETIRED_HOUSE_VOICE,
      });
    });

    it('reads gender from the underscore-to-space display form (en us female 01)', () => {
      expect(resolvePersonaVoice('en us female 01', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'en us female 01',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
      expect(resolvePersonaVoice('en us male 01', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'en us male 01',
        toVoice: 'chatterbox:kokoro_am_michael',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('swaps an empty stored voice for the language default', () => {
      expect(resolvePersonaVoice(null, 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: '',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.VOICE_MISSING,
      });
      expect(resolvePersonaVoice('   ', 'en-US').kind).toBe('fallback');
    });

    it('swaps a bare legacy Modal name for its exact alias target', () => {
      expect(resolvePersonaVoice('en_us_female_02', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'en_us_female_02',
        toVoice: 'chatterbox:kokoro_af_bella',
        reason: VOICE_FALLBACK_REASONS.LEGACY_VOICE_ALIAS,
      });
    });

    it('never gives a non-English persona the English legacy alias target (review MAJOR: the alias path respects the language)', () => {
      // The legacy alias targets are ALL English house voices; a Portuguese
      // persona with `en_us_female_02` stored must resolve unavailable (fail
      // before any spend), not silently speak English through the alias.
      expect(resolvePersonaVoice('en_us_female_02', 'pt')).toEqual({ kind: 'unavailable' });
      expect(resolvePersonaVoice('en_us_male_01', 'pt-BR')).toEqual({ kind: 'unavailable' });
    });

    it('still resolves the alias target for an English-language persona whose language is unset', () => {
      // A missing/unknown language leans English (the pipeline's hard gate):
      // the alias keeps resolving.
      expect(resolvePersonaVoice('en_us_female_02', null)).toMatchObject({ kind: 'fallback', toVoice: 'chatterbox:kokoro_af_bella' });
    });

    it('swaps a retired house voice when the served catalog no longer lists it', () => {
      const catalogIds = new Set(['chatterbox:kokoro_af_heart']);
      expect(resolvePersonaVoice('chatterbox:retired_voice', 'en-US', { catalogIds })).toEqual({
        kind: 'fallback',
        fromVoice: 'chatterbox:retired_voice',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.RETIRED_HOUSE_VOICE,
      });
    });

    it('swaps an unavailable clone when the served catalog lists other clones but not this key', () => {
      const catalogIds = new Set([
        'chatterbox:kokoro_af_heart',
        'chatterbox_nano:ucccccccccccc_dddddddddddd',
      ]);
      expect(resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { catalogIds })).toEqual({
        kind: 'fallback',
        fromVoice: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.CLONE_UNAVAILABLE,
      });
    });

    it('does not treat a clone as unavailable when the catalog merge omitted every clone row', () => {
      const catalogIds = new Set(['chatterbox:kokoro_af_heart']);
      expect(resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { catalogIds })).toEqual({
        kind: 'clone',
        voiceId: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
        key: 'uaaaaaaaaaaaa_bbbbbbbbbbbb',
      });
    });

    it('swaps an unavailable clone when the caller reports it missing', () => {
      expect(
        resolvePersonaVoice('chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb', 'en-US', { cloneAvailable: false }),
      ).toEqual({
        kind: 'fallback',
        fromVoice: 'chatterbox_nano:uaaaaaaaaaaaa_bbbbbbbbbbbb',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.CLONE_UNAVAILABLE,
      });
    });
  });

  describe('no valid voice for the language fails before any spend', () => {
    it('reports unavailable instead of falling back for a non-English persona', () => {
      expect(resolvePersonaVoice('energetic', 'pt-BR')).toEqual({ kind: 'unavailable' });
      expect(resolvePersonaVoice('energetic', 'Portuguese')).toEqual({ kind: 'unavailable' });
    });
  });

  describe('unreachable branches (mutation/codecov hardening)', () => {
    it('swaps an elevenlabs id with an empty voice half', () => {
      expect(resolvePersonaVoice('elevenlabs:', 'en-US')).toEqual({
        kind: 'fallback',
        fromVoice: 'elevenlabs:',
        toVoice: 'chatterbox:kokoro_af_heart',
        reason: VOICE_FALLBACK_REASONS.UNKNOWN_VOICE,
      });
    });

    it('swaps an openrouter id with an empty voice half', () => {
      expect(resolvePersonaVoice('openrouter:model:', 'en-US')?.kind).toBe('fallback');
      expect(resolvePersonaVoice('openrouter:model', 'en-US')?.kind).toBe('fallback');
    });

    it('swaps a chatterbox prefix with an empty voice name', () => {
      expect(resolvePersonaVoice('chatterbox:', 'en-US')?.kind).toBe('fallback');
    });

    it('swaps a bare non-legendary name with a Male hint for the male default and non-English becomes unavailable', () => {
      expect(resolvePersonaVoice('voice-Male', 'en-US')).toMatchObject({
        kind: 'fallback',
        toVoice: 'chatterbox:kokoro_am_michael',
      });
      expect(resolvePersonaVoice('voice-Female', 'pt')).toEqual({ kind: 'unavailable' });
    });
  });

  it('exports the stable warning code the UI mapper and API share', () => {
    expect(VOICE_FALLBACK_WARNING_CODE).toBe('voice_fallback_applied');
  });
});
