'use client';

import { useRef, useState } from 'react';
import { useVoicesQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { MicIcon, PlayIcon } from '@/lib/ui';
import {
  filterHouseVoices,
  isCloneVoiceId,
  voiceSampleName,
  type VoiceOption,
} from '@/lib/voice-catalog';
import { VoicePickerDialog, VoiceTags } from './voice-picker-dialog';

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

function legacyVoice(voiceId: string): VoiceOption {
  // A stored clone id from before the chatterbox_nano: rename misses the
  // catalog lookup, so it lands here. It is still a clone: the "Cloned" tag
  // renders and no (nonexistent) sample button is shown for it.
  return { id: voiceId, label: null, provider: 'chatterbox', gender: null, accent: null, kind: isCloneVoiceId(voiceId) ? 'cloned' : 'standard', description: null };
}

//---------------
// PersonaHouseVoicePicker — the chosen voice as a card (name, tags,
// description, play) with a button that opens VoicePickerDialog to search and
// filter the whole catalog.
//---------------
export const PersonaHouseVoicePicker = () => {
  const { t } = useI18n();
  const voicesQuery = useVoicesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const houseVoices = filterHouseVoices(voicesQuery.data ?? [], 'all', 'all');
  // Looked up in the full catalog: the persona may use a clone picked in the
  // "clone my voice" tab, which the house list deliberately leaves out.
  // A legacy id outside the catalog (e.g. chatterbox:en_us_male_01, which the
  // TTS server aliases) still is the persona's voice: show it by id rather
  // than "no voice chosen".
  const selected =
    (voicesQuery.data ?? []).find((voice) => voice.id === voiceId) ??
    (voiceId === null ? null : legacyVoice(voiceId));
  const selectedLabel = (voice: VoiceOption): string =>
    voice.kind === 'cloned' ? t('persona.voiceTagCloned') : voiceLabel(voice);

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
    setPlayingVoiceId(voice.id);
    audio.onended = () => setPlayingVoiceId(null);
    const playResult = audio.play();
    if (playResult) {
      void playResult.catch(() => setPlayingVoiceId(null));
    }
  };

  const handlePickVoice = (voice: VoiceOption) => {
    usePersonaStore.getState().setVoiceId(voice.id);
    setDialogOpen(false);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
          <MicIcon />
        </span>
        <div className="min-w-0 flex-1 basis-0 space-y-1" data-testid="selected-voice">
          {selected === null ? (
            <p className="text-sm text-neutral-500">{t('persona.voicePickerNone')}</p>
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-neutral-900">{selectedLabel(selected)}</span>
                <VoiceTags voice={selected} />
              </span>
              {selected.description !== null && (
                <p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">{selected.description}</p>
              )}
            </>
          )}
        </div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          {selected !== null && voiceSampleName(selected) !== null && (
            <button
              type="button"
              onClick={() => playVoiceSample(selected)}
              aria-label={t('persona.voicePlaySample', { name: selectedLabel(selected) })}
              className={`flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
                playingVoiceId === selected.id
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 text-neutral-700 hover:border-neutral-400'
              }`}
            >
              <PlayIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={voicesQuery.data === undefined}
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 sm:flex-none"
          >
            {selected === null ? t('persona.voicePickerChoose') : t('persona.voicePickerChange')}
          </button>
        </div>
      </div>
      <VoicePickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        voices={houseVoices}
        selectedVoiceId={voiceId}
        playingVoiceId={playingVoiceId}
        onPlay={playVoiceSample}
        onPick={handlePickVoice}
        labelFor={voiceLabel}
        modelFor={(voice) => voiceModelLabel(voice.id)}
      />
    </div>
  );
};
