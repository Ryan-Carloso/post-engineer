import { z } from 'zod';

export const musicMoodField = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe(
    'Background-music mood for the video: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood; an unknown mood is rejected with a 400 naming the valid moods. Works with voiceover videos too.',
  );
