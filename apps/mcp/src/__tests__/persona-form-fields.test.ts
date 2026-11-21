import { describe, it, expect } from 'vitest';

import { appendCreatePersonaFields, appendUpdatePersonaFields } from '../persona-form-fields.js';
import { CreatePersonaSchema } from '../persona-create.js';
import { UpdatePersonaSchema } from '../persona-update.js';
import { GeneratePersonaVideoOptionsShape } from '../schedule-shapes.js';
import { z } from 'zod';

describe('persona form fields hookPanel', () => {
  it('creates a persona with hookPanel true unless the agent turns it off', () => {
    const on = new FormData();
    appendCreatePersonaFields(on, { name: 'Ana', voiceId: 'kokoro:af_heart', accounts: {} });
    expect(on.get('hookPanel')).toBe('true');
    const off = new FormData();
    appendCreatePersonaFields(off, { name: 'Ana', voiceId: 'kokoro:af_heart', accounts: {}, hookPanel: false });
    expect(off.get('hookPanel')).toBe('false');
  });

  it('sends hookPanel on update only when the agent sets it', () => {
    const untouched = new FormData();
    appendUpdatePersonaFields(untouched, { personaId: 'p-1', niche: 'travel' });
    expect(untouched.has('hookPanel')).toBe(false);
    const off = new FormData();
    appendUpdatePersonaFields(off, { personaId: 'p-1', hookPanel: false });
    expect(off.get('hookPanel')).toBe('false');
  });

  it('creates with the documented defaults and sends every explicit value instead', () => {
    const defaults = new FormData();
    appendCreatePersonaFields(defaults, { name: 'Ana', voiceId: 'kokoro:af_heart', accounts: {} });
    expect(Object.fromEntries(defaults.entries())).toEqual({
      name: 'Ana',
      voiceId: 'kokoro:af_heart',
      language: 'en-US',
      videoAspect: '9:16',
      videoLayout: 'standard',
      hookPanel: 'true',
      paragraphNumber: '1',
      niche: 'General',
      faceQuality: 'very_good',
    });
    const explicit = new FormData();
    appendCreatePersonaFields(explicit, {
      name: 'Ana',
      voiceId: 'kokoro:af_heart',
      accounts: {},
      language: 'en-GB',
      videoAspect: '1:1',
      videoLayout: 'react',
      hookPanel: true,
      scriptPrompt: 'Short.',
      paragraphNumber: 3,
      niche: 'travel',
      faceQuality: 'ok',
    });
    expect(Object.fromEntries(explicit.entries())).toMatchObject({
      language: 'en-GB',
      videoAspect: '1:1',
      videoLayout: 'react',
      hookPanel: 'true',
      scriptPrompt: 'Short.',
      paragraphNumber: '3',
      niche: 'travel',
      faceQuality: 'ok',
    });
  });

  it('updates only the fields the agent sets, every one of them', () => {
    const all = new FormData();
    appendUpdatePersonaFields(all, {
      personaId: 'p-1',
      voiceId: 'kokoro:af_heart',
      language: 'en-GB',
      videoAspect: '16:9',
      videoLayout: 'react',
      hookPanel: true,
      scriptPrompt: 'Short.',
      paragraphNumber: 2,
      niche: 'travel',
      faceQuality: 'very_good',
    });
    expect(Object.fromEntries(all.entries())).toMatchObject({
      voiceId: 'kokoro:af_heart',
      language: 'en-GB',
      videoAspect: '16:9',
      videoLayout: 'react',
      hookPanel: 'true',
      scriptPrompt: 'Short.',
      paragraphNumber: '2',
      niche: 'travel',
      faceQuality: 'very_good',
    });
    const none = new FormData();
    appendUpdatePersonaFields(none, { personaId: 'p-1' });
    expect([...none.keys()]).toEqual([]);
  });

  it('defaults hookPanel to true on create and keeps it optional on update', () => {
    const created = CreatePersonaSchema.safeParse({
      name: 'Ana',
      avatarUrl: 'https://example.com/a.png',
      voiceId: 'kokoro:af_heart',
      accounts: { youtube: ['yt-1'] },
    });
    expect(created.success && created.data.hookPanel).toBe(true);
    const updated = UpdatePersonaSchema.safeParse({ personaId: 'p-1', hookPanel: false });
    expect(updated.success && updated.data.hookPanel).toBe(false);
  });

  it('accepts a per-video hookPanel boolean and rejects other values', () => {
    const options = z.object(GeneratePersonaVideoOptionsShape);
    expect(options.safeParse({ videoType: 'hook_lipsync', hookPanel: false }).success).toBe(true);
    expect(options.safeParse({ videoType: 'hook_lipsync', hookPanel: 'off' }).success).toBe(false);
  });
});
