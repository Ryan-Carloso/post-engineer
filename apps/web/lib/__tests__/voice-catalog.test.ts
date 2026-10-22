import { describe, expect, it } from 'vitest';

import { filterHouseVoices, isVoiceOption, voiceSampleName, type VoiceOption } from '../voice-catalog';

const v = (overrides: Partial<VoiceOption> & { id: string }): VoiceOption => ({
  label: 'X',
  provider: 'kokoro',
  gender: 'female',
  accent: 'us',
  kind: 'standard',
  ...overrides,
});

const CATALOG: VoiceOption[] = [
  v({ id: 'chatterbox:kokoro_af_heart' }),
  v({ id: 'chatterbox:kokoro_bm_george', gender: 'male', accent: 'gb' }),
  v({ id: 'chatterbox:phonon_azgorath', provider: 'phonon', gender: 'male', accent: null, kind: 'character' }),
  v({ id: 'chatterbox:phonon_the_snow_queen', provider: 'phonon', accent: null, kind: 'character' }),
  v({ id: 'chatterbox:u0123_clone', provider: 'chatterbox', gender: null, accent: null, kind: 'cloned', label: null }),
];

const ids = (voices: VoiceOption[]): string[] => voices.map((voice) => voice.id);

describe('filterHouseVoices', () => {
  it('all/all shows every house voice but never clones', () => {
    expect(ids(filterHouseVoices(CATALOG, 'all', 'all'))).toEqual([
      'chatterbox:kokoro_af_heart',
      'chatterbox:kokoro_bm_george',
      'chatterbox:phonon_azgorath',
      'chatterbox:phonon_the_snow_queen',
    ]);
  });

  it('origin filters by accent and keeps characters out of US/UK', () => {
    expect(ids(filterHouseVoices(CATALOG, 'all', 'us'))).toEqual(['chatterbox:kokoro_af_heart']);
    expect(ids(filterHouseVoices(CATALOG, 'all', 'gb'))).toEqual(['chatterbox:kokoro_bm_george']);
  });

  it('characters are their own origin and the gender filter still applies', () => {
    expect(ids(filterHouseVoices(CATALOG, 'all', 'character'))).toEqual([
      'chatterbox:phonon_azgorath',
      'chatterbox:phonon_the_snow_queen',
    ]);
    expect(ids(filterHouseVoices(CATALOG, 'female', 'character'))).toEqual(['chatterbox:phonon_the_snow_queen']);
    expect(ids(filterHouseVoices(CATALOG, 'male', 'all'))).toEqual([
      'chatterbox:kokoro_bm_george',
      'chatterbox:phonon_azgorath',
    ]);
  });
});

describe('isVoiceOption', () => {
  it('accepts a full entry and rejects missing or unknown metadata', () => {
    expect(isVoiceOption(CATALOG[0])).toBe(true);
    expect(isVoiceOption(CATALOG[4])).toBe(true);
    expect(isVoiceOption({ id: 'chatterbox:x' })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], gender: 'other' })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], accent: 'au' })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], kind: 'robot' })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], id: '' })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], label: 3 })).toBe(false);
    expect(isVoiceOption(null)).toBe(false);
  });
});

describe('voiceSampleName', () => {
  it('maps house voices to their sample file name and skips clones/OpenRouter', () => {
    expect(voiceSampleName(CATALOG[0])).toBe('kokoro_af_heart');
    expect(voiceSampleName(CATALOG[4])).toBeNull();
    expect(voiceSampleName(v({ id: 'openrouter:m:eve', provider: 'openrouter' }))).toBeNull();
  });
});

describe('engine catalog <-> web samples sync', () => {
  it('every engine catalog voice validates and has a picker sample file', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { findRepoRoot } = await import('../../test/repo-root');
    const root = findRepoRoot(import.meta.url);
    const catalog: unknown = JSON.parse(
      readFileSync(join(root, 'apps/engine/app/services/voice_catalog.json'), 'utf8'),
    );
    const voices = (catalog as { voices: { name: string; label: string; provider: string; gender: string; accent: string | null; kind: string }[] }).voices;
    const samples = new Set(readdirSync(join(root, 'apps/web/public/voice-samples')));

    expect(voices).toHaveLength(65);
    for (const entry of voices) {
      const option = { id: `chatterbox:${entry.name}`, label: entry.label, provider: entry.provider, gender: entry.gender, accent: entry.accent, kind: entry.kind };
      expect(isVoiceOption(option)).toBe(true);
      expect(samples.has(`${entry.name}.mp3`)).toBe(true);
    }
  });
});
