'use client';

import { useRef, useState } from 'react';
import { useVoicesQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { CheckIcon, MicIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import {
  filterHouseVoices,
  voiceSampleName,
  type GenderFilter,
  type OriginFilter,
  type VoiceOption,
} from '@/lib/voice-catalog';

// Voice ids come from the engine's catalog and are provider-qualified:
// `chatterbox:kokoro_af_heart`, or `openrouter:<model>:<voice>` for the
// OpenRouter TTS provider. House voices carry their own catalog label; a voice
// with no label shows its raw id, never another voice's name — that fallback
// used to render every unknown id as "Voz feminina calma".
//
// The underscore-to-space rewrite is Chatterbox-shaped (`en_us_female_01` →
// "en us female 01") and is deliberately NOT applied to OpenRouter, whose ids
// are model/voice slugs where an underscore is meaningful: `microsoft/mai-
// voice-2.1:en-US-Harper:MAI-Voice-2.1` must not become "en US Harper:MAI...".
// The model stays in the label because two entries can share a voice name and
// differ only by model.
const voiceLabel = (voice: VoiceOption): string => {
  if (voice.label !== null) {
    return voice.label;
  }
  const voiceId = voice.id;
  const openrouter = parseOpenrouterVoiceId(voiceId);
  if (openrouter) {
    return openrouter.voice;
  }
  return voiceId.replace(/^chatterbox:/, '').replace(/_/g, ' ');
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
// PersonaHouseVoicePicker — house voice grid
//---------------
export const PersonaHouseVoicePicker = () => {
  const { t } = useI18n();
  const voicesQuery = useVoicesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [gender, setGender] = useState<GenderFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');

  const voices = filterHouseVoices(voicesQuery.data ?? [], gender, origin);

  const genderOptions: { value: GenderFilter; label: string }[] = [
    { value: 'all', label: t('persona.voiceFilterAll') },
    { value: 'female', label: t('persona.voiceFilterFemale') },
    { value: 'male', label: t('persona.voiceFilterMale') },
  ];
  const originOptions: { value: OriginFilter; label: string }[] = [
    { value: 'all', label: t('persona.voiceFilterAll') },
    { value: 'us', label: t('persona.voiceFilterUs') },
    { value: 'gb', label: t('persona.voiceFilterGb') },
    { value: 'character', label: t('persona.voiceFilterCharacters') },
  ];

  // House samples are English takes rendered by the local TTS server, one
  // per catalog voice; OpenRouter voices have none and play nothing.
  const playVoiceSample = (voice: VoiceOption): void => {
    const sampleName = voiceSampleName(voice);
    if (sampleName === null) {
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(`/voice-samples/${encodeURIComponent(sampleName)}.mp3`);
    audioRef.current = audio;
    const playResult = audio.play();
    if (playResult) {
      void playResult.catch(() => {});
    }
  };

  const handlePickVoice = (voice: VoiceOption) => {
    usePersonaStore.getState().setVoiceId(voice.id);
    playVoiceSample(voice);
  };

  return (
    <div className="mt-4">
      <VoiceFilterChips
        label={t('persona.voiceFilterGender')}
        options={genderOptions}
        value={gender}
        onChange={setGender}
      />
      <VoiceFilterChips
        label={t('persona.voiceFilterOrigin')}
        options={originOptions}
        value={origin}
        onChange={setOrigin}
      />
      {voices.length === 0 && voicesQuery.isSuccess && (
        <p className="mt-3 text-sm text-neutral-500">{t('persona.voiceFilterEmpty')}</p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((voice) => {
          const isActive = voice.id === voiceId;
          return (
            <button
              key={voice.id}
              type="button"
              aria-pressed={isActive}
              // The raw id is the only complete label: both lines above are
              // display and the model line is hidden for single-word voices.
              title={voice.id}
              onClick={() => handlePickVoice(voice)}
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
                {voiceModelLabel(voice.id) !== '' && (
                  <span className="block truncate text-xs text-neutral-500">
                    {voiceModelLabel(voice.id)}
                  </span>
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

//---------------
// VoiceFilterChips — one labelled row of single-select chips (gender or
// origin). aria-pressed marks the active chip for assistive tech.
//---------------
function VoiceFilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs transition-colors',
            option.value === value
              ? 'border-neutral-900 bg-neutral-900 font-medium text-white'
              : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
