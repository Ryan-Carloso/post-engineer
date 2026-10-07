import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJobPayload, hasNonEmptyString, type JobPersona } from '../video-job-payload';
import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const warn = vi.mocked(logger.warn);

function persona(overrides: Partial<JobPersona> = {}): JobPersona {
  return {
    name: 'Viva Leve',
    photo_url: 'https://cdn.test/photo.png',
    voice_id: 'voice-1',
    voice_audio_url: 'https://cdn.test/voice.mp3',
    ...overrides,
  };
}

describe('hasNonEmptyString', () => {
  it('accepts strings with non-whitespace content', () => {
    expect(hasNonEmptyString('hello')).toBe(true);
    expect(hasNonEmptyString('  padded  ')).toBe(true);
  });

  it('rejects empty, blank and non-string values', () => {
    expect(hasNonEmptyString('')).toBe(false);
    expect(hasNonEmptyString('   ')).toBe(false);
    expect(hasNonEmptyString(null)).toBe(false);
    expect(hasNonEmptyString(undefined)).toBe(false);
    expect(hasNonEmptyString(42)).toBe(false);
    expect(hasNonEmptyString(true)).toBe(false);
    expect(hasNonEmptyString({})).toBe(false);
    expect(hasNonEmptyString([])).toBe(false);
  });
});

describe('buildJobPayload — request allowlist', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  it('forwards only known engine fields and drops personaId/lipsync/junk', () => {
    const payload = buildJobPayload(persona(), {
      video_subject: 'myth busting',
      personaId: 'persona-1',
      lipsync: true,
      junk_field: 'junk',
    });
    expect(payload.video_subject).toBe('myth busting');
    expect(payload).not.toHaveProperty('personaId');
    expect(payload).not.toHaveProperty('lipsync');
    expect(payload).not.toHaveProperty('junk_field');
  });

  it('warns once with the dropped key names, capped at ten', () => {
    buildJobPayload(persona(), { a: 1, b: 2, c: 3 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('dropping 3 unknown request field(s)');
    expect(warn.mock.calls[0][0]).toContain('"a"');
  });

  it('does not warn when every key is known', () => {
    buildJobPayload(persona(), { video_subject: 'x' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('caps the dropped-keys warning at ten and counts the remainder', () => {
    const request = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`junk${i}`, i]));
    buildJobPayload(persona(), request);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('dropping 12 unknown request field(s)');
    expect(message).toContain('(+2 more)');
    expect(message).toContain('"junk9"');
    expect(message).not.toContain('"junk10"');
  });

  it('embeds only the engine-facing persona identity, never the raw persona', () => {
    const payload = buildJobPayload(
      persona({ language: 'pt', niche: 'finance', face_quality: 'very_good' }),
      {},
    );
    expect(payload.persona).toEqual({
      name: 'Viva Leve',
      photo_url: 'https://cdn.test/photo.png',
      voice_id: 'voice-1',
      voice_audio_url: 'https://cdn.test/voice.mp3',
    });
  });
});

describe('buildJobPayload — persona preference defaults', () => {
  it('applies persona preferences when the request omits them', () => {
    const payload = buildJobPayload(
      persona({ language: 'pt', video_aspect: '9:16', script_prompt: 'be punchy', paragraph_number: 4 }),
      {},
    );
    expect(payload.video_language).toBe('pt');
    expect(payload.video_aspect).toBe('9:16');
    expect(payload.video_script_prompt).toBe('be punchy');
    expect(payload.paragraph_number).toBe(4);
  });

  it('lets an explicit request value win over the persona', () => {
    const payload = buildJobPayload(persona({ language: 'pt', paragraph_number: 4 }), {
      video_language: 'en',
      paragraph_number: 0,
    });
    expect(payload.video_language).toBe('en');
    // 0 is an explicit non-string value, not an absent marker.
    expect(payload.paragraph_number).toBe(0);
  });

  it('treats null and empty-string request values as absent', () => {
    const payload = buildJobPayload(persona({ language: 'pt' }), {
      video_language: null,
      video_aspect: '   ',
    });
    expect(payload.video_language).toBe('pt');
    expect(payload).not.toHaveProperty('video_aspect');
  });

  it('never forwards null or empty persona preferences verbatim', () => {
    const payload = buildJobPayload(
      persona({ language: null, video_aspect: '', script_prompt: undefined }),
      { video_language: null },
    );
    expect(payload).not.toHaveProperty('video_language');
    expect(payload).not.toHaveProperty('video_aspect');
    expect(payload).not.toHaveProperty('video_script_prompt');
  });
});

describe('buildJobPayload — face quality and lipsync', () => {
  it('maps very_good face quality to the engine kebab-case when the face shows', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), { lipsync: true });
    expect(payload.video_quality).toBe('very-good');
  });

  it('defaults other face qualities to ok when the face shows', () => {
    const payload = buildJobPayload(persona({ face_quality: 'good' }), {});
    expect(payload.video_quality).toBe('ok');
  });

  it('keeps an explicit request video_quality over the persona default', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), {
      video_quality: 'ultra',
    });
    expect(payload.video_quality).toBe('ultra');
  });

  it('does not invent video_quality from the persona for faceless videos', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), { lipsync: false });
    expect(payload).not.toHaveProperty('video_quality');
    expect(payload.lipsync_enabled).toBe(false);
  });

  it('leaves an explicit request video_quality alone on faceless videos', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), {
      lipsync: false,
      video_quality: 'ok',
    });
    expect(payload.video_quality).toBe('ok');
  });

  it('sets lipsync_enabled only from an explicit boolean request flag', () => {
    expect(buildJobPayload(persona(), { lipsync: true }).lipsync_enabled).toBe(true);
    expect(buildJobPayload(persona(), {})).not.toHaveProperty('lipsync_enabled');
    expect(buildJobPayload(persona(), { lipsync: 'yes' })).not.toHaveProperty('lipsync_enabled');
  });
});

describe('buildJobPayload — niche and subject defaults', () => {
  it('derives the script prompt and subject from the niche when missing', () => {
    const payload = buildJobPayload(persona({ niche: '  finance  ' }), {});
    expect(payload.video_script_prompt).toBe('The content niche is: finance.');
    expect(payload.video_subject).toBe('finance');
  });

  it('does not overwrite an existing script prompt or subject with the niche', () => {
    const payload = buildJobPayload(persona({ niche: 'finance' }), {
      video_script_prompt: 'custom script',
      video_subject: 'custom subject',
    });
    expect(payload.video_script_prompt).toBe('custom script');
    expect(payload.video_subject).toBe('custom subject');
  });

  it('ignores a blank niche for the defaults', () => {
    const payload = buildJobPayload(persona({ niche: '   ' }), {});
    expect(payload).not.toHaveProperty('video_script_prompt');
    expect(payload).not.toHaveProperty('video_subject');
  });
});

describe('buildJobPayload — final null pass', () => {
  it('drops null engine-facing fields instead of forwarding them', () => {
    // lipsync: false keeps the face-quality defaulting out of the picture,
    // so the null pass is what removes video_quality.
    const payload = buildJobPayload(persona({ niche: 'finance' }), {
      lipsync: false,
      video_subject: null,
      video_quality: null,
      webhook_url: 'https://hooks.test/done',
    });
    // video_subject is re-defaulted from the niche; the null never travels.
    expect(payload.video_subject).toBe('finance');
    expect(payload).not.toHaveProperty('video_quality');
    expect(payload.webhook_url).toBe('https://hooks.test/done');
  });

  it('treats an empty-string video_quality as absent and applies the persona default', () => {
    const payload = buildJobPayload(persona(), { video_quality: '   ' });
    expect(payload.video_quality).toBe('ok');
  });

  it('treats a null video_quality as absent and applies the persona default', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), {
      video_quality: null,
    });
    expect(payload.video_quality).toBe('very-good');
  });

  it('deletes an empty-string video_quality on faceless videos instead of defaulting it', () => {
    const payload = buildJobPayload(persona(), { lipsync: false, video_quality: '   ' });
    expect(payload).not.toHaveProperty('video_quality');
  });
});
