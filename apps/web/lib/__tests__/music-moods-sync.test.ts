import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import { MUSIC_MOODS, unknownMusicMoodMessage } from '@/lib/generation/music-moods';

const root = findRepoRoot(import.meta.url);
const catalog = readFileSync(join(root, 'apps/engine/resource/songs/catalog.toml'), 'utf8');

function catalogMoods(text: string): string[] {
  const moods = new Set<string>();
  for (const match of text.matchAll(/moods\s*=\s*\[([^\]]*)\]/g)) {
    for (const item of match[1].split(',')) {
      const mood = item.trim().replace(/^['"]|['"]$/g, '');
      if (mood !== '' && mood !== 'auto' && mood !== 'none') moods.add(mood);
    }
  }
  return [...moods].sort();
}

describe('music moods match the engine song catalog', () => {
  it('lists exactly the catalogued moods, sorted', () => {
    expect([...MUSIC_MOODS]).toEqual(catalogMoods(catalog));
  });

  it('rejects an unknown mood with the engine message shape', () => {
    expect(unknownMusicMoodMessage('funky')).toBe(
      `unknown music mood: 'funky'; available moods: ${catalogMoods(catalog).join(', ')}`,
    );
  });
});
