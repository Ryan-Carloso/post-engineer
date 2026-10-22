'use client';

import { useRef } from 'react';
import { useVoicesQuery } from '@/lib/api';
import { usePersonaStore } from '@/lib/store';
import { CheckIcon, MicIcon } from '@/lib/ui';

// Voice ids come from the engine's catalog and are provider-qualified:
// `chatterbox:ryan`, or `openrouter:<model>:<voice>` for the OpenRouter TTS
// provider. There is no house-voice map any more, and no label fallback: a
// voice with no label must show its raw id, not borrow another voice's name —
// that fallback used to render every unknown id as "Voz feminina calma".
//
// The underscore-to-space rewrite is Chatterbox-shaped (`en_us_female_01` →
// "en us female 01") and is deliberately NOT applied to OpenRouter, whose ids
// are model/voice slugs where an underscore is meaningful: `microsoft/mai-
// voice-2.1:en-US-Harper:MAI-Voice-2.1` must not become "en US Harper:MAI...".
// The model stays in the label because two entries can share a voice name and
// differ only by model.
const voiceLabel = (voiceId: string): string => {
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
// SAMPLE_LANGUAGE — English-only launch: there is no sample-language
// picker; house voice samples always play the English take, whatever
// language the persona being edited was created with.
//---------------
const SAMPLE_LANGUAGE = 'en-us';

//---------------
// PersonaHouseVoicePicker — house voice grid
//---------------
export const PersonaHouseVoicePicker = () => {
  const voicesQuery = useVoicesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voices = voicesQuery.data ?? [];

  const playVoiceSample = (pickedVoiceId: string): void => {
    audioRef.current?.pause();
    const audio = new Audio(
      `/voice-samples/${encodeURIComponent(pickedVoiceId)}-${encodeURIComponent(SAMPLE_LANGUAGE)}.mp3`,
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

  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                  {voiceLabel(voice.id)}
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
