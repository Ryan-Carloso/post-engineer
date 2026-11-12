// Shared musicMood field schema: single source of truth for the web app
// and the MCP server, for the options.musicMood field of
// generate-and-schedule (issue #561, first shared JSON body).
// DO NOT EDIT this copy directly in apps/web or apps/mcp: the files at
// apps/web/lib/generation/music-mood-field.ts and
// apps/mcp/src/music-mood-field.ts are generated copies of this file.
// Edit here, then run `node scripts/sync-music-mood-field.mjs` from the
// repo root (both apps also run it from their prebuild/pretest scripts).
//
// Both apps already sent this exact shape before it was shared: the web
// route's OptionsSchema and the MCP's GeneratePersonaVideoOptionsShape
// each defined `z.string().min(1).max(64).optional()` for musicMood, and
// the MCP additionally carried the describe text below. Sharing the field
// means the MCP can no longer strip or loosen a mood the web route would
// reject (or the reverse) without the drift tests failing.
//
// Zod compatibility: this file must compile and behave the same under
// Zod 3 (apps/mcp) and Zod 4 (apps/web), so it uses only syntax both
// accept — z.string().min().max().optional().describe(). No .url(),
// errorMap, or error-customization APIs, whose shapes differ by major.
//
// The shape check only bounds the value (a 1-64 char string, optional):
// the 64-char cap mirrors the engine's VideoParams.music_mood
// max_length. Whether the mood names a catalogued mood (or "none") is a
// separate pre-charge check on the web side (lib/generation/music-moods).
import { z } from 'zod';

export const musicMoodField = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe(
    'Background-music mood for the video: a mood from the engine BGM catalog, or "none" for explicit no music. Omitted lets the engine pick the first catalogued mood; an unknown mood is rejected with a 400 naming the valid moods. Works with faceless videos too.',
  );
