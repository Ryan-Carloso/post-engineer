'use client';

import { useRef, useState } from 'react';
import { useVoiceSampleLanguagesQuery, useVoicesQuery } from '@/lib/api';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
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
// matchSampleLanguage — picks the voice sample code closest to the
// persona language: exact ('es' → 'es') or by prefix ('pt' → 'pt-br').
// Returns undefined when there is no match.
//---------------
const matchSampleLanguage = (
  personaLanguage: string,
  samples: Array<{ code: string }>,
): string | undefined => {
  const lang = personaLanguage.trim().toLowerCase();
  if (!lang) return undefined;
  const codes = samples.map((sample) => sample.code);
  const exact = codes.find((code) => code.toLowerCase() === lang);
  if (exact) return exact;
  return codes.find((code) => {
    const normalized = code.toLowerCase();
    return normalized.startsWith(`${lang}-`) || lang.startsWith(`${normalized}-`);
  });
};

//---------------
// PersonaHouseVoicePicker — house voice grid
//---------------
export const PersonaHouseVoicePicker = ({ personaLanguage }: { personaLanguage?: string }) => {
  const voicesQuery = useVoicesQuery();
  const sampleLanguagesQuery = useVoiceSampleLanguagesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  // Manual user choice (null = not touched yet): wins over the default.
  const [sampleLanguage, setSampleLanguage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPickedVoiceRef = useRef<string | null>(null);
  const { t } = useI18n();

  const voices = voicesQuery.data ?? [];
  const matchedSampleLanguage = personaLanguage
    ? matchSampleLanguage(personaLanguage, sampleLanguagesQuery.data ?? [])
    : undefined;
  // English-only launch: the sample-language list only carries English
  // codes, and the fallback default is an English sample too.
  const effectiveSampleLanguage = sampleLanguage ?? matchedSampleLanguage ?? 'en-us';

  const playVoiceSample = (pickedVoiceId: string, language: string): void => {
    audioRef.current?.pause();
    const audio = new Audio(
      `/voice-samples/${encodeURIComponent(pickedVoiceId)}-${encodeURIComponent(language)}.mp3`,
    );
    audioRef.current = audio;
    const playResult = audio.play();
    if (playResult) {
      void playResult.catch(() => {});
    }
  };

  const handlePickVoice = (pickedVoiceId: string) => {
    usePersonaStore.getState().setVoiceId(pickedVoiceId);
    lastPickedVoiceRef.current = pickedVoiceId;
    playVoiceSample(pickedVoiceId, effectiveSampleLanguage);
  };

  const handleSampleLanguageChange = (language: string) => {
    setSampleLanguage(language);
    // Switched language after listening to a sample? Restart the audio in the new language.
    const lastPickedVoice = lastPickedVoiceRef.current;
    if (lastPickedVoice) {
      playVoiceSample(lastPickedVoice, language);
    }
  };

  return (
    <div className="mt-4">
      <label className="mb-4 block max-w-sm text-sm font-medium text-neutral-700">
        {t('persona.sampleLanguage')}
        <span className="relative mt-2 block">
          <select
            data-testid="sample-language"
            value={effectiveSampleLanguage}
            onChange={(e) => handleSampleLanguageChange(e.target.value)}
            className="h-12 w-full appearance-none rounded-xl border border-neutral-300 bg-white px-4 pr-11 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:border-neutral-400 focus:border-accent focus:ring-4 focus:ring-accent/10 focus:outline-none"
          >
            {(sampleLanguagesQuery.data ?? []).map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-neutral-500">
            <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </label>
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
