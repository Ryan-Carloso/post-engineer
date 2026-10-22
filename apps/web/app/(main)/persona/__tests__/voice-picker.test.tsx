import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { PersonaHouseVoicePicker, filterVoices } from '../voice-picker';
import type { VoiceOption } from '@/lib/types';

const VOICES: VoiceOption[] = [
  { id: 'phonon:Zoey', name: 'Zoey', provider: 'phonon', gender: 'female', category: 'normal', locale: 'en-US' },
  { id: 'phonon:Easton', name: 'Easton', provider: 'phonon', gender: 'male', category: 'normal', locale: 'en-US' },
  { id: 'kokoro:bf_emma', name: 'Emma', provider: 'kokoro', gender: 'female', category: 'normal', locale: 'en-GB' },
  { id: 'kokoro:bm_george', name: 'George', provider: 'kokoro', gender: 'male', category: 'normal', locale: 'en-GB' },
  { id: 'phonon:Azgorath', name: 'Azgorath', provider: 'phonon', gender: 'male', category: 'character', locale: null },
  { id: 'phonon:Morwenna of the Deep', name: 'Morwenna of the Deep', provider: 'phonon', gender: 'female', category: 'character', locale: null },
  { id: 'openrouter:x-ai/grok-voice-tts-1:eve' },
];

const storeMocks = vi.hoisted(() => ({
  voiceId: '',
  setVoiceId: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useVoicesQuery: () => ({ data: VOICES, isLoading: false }),
}));

vi.mock('@/lib/store', () => {
  const state = {
    get voiceId() {
      return storeMocks.voiceId;
    },
  };
  const usePersonaStore = Object.assign(
    vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
    { getState: () => ({ setVoiceId: storeMocks.setVoiceId }) },
  );
  return { usePersonaStore };
});

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    I18nProvider,
    useI18n: () => ({
      t: (key: string) => key,
      locale: 'en',
      setLocale: vi.fn(),
    }),
  };
});

const visibleNames = () =>
  VOICES.map((v) => v.name ?? 'eve').filter((name) => screen.queryByText(name) !== null);

describe('filterVoices', () => {
  it('returns everything when both filters are all', () => {
    expect(filterVoices(VOICES, 'all', 'all')).toHaveLength(VOICES.length);
  });

  it('characters match the character origin regardless of locale', () => {
    const ids = filterVoices(VOICES, 'all', 'character').map((v) => v.id);
    expect(ids).toEqual(['phonon:Azgorath', 'phonon:Morwenna of the Deep']);
  });

  it('gender filter still applies to characters', () => {
    const ids = filterVoices(VOICES, 'female', 'character').map((v) => v.id);
    expect(ids).toEqual(['phonon:Morwenna of the Deep']);
  });

  it('metadata-less voices only appear when both filters are all', () => {
    expect(filterVoices(VOICES, 'female', 'all').map((v) => v.id)).not.toContain(
      'openrouter:x-ai/grok-voice-tts-1:eve',
    );
    expect(filterVoices(VOICES, 'all', 'en-US').map((v) => v.id)).not.toContain(
      'openrouter:x-ai/grok-voice-tts-1:eve',
    );
  });

  it('US origin excludes characters and GB voices', () => {
    expect(filterVoices(VOICES, 'all', 'en-US').map((v) => v.id)).toEqual([
      'phonon:Zoey',
      'phonon:Easton',
    ]);
  });
});

describe('PersonaHouseVoicePicker filters', () => {
  beforeEach(() => {
    storeMocks.voiceId = '';
    storeMocks.setVoiceId.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows every voice by default, with provider and origin sub-labels', () => {
    render(<PersonaHouseVoicePicker />);
    expect(visibleNames()).toHaveLength(VOICES.length);
    expect(screen.getAllByText('Phonon · persona.voiceBadgeUS')).toHaveLength(2);
    expect(screen.getAllByText('Kokoro · persona.voiceBadgeGB')).toHaveLength(2);
    expect(screen.getAllByText('Phonon · persona.voiceBadgeCharacter')).toHaveLength(2);
  });

  it('gender chip narrows to female voices including female characters', async () => {
    const user = userEvent.setup();
    render(<PersonaHouseVoicePicker />);

    await user.click(screen.getByTestId('voice-filter-gender-female'));

    expect(screen.getByText('Zoey')).toBeInTheDocument();
    expect(screen.getByText('Emma')).toBeInTheDocument();
    expect(screen.getByText('Morwenna of the Deep')).toBeInTheDocument();
    expect(screen.queryByText('Easton')).not.toBeInTheDocument();
    expect(screen.queryByText('Azgorath')).not.toBeInTheDocument();
    expect(screen.queryByText('eve')).not.toBeInTheDocument();
  });

  it('characters origin chip shows only characters; gender still applies', async () => {
    const user = userEvent.setup();
    render(<PersonaHouseVoicePicker />);

    await user.click(screen.getByTestId('voice-filter-origin-characters'));
    expect(screen.getByText('Azgorath')).toBeInTheDocument();
    expect(screen.getByText('Morwenna of the Deep')).toBeInTheDocument();
    expect(screen.queryByText('Zoey')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('voice-filter-gender-female'));
    expect(screen.queryByText('Azgorath')).not.toBeInTheDocument();
    expect(screen.getByText('Morwenna of the Deep')).toBeInTheDocument();
  });

  it('combining US origin with male gender leaves only US males', async () => {
    const user = userEvent.setup();
    render(<PersonaHouseVoicePicker />);

    await user.click(screen.getByTestId('voice-filter-origin-us'));
    await user.click(screen.getByTestId('voice-filter-gender-male'));

    expect(screen.getByText('Easton')).toBeInTheDocument();
    expect(screen.queryByText('Zoey')).not.toBeInTheDocument();
    expect(screen.queryByText('George')).not.toBeInTheDocument();
  });

  it('picking a voice stores it and plays the sample endpoint', async () => {
    const created: { url: string; play: ReturnType<typeof vi.fn> }[] = [];
    class FakeAudio {
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      constructor(url: string) {
        created.push({ url, play: this.play });
      }
    }
    vi.stubGlobal('Audio', FakeAudio);
    const user = userEvent.setup();
    render(<PersonaHouseVoicePicker />);

    await user.click(screen.getByRole('button', { name: /Emma/ }));

    expect(storeMocks.setVoiceId).toHaveBeenCalledWith('kokoro:bf_emma');
    expect(created).toHaveLength(1);
    expect(created[0].url).toBe(
      '/api/persona/voices/sample?voice_id=kokoro%3Abf_emma',
    );
  });
});
