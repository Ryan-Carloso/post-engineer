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

  it('forwards only known engine fields and drops personaId/junk', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'myth busting',
      personaId: 'persona-1',
      junk_field: 'junk',
    });
    expect(payload.video_title).toBe('myth busting');
    expect(payload).not.toHaveProperty('personaId');
    expect(payload).not.toHaveProperty('junk_field');
  });

  it('drops the dead contract fields instead of forwarding them', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'Porto trip',
      video_subject: 'Porto trip',
      lipsync: false,
      full_lipsync: true,
      voiceover_material: 'images',
      lipsync_enabled: false,
    });
    expect(payload).not.toHaveProperty('video_subject');
    expect(payload).not.toHaveProperty('lipsync');
    expect(payload).not.toHaveProperty('full_lipsync');
    expect(payload).not.toHaveProperty('voiceover_material');
    expect(payload).not.toHaveProperty('lipsync_enabled');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('dropping 5 unknown request field(s)');
  });

  it('forwards video_script so a segments request takes the supplied-script engine path', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'Porto trip',
      video_script: 'Hook.\n\nBody.\n\nCTA.',
    });
    expect(payload.video_script).toBe('Hook.\n\nBody.\n\nCTA.');
  });

  it('forwards slot_id so boot orphan triage can requeue web-created tasks', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'myth busting',
      generation_id: 'gen-1',
      slot_id: 'slot-123',
    });
    expect(payload.slot_id).toBe('slot-123');
    expect(payload.generation_id).toBe('gen-1');
  });

  it('forwards video_type so a full-mode request is not dropped into intro-only images', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'myth busting',
      video_type: 'full_lipsync',
    });
    expect(payload.video_type).toBe('full_lipsync');
  });

  it('forwards video_type for every mode', () => {
    for (const videoType of ['full_lipsync', 'hook_lipsync', 'voiceover'] as const) {
      const payload = buildJobPayload(persona(), { video_title: 'Porto trip', video_type: videoType });
      expect(payload.video_type).toBe(videoType);
    }
  });

  it('forwards music_mood so a requested BGM mood is not lost to the engine default', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'myth busting',
      music_mood: 'calm',
    });
    expect(payload.music_mood).toBe('calm');
  });

  it('forwards the pacing knobs so a requested hold, transition and seed reach the engine', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'myth busting',
      video_clip_duration: 4,
      video_transition_mode: 'Crossfade',
      video_variation_seed: 7,
    });
    expect(payload.video_clip_duration).toBe(4);
    expect(payload.video_transition_mode).toBe('Crossfade');
    expect(payload.video_variation_seed).toBe(7);
  });

  it('forwards video_title and video_description so publish uses the agent copy', () => {
    const payload = buildJobPayload(persona(), {
      video_title: 'Porto in 30 seconds',
      video_description: 'Watch to the end.',
    });
    expect(payload.video_title).toBe('Porto in 30 seconds');
    expect(payload.video_description).toBe('Watch to the end.');
  });

  it('forwards segments next to the joined script so the engine can render per-segment media', () => {
    const segments = [
      { kind: 'hook', text: 'Welcome to Porto.', media: [{ mediaId: 'aabbccddeeff00112233445566778899.png' }] },
      { kind: 'content', text: 'Where the river meets the sea.' },
      { kind: 'content', text: 'Visit Porto soon.' },
    ];
    const payload = buildJobPayload(persona(), {
      video_title: 'Porto trip',
      video_script: 'Welcome to Porto.\n\nWhere the river meets the sea.\n\nVisit Porto soon.',
      segments,
    });
    expect(payload.segments).toEqual(segments);
  });

  it('forwards lipsync_photos so a full lip-sync window renders its own face photo', () => {
    const photos = [{ url: 'https://e.com/face-0.jpg' }, { mediaId: 'aabbccddeeff00112233445566778899.png' }];
    const payload = buildJobPayload(persona(), {
      video_title: 'Porto trip',
      video_type: 'full_lipsync',
      lipsync_photos: photos,
    });
    expect(payload.lipsync_photos).toEqual(photos);
  });

  it('omits lipsync_photos when the request has none', () => {
    const payload = buildJobPayload(persona(), { video_title: 'Porto trip', video_type: 'hook_lipsync', lipsync_photos: undefined });
    expect(payload.lipsync_photos).toBeUndefined();
  });

  it('warns once with the dropped key names, capped at ten', () => {
    buildJobPayload(persona(), { a: 1, b: 2, c: 3 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('dropping 3 unknown request field(s)');
    expect(warn.mock.calls[0][0]).toContain('"a"');
  });

  it('does not warn when every key is known', () => {
    buildJobPayload(persona(), { video_title: 'x' });
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
      niche: 'finance',
    });
  });

  it('omits the persona niche when the persona has none', () => {
    const payload = buildJobPayload(persona({ niche: null }), {});
    expect(payload.persona).not.toHaveProperty('niche');
  });
});

describe('buildJobPayload — persona preference defaults', () => {
  it('applies persona preferences when the request omits them', () => {
    const payload = buildJobPayload(
      persona({ language: 'pt', video_aspect: '9:16', paragraph_number: 4 }),
      {},
    );
    expect(payload.video_language).toBe('pt');
    expect(payload.video_aspect).toBe('9:16');
    expect(payload.paragraph_number).toBe(4);
  });

  it('never maps a persona script prompt onto the engine payload', () => {
    const payload = buildJobPayload(
      persona({ script_prompt: 'be punchy' } as Partial<JobPersona>),
      {},
    );
    expect(payload).not.toHaveProperty('video_script_prompt');
  });

  it('lets an explicit request value win over the persona', () => {
    const payload = buildJobPayload(persona({ language: 'pt', paragraph_number: 4 }), {
      video_language: 'en',
      paragraph_number: 0,
    });
    expect(payload.video_language).toBe('en');
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

  it('forwards the resolved CTA type as a request field, and omits it when there is none', () => {
    expect(buildJobPayload(persona({}), { cta_type: 'comment' }).cta_type).toBe('comment');
    expect(buildJobPayload(persona({}), { cta_type: null })).not.toHaveProperty('cta_type');
    expect(buildJobPayload(persona({}), {})).not.toHaveProperty('cta_type');
    expect(buildJobPayload(persona({}), {})).not.toHaveProperty('video_cta');
  });

  it('forwards the persona hook_panel default, including false', () => {
    expect(buildJobPayload(persona({ hook_panel: false }), {}).hook_panel).toBe(false);
    expect(buildJobPayload(persona({ hook_panel: true }), {}).hook_panel).toBe(true);
    expect(buildJobPayload(persona({}), {})).not.toHaveProperty('hook_panel');
  });

  it('lets a request hook_panel win over the persona default', () => {
    expect(buildJobPayload(persona({ hook_panel: true }), { hook_panel: false }).hook_panel).toBe(false);
  });

  it('never forwards null or empty persona preferences verbatim', () => {
    const payload = buildJobPayload(
      persona({ language: null, video_aspect: '' }),
      { video_language: null },
    );
    expect(payload).not.toHaveProperty('video_language');
    expect(payload).not.toHaveProperty('video_aspect');
    expect(payload).not.toHaveProperty('video_script_prompt');
  });
});

describe('buildJobPayload — face quality and video_type', () => {
  it('maps very_good face quality to the engine kebab-case when the face shows', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), { video_type: 'hook_lipsync' });
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

  it('does not invent video_quality from the persona for voiceover videos', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), { video_type: 'voiceover' });
    expect(payload).not.toHaveProperty('video_quality');
  });

  it('leaves an explicit request video_quality alone on voiceover videos', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), {
      video_type: 'voiceover',
      video_quality: 'ok',
    });
    expect(payload.video_quality).toBe('ok');
  });

  it('shows the face for full lip sync too', () => {
    const payload = buildJobPayload(persona({ face_quality: 'very_good' }), { video_type: 'full_lipsync' });
    expect(payload.video_quality).toBe('very-good');
  });
});

describe('buildJobPayload — niche and script prompt', () => {
  it('drops a stale request script prompt', () => {
    const payload = buildJobPayload(persona({ niche: 'finance' }), {
      video_script_prompt: 'custom script',
      video_title: 'custom title',
    });
    expect(payload).not.toHaveProperty('video_script_prompt');
    expect(payload.video_title).toBe('custom title');
  });

  it('ignores a blank niche in the engine persona', () => {
    const payload = buildJobPayload(persona({ niche: '   ' }), {});
    expect(payload).not.toHaveProperty('video_script_prompt');
    expect(payload.persona).not.toHaveProperty('niche');
  });
});

describe('buildJobPayload — final null pass', () => {
  it('drops null engine-facing fields instead of forwarding them', () => {
    const payload = buildJobPayload(persona({ niche: 'finance' }), {
      video_type: 'voiceover',
      video_quality: null,
      webhook_url: 'https://hooks.test/done',
    });
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

  it('deletes an empty-string video_quality on voiceover videos instead of defaulting it', () => {
    const payload = buildJobPayload(persona(), { video_type: 'voiceover', video_quality: '   ' });
    expect(payload).not.toHaveProperty('video_quality');
  });
});
