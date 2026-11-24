import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeneratePersonaVideoOptionsShape } from '../schedule-shapes.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';

describe('generate_persona_video options (Phase 5-4)', () => {
  it('no longer advertises scriptPrompt or scriptPrompts as generation inputs', () => {
    expect(GeneratePersonaVideoOptionsShape).not.toHaveProperty('scriptPrompt');
    expect(GeneratePersonaVideoOptionsShape).not.toHaveProperty('scriptPrompts');
  });

  it('drops a stale scriptPrompt from parsed options instead of forwarding it', () => {
    const parsed = GeneratePersonaVideoSchema.safeParse({
      title: 'Porto trip',
      description: 'Agent description.',
      providers: ['youtube'],
      mode: 'asap',
      segments: [{ kind: 'hook', text: 'Stop scrolling, this Porto kitchen changes everything.' }],
      options: { scriptPrompt: 'Be funny', videoType: 'faceless' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options).not.toHaveProperty('scriptPrompt');
      expect(parsed.data.options?.videoType).toBe('faceless');
    }
  });

  it('drops stale scriptPrompts from parsed options instead of forwarding them', () => {
    const parsed = GeneratePersonaVideoSchema.safeParse({
      title: 'Porto trip',
      description: 'Agent description.',
      providers: ['youtube'],
      mode: 'asap',
      segments: [{ kind: 'hook', text: 'Stop scrolling, this Porto kitchen changes everything.' }],
      options: { scriptPrompts: ['Be funny'], videoType: 'hook_lipsync' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options).not.toHaveProperty('scriptPrompts');
    }
  });

  it('accepts a square 1:1 videoAspect: it is a product aspect, not just an engine one', () => {
    const parsed = GeneratePersonaVideoSchema.safeParse({
      title: 'Porto trip',
      description: 'Agent description.',
      providers: ['youtube'],
      mode: 'asap',
      segments: [{ kind: 'hook', text: 'Stop scrolling, this Porto kitchen changes everything.' }],
      options: { videoType: 'faceless', videoAspect: '1:1' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options?.videoAspect).toBe('1:1');
    }
  });
});

describe('pacing options (per-photo duration, crossfade, per-video variation)', () => {
  it('accepts videoClipDuration, videoTransitionMode and videoVariationSeed', () => {
    const parsed = parseOptions({ videoClipDuration: 4, videoTransitionMode: 'Crossfade', videoVariationSeed: 7 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options?.videoClipDuration).toBe(4);
      expect(parsed.data.options?.videoTransitionMode).toBe('Crossfade');
      expect(parsed.data.options?.videoVariationSeed).toBe(7);
    }
  });

  it('rejects a videoClipDuration outside 1-60', () => {
    for (const videoClipDuration of [0, 61]) {
      expect(parseOptions({ videoClipDuration }).success).toBe(false);
    }
  });

  it('rejects an unknown videoTransitionMode', () => {
    const parsed = parseOptions({ videoTransitionMode: 'Dissolve' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('videoTransitionMode');
    }
  });

  it('rejects a non-integer videoVariationSeed', () => {
    expect(parseOptions({ videoVariationSeed: 1.5 }).success).toBe(false);
  });
});

describe('subtitle position options', () => {
  it('accepts top, center, bottom and custom', () => {
    for (const subtitlePosition of ['top', 'center', 'bottom', 'custom']) {
      const parsed = parseOptions({ subtitlePosition, subtitleCustomPosition: subtitlePosition === 'custom' ? 20 : undefined });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.options?.subtitlePosition).toBe(subtitlePosition);
      }
    }
  });

  it('accepts a custom height of 0-100 with custom', () => {
    for (const subtitleCustomPosition of [0, 20, 100]) {
      const parsed = parseOptions({ subtitlePosition: 'custom', subtitleCustomPosition });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.options?.subtitleCustomPosition).toBe(subtitleCustomPosition);
      }
    }
  });

  it('rejects a custom height outside 0-100', () => {
    for (const subtitleCustomPosition of [-1, 101, 12.5]) {
      expect(parseOptions({ subtitlePosition: 'custom', subtitleCustomPosition }).success).toBe(false);
    }
  });

  it('rejects an unknown subtitle position', () => {
    const parsed = parseOptions({ subtitlePosition: 'side' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('subtitlePosition');
    }
  });

  it('rejects a custom height without a custom subtitle position', () => {
    for (const subtitlePosition of [undefined, 'top', 'center', 'bottom']) {
      const parsed = parseOptions({ subtitlePosition, subtitleCustomPosition: 20 });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(JSON.stringify(parsed.error.issues)).toContain('subtitleCustomPosition');
      }
    }
  });

  it('teaches the agent the top placement and the one-knob A/B rule', () => {
    const shape = GeneratePersonaVideoOptionsShape.subtitlePosition;
    expect(shape.description).toContain('top keeps the caption near the top of the frame, clear of the face');
    expect(shape.description).toContain('change one knob at a time');
  });
});

const VIDEO = {
  title: 'Porto trip',
  description: 'Agent description.',
  providers: ['youtube'],
  mode: 'asap' as const,
  segments: [{ kind: 'hook' as const, text: 'Stop scrolling, this Porto kitchen changes everything.' }],
};

function parseOptions(options: Record<string, unknown>) {
  return GeneratePersonaVideoSchema.safeParse({
    ...VIDEO,
    options: { videoType: 'faceless', ...options },
  });
}

describe('webhookUrl rejects loopback and private literals', () => {
  it.each([
    'http://127.0.0.1/hook',
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://169.254.169.254/latest',
    'https://[::1]/hook',
    'http://localhost/hook',
    'https://localhost/hook',
    'https://192.168.1.1/hook',
  ])('rejects %s', (webhookUrl) => {
    const parsed = parseOptions({ webhookUrl });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('webhookUrl');
    }
  });

  it.each(['not a url', 'https://', '://missing-scheme'])('reports %s as an issue instead of throwing', (webhookUrl) => {
    const parsed = parseOptions({ webhookUrl });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('webhookUrl');
    }
  });

  it('accepts a public https webhook and still allows a loopback audioUrl', () => {
    const parsed = parseOptions({
      webhookUrl: 'https://example.com/hook',
      audioUrl: 'http://127.0.0.1/voice.mp3',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options?.webhookUrl).toBe('https://example.com/hook');
      expect(parsed.data.options?.audioUrl).toBe('http://127.0.0.1/voice.mp3');
    }
  });

  it('accepts a public IPv6 literal webhook', () => {
    const webhookUrl = 'https://[2606:4700:4700::1111]/hook';
    const parsed = parseOptions({ webhookUrl });
    expect(parsed.success).toBe(true);
  });
});

describe('pacing option descriptions teach A/B testing', () => {
  const clipDuration = GeneratePersonaVideoOptionsShape.videoClipDuration.description ?? '';
  const transitionMode = GeneratePersonaVideoOptionsShape.videoTransitionMode.description ?? '';
  const variationSeed = GeneratePersonaVideoOptionsShape.videoVariationSeed.description ?? '';

  function contractSource(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (;;) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
        return readFileSync(join(dir, 'shared', 'contracts', 'videos.ts'), 'utf8');
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error('findRepoRoot: pnpm-workspace.yaml not found');
      dir = parent;
    }
  }

  it('says the clip duration is a pacing weight, not exact seconds', () => {
    expect(clipDuration).toContain('1-60');
    expect(clipDuration).toContain('2s default');
    expect(clipDuration).toContain('1.5x');
    expect(clipDuration).toContain('not exact seconds');
  });

  it('tells the agent to A/B test one knob at a time', () => {
    expect(clipDuration).toContain('one knob at a time');
    expect(transitionMode).toContain('one knob at a time');
  });

  it('names what each transition does', () => {
    expect(transitionMode).toContain('Crossfade');
    expect(transitionMode).toContain('Shuffle');
    expect(transitionMode).toContain('FadeIn');
    expect(transitionMode).toContain('SlideIn');
  });

  it('says the seed repeats a pattern and changes the look without changing pacing', () => {
    expect(variationSeed).toContain('same seed repeats the same pattern');
    expect(variationSeed).toContain('without changing pacing');
  });

  it('keeps the three descriptions identical in the shared contract', () => {
    const contract = contractSource();
    expect(contract).toContain(clipDuration);
    expect(contract).toContain(transitionMode);
    expect(contract).toContain(variationSeed);
  });
});
