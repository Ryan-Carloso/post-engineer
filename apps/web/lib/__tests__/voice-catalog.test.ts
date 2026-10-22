import { describe, expect, it } from 'vitest';

import { filterHouseVoices, isVoiceOption, searchVoices, voiceSampleName, type VoiceOption } from '../voice-catalog';

const v = (overrides: Partial<VoiceOption> & { id: string }): VoiceOption => ({
  label: 'X',
  provider: 'kokoro',
  gender: 'female',
  accent: 'us',
  kind: 'standard',
  description: null,
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

describe('searchVoices', () => {
  const voices: VoiceOption[] = [
    v({ id: 'chatterbox:phonon_captain', label: 'Captain Silas', provider: 'phonon', gender: 'male', accent: null, kind: 'character', description: 'An old British pirate captain.' }),
    v({ id: 'chatterbox:kokoro_bf_emma', label: 'Emma', gender: 'female', accent: 'gb', description: 'British female voice, mid-range pitch.' }),
    v({ id: 'chatterbox:kokoro_am_onyx', label: 'Onyx', gender: 'male', accent: 'us', description: 'American male voice, very deep pitch.' }),
    v({ id: 'chatterbox:phonon_elodie_rose', label: 'Élodie-Rose', provider: 'phonon', accent: 'gb', description: 'Soft and warm.' }),
  ];

  it('matches every query word as a word prefix across label, description and tags', () => {
    expect(ids(searchVoices(voices, 'pir'))).toEqual(['chatterbox:phonon_captain']);
    expect(ids(searchVoices(voices, 'deep american'))).toEqual(['chatterbox:kokoro_am_onyx']);
    expect(ids(searchVoices(voices, 'british woman'))).toEqual(['chatterbox:kokoro_bf_emma', 'chatterbox:phonon_elodie_rose']);
    expect(ids(searchVoices(voices, 'character'))).toEqual(['chatterbox:phonon_captain']);
  });

  it('does not match "male" inside "female" and ignores case, accents and punctuation', () => {
    expect(ids(searchVoices(voices, 'male'))).toEqual(['chatterbox:phonon_captain', 'chatterbox:kokoro_am_onyx']);
    expect(ids(searchVoices(voices, 'ELODIE-rose'))).toEqual(['chatterbox:phonon_elodie_rose']);
  });

  it('returns every voice for an empty or blank query', () => {
    expect(searchVoices(voices, '   ')).toHaveLength(4);
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
    expect(isVoiceOption({ ...CATALOG[0], description: 3 })).toBe(false);
    expect(isVoiceOption({ ...CATALOG[0], description: 'Warm.' })).toBe(true);
    expect(isVoiceOption(null)).toBe(false);
  });
});

describe('voiceSampleName', () => {
  it('maps house voices to their sample file name and skips clones/OpenRouter', () => {
    expect(voiceSampleName(CATALOG[0])).toBe('kokoro_af_heart');
    expect(voiceSampleName(CATALOG[4])).toBeNull();
    expect(voiceSampleName(v({ id: 'openrouter:m:eve', provider: 'openrouter' }))).toBeNull();
  });

  it('resolves legacy voice ids through the engine alias map to a sample that exists', () => {
    // The old sample files were deleted with the Modal catalog; the engine
    // aliases a stored legacy id to a Kokoro voice at render time, so the
    // picker must play that voice's sample, not the missing legacy file.
    expect(voiceSampleName(v({ id: 'chatterbox:en_us_male_01', provider: 'chatterbox' }))).toBe('kokoro_am_michael');
    expect(voiceSampleName(v({ id: 'chatterbox:en_us_female_01', provider: 'chatterbox' }))).toBe('kokoro_af_heart');
    expect(voiceSampleName(v({ id: 'chatterbox:ryan', provider: 'chatterbox' }))).toBe('kokoro_am_michael');
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
    const voices = (catalog as { voices: { name: string; label: string; provider: string; gender: string; accent: string | null; kind: string; description: string }[] }).voices;
    const samples = new Set(readdirSync(join(root, 'apps/web/public/voice-samples')));

    expect(voices).toHaveLength(65);
    for (const entry of voices) {
      const option = { id: `chatterbox:${entry.name}`, label: entry.label, provider: entry.provider, gender: entry.gender, accent: entry.accent, kind: entry.kind, description: entry.description };
      expect(isVoiceOption(option)).toBe(true);
      expect(samples.has(`${entry.name}.mp3`)).toBe(true);
    }
  });

  it('web sample aliases match the engine LEGACY_VOICE_ALIASES map', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { findRepoRoot } = await import('../../test/repo-root');
    const root = findRepoRoot(import.meta.url);
    const engineSource = readFileSync(
      join(root, 'apps/engine/app/services/voice_catalog.py'),
      'utf8',
    );
    const block = engineSource.split('LEGACY_VOICE_ALIASES')[1].split('}')[0];
    const pairs = [...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThan(0);
    for (const [, legacy, target] of pairs) {
      expect(
        voiceSampleName(v({ id: `chatterbox:${legacy}`, provider: 'chatterbox' })),
      ).toBe(target);
    }
  });
});
