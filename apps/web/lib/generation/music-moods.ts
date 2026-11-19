export const MUSIC_MOODS = ['calm', 'energetic', 'inspiring', 'upbeat'] as const;

export type MusicMood = (typeof MUSIC_MOODS)[number];

export const MUSIC_MOOD_NONE = 'none';

export function isMusicMood(value: unknown): value is MusicMood {
  return typeof value === 'string' && (MUSIC_MOODS as readonly string[]).includes(value);
}

export function unknownMusicMoodMessage(value: string): string {
  return `unknown music mood: '${value}'; available moods: ${MUSIC_MOODS.join(', ')}`;
}
