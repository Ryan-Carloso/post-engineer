'use client';

import { useRef, useState } from 'react';
import { useVoicesQuery } from '@/lib/api';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import type { VoiceOption } from '@/lib/types';
import { CheckIcon, MicIcon } from '@/lib/ui';

// Voice ids come from the engine's catalog and are provider-qualified:
// `phonon:<Name>` / `kokoro:<voice_id>` for the local preset catalog,
// `chatterbox:<engine_voice_key>` for the caller's own clones, or
// `openrouter:<model>:<voice>` for the OpenRouter TTS provider. There is
// no house-voice map any more, and no label fallback: a voice with no
// catalog name must show its raw id, not borrow another voice's name —
// that fallback used to render every unknown id as "Voz feminina calma".
//
// The underscore-to-space rewrite is Chatterbox-shaped (`en_us_female_01` →
// "en us female 01") and is deliberately NOT applied to OpenRouter, whose ids
// are model/voice slugs where an underscore is meaningful: `microsoft/mai-
// voice-2.1:en-US-Harper:MAI-Voice-2.1` must not become "en US Harper:MAI...".
// The model stays in the label because two entries can share a voice name and
// differ only by model.
const voiceLabel = (voice: VoiceOption): string => {
  if (voice.name) {
    return voice.name;
  }
  const openrouter = parseOpenrouterVoiceId(voice.id);
  if (openrouter) {
    return openrouter.voice;
  }
  return voice.id.replace(/^chatterbox:/, '').replace(/_/g, ' ');
};

//---------------
// parseOpenrouterVoiceId — `openrouter:<model>:<voice>` split on the FIRST
// colon, mirroring the engine's parser. The model id contains slashes and some
// voices contain colons of their own (Azure voice ids carry the model in a
// suffix, e.g. `en-US-Harper:MAI-Voice-2.1`), so this must agree with
// voice.parse_openrouter_voice or the picker would show a split the engine
// never sees.
//---------------
function parseOpenrouterVoiceId(voiceId: string): { model: string; voice: string } | null {
  const remainder = voiceId.startsWith('openrouter:') ? voiceId.slice('openrouter:'.length) : null;
  if (remainder === null) {
    return null;
  }
  const [model, ...voiceParts] = remainder.split(':');
  // The voice half is everything after the first colon, not just the second
  // segment: an Azure voice id carries its own colons.
  const voice = voiceParts.join(':');
  if (!model || !voice) {
    return null;
  }
  return { model, voice };
}

//---------------
// voiceModelLabel — the model half of an OpenRouter voice id, shown under the
// voice name. It is not decoration: two models can offer the same voice name
// (`eve` on Grok, `Kore` on Gemini), and collapsing the label to the voice
// alone would render two identical rows. Rendered as a second line rather than
// appended to the name because `model:voice` overflows the card and truncates
// mid-slug — which is how the two Grok voices became indistinguishable.
//---------------
function voiceModelLabel(voiceId: string): string {
  return parseOpenrouterVoiceId(voiceId)?.model ?? '';
}

//---------------
// Voice filters (user spec): gender — all/male/female; origin — all/US/
// England/Characters. 'Characters' is a CATEGORY, not an accent:
// character voices carry a gender (the gender filter still applies to
// them) but no locale, so they never match the US/England origins.
// Voices without catalog metadata (OpenRouter) have no known gender or
// origin, so they only appear when both filters are on 'all'.
//---------------
export type VoiceGenderFilter = 'all' | 'male' | 'female';
export type VoiceOriginFilter = 'all' | 'en-US' | 'en-GB' | 'character';

export function filterVoices(
  voices: VoiceOption[],
  gender: VoiceGenderFilter,
  origin: VoiceOriginFilter,
): VoiceOption[] {
  return voices.filter((voice) => {
    if (gender !== 'all' && voice.gender !== gender) {
      return false;
    }
    if (origin === 'character') {
      return voice.category === 'character';
    }
    if (origin !== 'all') {
      return voice.category !== 'character' && voice.locale === origin;
    }
    return true;
  });
}

const FilterChip = ({
  active,
  label,
  testId,
  onSelect,
}: {
  active: boolean;
  label: string;
  testId: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-pressed={active}
    onClick={onSelect}
    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'border-accent bg-red-50/50 text-accent'
        : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400'
    }`}
  >
    {label}
  </button>
);

//---------------
// PersonaHouseVoicePicker — preset voice grid with filters
//---------------
export const PersonaHouseVoicePicker = () => {
  const voicesQuery = useVoicesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  const [genderFilter, setGenderFilter] = useState<VoiceGenderFilter>('all');
  const [originFilter, setOriginFilter] = useState<VoiceOriginFilter>('all');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { t } = useI18n();

  const voices = filterVoices(voicesQuery.data ?? [], genderFilter, originFilter);

  const playVoiceSample = (pickedVoiceId: string): void => {
    audioRef.current?.pause();
    const audio = new Audio(
      `/api/persona/voices/sample?voice_id=${encodeURIComponent(pickedVoiceId)}`,
    );
    audioRef.current = audio;
    const playResult = audio.play();
    if (playResult) {
      void playResult.catch(() => {});
    }
  };

  const handlePickVoice = (pickedVoiceId: string) => {
    usePersonaStore.getState().setVoiceId(pickedVoiceId);
    playVoiceSample(pickedVoiceId);
  };

  const subLabel = (voice: VoiceOption): string => {
    const model = voiceModelLabel(voice.id);
    if (model !== '') {
      return model;
    }
    if (!voice.provider) {
      return '';
    }
    const provider = voice.provider === 'phonon' ? 'Phonon' : voice.provider === 'kokoro' ? 'Kokoro' : voice.provider;
    if (voice.category === 'character') {
      return `${provider} · ${t('persona.voiceBadgeCharacter')}`;
    }
    if (voice.locale === 'en-US') {
      return `${provider} · ${t('persona.voiceBadgeUS')}`;
    }
    if (voice.locale === 'en-GB') {
      return `${provider} · ${t('persona.voiceBadgeGB')}`;
    }
    return provider;
  };

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t('persona.voiceFilterGenderLabel')}
        </span>
        <FilterChip
          testId="voice-filter-gender-all"
          label={t('persona.voiceFilterAll')}
          active={genderFilter === 'all'}
          onSelect={() => setGenderFilter('all')}
        />
        <FilterChip
          testId="voice-filter-gender-male"
          label={t('persona.voiceFilterMale')}
          active={genderFilter === 'male'}
          onSelect={() => setGenderFilter('male')}
        />
        <FilterChip
          testId="voice-filter-gender-female"
          label={t('persona.voiceFilterFemale')}
          active={genderFilter === 'female'}
          onSelect={() => setGenderFilter('female')}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t('persona.voiceFilterOriginLabel')}
        </span>
        <FilterChip
          testId="voice-filter-origin-all"
          label={t('persona.voiceFilterAll')}
          active={originFilter === 'all'}
          onSelect={() => setOriginFilter('all')}
        />
        <FilterChip
          testId="voice-filter-origin-us"
          label={t('persona.voiceFilterUS')}
          active={originFilter === 'en-US'}
          onSelect={() => setOriginFilter('en-US')}
        />
        <FilterChip
          testId="voice-filter-origin-gb"
          label={t('persona.voiceFilterGB')}
          active={originFilter === 'en-GB'}
          onSelect={() => setOriginFilter('en-GB')}
        />
        <FilterChip
          testId="voice-filter-origin-characters"
          label={t('persona.voiceFilterCharacters')}
          active={originFilter === 'character'}
          onSelect={() => setOriginFilter('character')}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((voice) => {
          const isActive = voice.id === voiceId;
          const sub = subLabel(voice);
          return (
            <button
              key={voice.id}
              type="button"
              aria-pressed={isActive}
              // The raw id is the only complete label: both lines above are
              // display and the model line is hidden for single-word voices.
              title={voice.id}
              onClick={() => handlePickVoice(voice.id)}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isActive
                  ? 'border-accent bg-red-50/50'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  isActive ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                <MicIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {voiceLabel(voice)}
                </span>
                {sub !== '' && (
                  <span className="block truncate text-xs text-neutral-500">{sub}</span>
                )}
              </span>
              {isActive && (
                <span className="text-accent">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
