import { describe, it, expect } from 'vitest';
import { GeneratePersonaVideoOptionsShape } from '../schedule-shapes.js';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';

describe('generate_persona_video options (Phase 5-4)', () => {
  it('no longer advertises scriptPrompt or scriptPrompts as generation inputs', () => {
    // Scripts come from segments only: the generation options must not
    // offer a prompt override anymore.
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
