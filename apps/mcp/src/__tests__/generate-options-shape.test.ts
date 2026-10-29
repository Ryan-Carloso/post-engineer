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
      providers: ['youtube'],
      mode: 'asap',
      segments: [{ kind: 'hook', text: 'Stop scrolling, this Porto kitchen changes everything.' }],
      options: { scriptPrompt: 'Be funny', faceless: true },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options).not.toHaveProperty('scriptPrompt');
      expect(parsed.data.options?.faceless).toBe(true);
    }
  });

  it('drops stale scriptPrompts from parsed options instead of forwarding them', () => {
    const parsed = GeneratePersonaVideoSchema.safeParse({
      title: 'Porto trip',
      providers: ['youtube'],
      mode: 'asap',
      segments: [{ kind: 'hook', text: 'Stop scrolling, this Porto kitchen changes everything.' }],
      options: { scriptPrompts: ['Be funny'], faceless: true },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options).not.toHaveProperty('scriptPrompts');
    }
  });
});
