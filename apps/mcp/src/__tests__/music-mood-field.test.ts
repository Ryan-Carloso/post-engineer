// Contract test for the shared musicMood field schema (MCP copy, Zod 3).
// The web copy runs the same payload table in
// apps/web/lib/generation/__tests__/music-mood-field.test.ts (Zod 4):
// both copies must accept and reject exactly the same values, or the MCP
// would strip or pass through a mood the web route then rejects after
// parsing. This pins the shape only (a 1-64 char string, optional); the
// catalog check (calm/energetic/inspiring/upbeat or "none") is a
// separate layer.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { musicMoodField } from '../music-mood-field.js';

const OptionsShape = z.object({ musicMood: musicMoodField });

describe('musicMoodField contract (MCP copy)', () => {
  it.each(['calm', 'energetic', 'inspiring', 'upbeat', 'none'])('accepts the mood %s', (mood) => {
    expect(musicMoodField.safeParse(mood).success).toBe(true);
  });

  it('accepts any string within the 1-64 character bounds', () => {
    expect(musicMoodField.safeParse('x').success).toBe(true);
    expect(musicMoodField.safeParse('x'.repeat(64)).success).toBe(true);
  });

  it('rejects an empty mood', () => {
    expect(musicMoodField.safeParse('').success).toBe(false);
  });

  it('rejects a mood over 64 characters', () => {
    expect(musicMoodField.safeParse('x'.repeat(65)).success).toBe(false);
  });

  it('rejects a non-string mood', () => {
    expect(musicMoodField.safeParse(5).success).toBe(false);
    expect(musicMoodField.safeParse(null).success).toBe(false);
  });

  it('accepts an omitted mood', () => {
    const result = musicMoodField.safeParse(undefined);
    expect(result.success).toBe(true);
    expect(OptionsShape.parse({})).toEqual({});
    expect(OptionsShape.parse({ musicMood: 'calm' })).toEqual({ musicMood: 'calm' });
  });
});
