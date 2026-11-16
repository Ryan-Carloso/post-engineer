// Voices tool schemas vs the shared voices contract: the preview text
// field must accept and reject exactly what the route's body parser
// accepts and rejects, and the list gender filter must offer exactly the
// genders the catalog serves. Deliberate differences are pinned below so
// a future edit does not silently change a tool's contract.
import { describe, expect, it } from 'vitest';

import { CreateClonedVoiceBodySchema, PREVIEW_TEXT_MAX_CHARS, PreviewVoiceBodySchema, VOICE_GENDERS } from '../contracts/voices.js';
import {
  CreateClonedVoiceSchema,
  PreviewClonedVoiceSchema,
  PreviewHouseVoiceSchema,
} from '../cloned-voice-tools.js';
import { ListVoicesSchema } from '../voice-filters.js';

const textCases: Array<{ text: string | undefined; ok: boolean }> = [
  { text: undefined, ok: true },
  { text: 'Hi', ok: true },
  { text: '  padded  ', ok: true },
  { text: 'x'.repeat(300), ok: true },
  { text: '', ok: false },
  { text: '   ', ok: false },
  { text: 'x'.repeat(301), ok: false },
];

describe('preview text: tool schema vs contract body', () => {
  it('accepts and rejects the same text on the house preview', () => {
    for (const { text, ok } of textCases) {
      const tool = PreviewHouseVoiceSchema.safeParse(
        text === undefined ? { voiceId: 'chatterbox:phonon_zoey' } : { voiceId: 'chatterbox:phonon_zoey', text },
      );
      expect(tool.success).toBe(ok);
      const contract = PreviewVoiceBodySchema.safeParse(text === undefined ? {} : { text });
      expect(contract.success).toBe(ok);
    }
  });

  it('accepts and rejects the same text on the cloned preview', () => {
    for (const { text, ok } of textCases) {
      const tool = PreviewClonedVoiceSchema.safeParse(
        text === undefined ? { cloneId: 'clone-1' } : { cloneId: 'clone-1', text },
      );
      expect(tool.success).toBe(ok);
      const contract = PreviewVoiceBodySchema.safeParse(text === undefined ? {} : { text });
      expect(contract.success).toBe(ok);
    }
  });

  it('pins the 300-char cap to the contract constant', () => {
    expect(PREVIEW_TEXT_MAX_CHARS).toBe(300);
  });
});

describe('create clone: tool shape vs contract body (deliberate differences)', () => {
  it('sends booleans where the form body takes string literals', () => {
    // The tool takes consent/denoise as booleans; the client converts them
    // to the 'true'/'false' form fields the route reads. The contract
    // mirrors the form body, so it rejects the tool's booleans.
    const tool = CreateClonedVoiceSchema.safeParse({
      audioUrl: 'https://cdn.example.com/ref.wav',
      language: 'en',
      consent: true,
      denoise: false,
    });
    expect(tool.success).toBe(true);
    expect(CreateClonedVoiceBodySchema.safeParse({ consent: 'true', denoise: 'false', language: 'en' }).success).toBe(true);
    expect(CreateClonedVoiceBodySchema.safeParse({ consent: true, denoise: false, language: 'en' }).success).toBe(false);
    expect(CreateClonedVoiceBodySchema.safeParse({ consent: 'true', denoise: true, language: 'en' }).success).toBe(false);
  });

  it('enforces English in the tool where the contract only requires a language', () => {
    // The route enforces English-only clones; the contract mirrors the
    // route's body shape (language is any non-empty string) while the tool
    // rejects a non-English language before the request is sent.
    expect(CreateClonedVoiceBodySchema.safeParse({ consent: 'true', denoise: 'false', language: 'pt' }).success).toBe(true);
    const tool = CreateClonedVoiceSchema.safeParse({
      audioUrl: 'https://cdn.example.com/ref.wav',
      language: 'pt',
      consent: true,
      denoise: false,
    });
    expect(tool.success).toBe(false);
  });
});

describe('list voices: gender filter vs contract enums', () => {
  it('offers exactly the genders the catalog serves', () => {
    expect(VOICE_GENDERS).toEqual(['female', 'male']);
    for (const gender of VOICE_GENDERS) {
      expect(ListVoicesSchema.safeParse({ gender }).success).toBe(true);
    }
    expect(ListVoicesSchema.safeParse({ gender: 'other' }).success).toBe(false);
  });

  it('keeps the character origin as a tool-only filter value', () => {
    // 'character' is not a VOICE_ACCENTS member: the origin filter maps it
    // to kind === 'character', not to an accent. The contract's accents
    // stay us/gb only.
    expect(ListVoicesSchema.safeParse({ origin: 'character' }).success).toBe(true);
    expect(ListVoicesSchema.safeParse({ origin: 'au' }).success).toBe(false);
  });
});
