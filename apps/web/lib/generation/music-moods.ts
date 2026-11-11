//---------------
// BGM mood catalog (issue #489): the moods the engine's song catalog
// offers, plus the explicit no-music value.
//
// Mirrors apps/engine/resource/songs/catalog.toml — the moods are the
// union of every track's `moods` list, minus the 'auto'/'none' markers.
// The music-moods sync test pins the two together, so adding a track mood
// in the catalog without updating this list fails the test instead of
// silently 400ing the agent at the engine. The engine's own
// validate_music_mood rejects unknown moods with the same message shape
// (see unknownMusicMoodMessage below); the web rejects them before any
// charge, so the 400 — with the list — is what reaches the caller.
//---------------

export const MUSIC_MOODS = ['calm', 'energetic', 'inspiring', 'upbeat'] as const;

export type MusicMood = (typeof MUSIC_MOODS)[number];

/** Explicit no-music choice (never a catalog mood). */
export const MUSIC_MOOD_NONE = 'none';

/** Narrow an untrusted value to a catalogued mood. */
export function isMusicMood(value: unknown): value is MusicMood {
  return typeof value === 'string' && (MUSIC_MOODS as readonly string[]).includes(value);
}

/**
 * Unknown-mood error, same shape as the engine's validate_music_mood
 * ("unknown music mood: 'x'; available moods: calm, energetic, ..."):
 * the agent sees the same text whichever layer rejects it.
 */
export function unknownMusicMoodMessage(value: string): string {
  return `unknown music mood: '${value}'; available moods: ${MUSIC_MOODS.join(', ')}`;
}
