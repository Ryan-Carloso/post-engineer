'use client';

import { useEffect, useRef, useState } from 'react';
import { useVoicesQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { INPUT_CLASS, MicIcon, PlayIcon } from '@/lib/ui';
import {
  fetchHouseVoicePreview,
  HOUSE_PREVIEW_TEXT_MAX_CHARS,
} from '@/lib/house-voice-preview-client';
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
  // Custom-text preview: the typed line persists when the voice changes —
  // the point is to hear the same line in several voices. It lives here,
  // not in the dialog, so picking a voice never clears it.
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<'rate-limited' | 'too-long' | 'failed' | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);
  const customObjectUrlRef = useRef<string | null>(null);

  // Revoke the preview object URL when the picker unmounts mid-play.
  useEffect(() => {
    return () => {
      customAudioRef.current?.pause();
      if (customObjectUrlRef.current !== null) {
        URL.revokeObjectURL(customObjectUrlRef.current);
      }
    };
  }, []);

  const stopCustomPreview = (): void => {
    customAudioRef.current?.pause();
    if (customObjectUrlRef.current !== null) {
      URL.revokeObjectURL(customObjectUrlRef.current);
      customObjectUrlRef.current = null;
    }
  };

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
    stopCustomPreview();
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

  // Custom-text preview: the selected house voice speaks the typed line,
  // synthesized live (the static sample above cannot say it). The button
  // stays enabled past the cap so an over-long line reaches the server and
  // comes back as the 400 state instead of being silently truncated.
  const playCustomPreview = (): void => {
    if (selected === null || previewLoading) {
      return;
    }
    const text = previewText.trim();
    if (text === '') {
      return;
    }
    stopCustomPreview();
    audioRef.current?.pause();
    setPlayingVoiceId(null);
    setPreviewError(null);
    setPreviewLoading(true);
    void fetchHouseVoicePreview(selected.id, text)
      .then((result) => {
        if (!result.success) {
          setPreviewError(
            result.status === 429 ? 'rate-limited' : result.status === 400 ? 'too-long' : 'failed',
          );
          return;
        }
        const objectUrl = URL.createObjectURL(result.audio);
        customObjectUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        customAudioRef.current = audio;
        audio.onended = () => {
          if (customObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            customObjectUrlRef.current = null;
          }
        };
        const playResult = audio.play();
        if (playResult) {
          void playResult.catch(() => {
            setPreviewError('failed');
          });
        }
      })
      .catch(() => {
        setPreviewError('failed');
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  };

  const handlePickVoice = (voice: VoiceOption) => {
    stopCustomPreview();
    usePersonaStore.getState().setVoiceId(voice.id);
    setDialogOpen(false);
  };

  const previewErrorMessage =
    previewError === 'rate-limited'
      ? t('persona.voicePreviewRateLimited')
      : previewError === 'too-long'
        ? t('persona.voicePreviewTextTooLong')
        : previewError === 'failed'
          ? t('persona.voicePreviewFailed')
          : null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-muted-text">
          <MicIcon />
        </span>
        <div className="min-w-0 flex-1 basis-0 space-y-1" data-testid="selected-voice">
          {selected === null ? (
            <p className="text-sm text-muted-text">{t('persona.voicePickerNone')}</p>
          ) : (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{selectedLabel(selected)}</span>
                <VoiceTags voice={selected} />
              </span>
              {selected.description !== null && (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-text">{selected.description}</p>
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
                  ? 'border-ink bg-ink text-on-ink'
                  : 'border-line text-ink-soft hover:border-muted-text'
              }`}
            >
              <PlayIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={voicesQuery.data === undefined}
            className="flex-1 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-soft disabled:opacity-50 sm:flex-none"
          >
            {selected === null ? t('persona.voicePickerChoose') : t('persona.voicePickerChange')}
          </button>
        </div>
      </div>
      {selected !== null && voiceSampleName(selected) !== null && (
        <div className="mt-3 rounded-xl border border-line bg-card p-4">
          <label
            htmlFor="house-voice-preview-text"
            className="text-sm font-semibold text-ink"
          >
            {t('persona.voicePreviewTextLabel')}
          </label>
          <div className="mt-2 flex gap-2">
            <div className="min-w-0 flex-1">
              <input
                id="house-voice-preview-text"
                type="text"
                value={previewText}
                onChange={(event) => {
                  setPreviewText(event.target.value);
                  setPreviewError(null);
                }}
                placeholder={t('persona.voicePreviewTextPlaceholder')}
                disabled={previewLoading}
                className={INPUT_CLASS}
              />
            </div>
            <button
              type="button"
              onClick={playCustomPreview}
              disabled={previewLoading || previewText.trim() === ''}
              className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {previewLoading ? t('persona.voicePreviewListening') : t('persona.voicePreviewListen')}
            </button>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            {previewErrorMessage !== null ? (
              <p role="alert" className="text-xs text-red-600">
                {previewErrorMessage}
              </p>
            ) : (
              <span />
            )}
            <span
              className={`shrink-0 text-xs ${
                previewText.length > HOUSE_PREVIEW_TEXT_MAX_CHARS
                  ? 'font-semibold text-red-600'
                  : 'text-faint'
              }`}
            >
              {previewText.length}/{HOUSE_PREVIEW_TEXT_MAX_CHARS}
            </span>
          </div>
        </div>
      )}
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
