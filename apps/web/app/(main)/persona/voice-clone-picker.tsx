'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  MAX_CLONE_REFERENCE_SECONDS,
  MIN_CLONE_REFERENCE_SECONDS,
  validateCloneReferenceBuffer,
} from '@/lib/cloned-voice-audio';
import type { ClonedVoicePublicRow } from '@/lib/cloned-voices-types';
import {
  createClonedVoice,
  deleteClonedVoice,
  fetchClonedVoice,
  fetchClonedVoices,
  clonedVoicePreviewUrl,
} from '@/lib/cloned-voices-client';
import { usePersonaStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { CheckIcon, MicIcon, SpinnerIcon, TrashIcon } from '@/lib/ui';
import { useVoiceSampleLanguagesQuery } from '@/lib/api';

const POLL_MS = 2500;
const RECORD_SOFT_LIMIT_SECONDS = 45;

const VoiceTabButton = ({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onSelect}
    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
    }`}
  >
    {label}
  </button>
);

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export { VoiceTabButton };

/** Clone-my-voice tab panel (house grid is rendered by the parent). */
export const PersonaVoiceClonePanel = ({ personaLanguage }: { personaLanguage?: string }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sampleLanguagesQuery = useVoiceSampleLanguagesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  const [language, setLanguage] = useState(personaLanguage?.trim() || 'pt');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [activeCloneId, setActiveCloneId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const listQuery = useQuery({
    queryKey: ['cloned-voices'],
    queryFn: fetchClonedVoices,
    staleTime: 10_000,
  });

  const pollQuery = useQuery({
    queryKey: ['cloned-voice', activeCloneId],
    queryFn: () => fetchClonedVoice(activeCloneId as string),
    enabled: activeCloneId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'pending') {
        return POLL_MS;
      }
      return false;
    },
  });

  useEffect(() => {
    const status = pollQuery.data?.status;
    if (status === 'ready' || status === 'failed') {
      void queryClient.invalidateQueries({ queryKey: ['cloned-voices'] });
      void queryClient.invalidateQueries({ queryKey: ['persona-voices'] });
    }
  }, [pollQuery.data?.status, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (file: Blob) => {
      return createClonedVoice(file, language, consent);
    },
    onSuccess: (row) => {
      setActiveCloneId(row.id);
      setPendingBlob(null);
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['cloned-voices'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClonedVoice(id),
    onSuccess: (_data, deletedCloneId) => {
      if (deletedCloneId === activeCloneId) {
        setActiveCloneId(null);
      }
      const deletedClone = listQuery.data?.find((clone) => clone.id === deletedCloneId);
      const deletedVoiceId = deletedClone?.voice_id;
      if (
        deletedVoiceId !== null &&
        deletedVoiceId !== undefined &&
        deletedVoiceId === usePersonaStore.getState().voiceId
      ) {
        usePersonaStore.getState().setVoiceId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['cloned-voices'] });
      void queryClient.invalidateQueries({ queryKey: ['persona-voices'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder !== null && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setRecording(false);
  }, []);

  useEffect(() => () => { stopRecording(); }, [stopRecording]);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('persona.voiceCloneMicUnavailable'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordChunksRef.current, { type: mimeType });
        setPendingBlob(blob);
        setPreviewBlobUrl(URL.createObjectURL(blob));
        setRecordSeconds(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_CLONE_REFERENCE_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch {
      setError(t('persona.voiceCloneMicDenied'));
    }
  };

  const handleFilePick = async (file: File | null) => {
    setError(null);
    if (!file) {
      return;
    }
    const validation = validateCloneReferenceBuffer(new Uint8Array(await file.arrayBuffer()));
    if (!validation.ok) {
      // A failed pick must not leave a previous recording/pick submittable
      // behind the error message.
      setPendingBlob(null);
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl(null);
      }
      setError(validation.error);
      return;
    }
    setPendingBlob(file);
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
    }
    setPreviewBlobUrl(URL.createObjectURL(file));
  };

  const submitPending = () => {
    setError(null);
    if (!consent) {
      setError(t('persona.voiceCloneConsentRequired'));
      return;
    }
    if (!pendingBlob) {
      setError(t('persona.voiceCloneNeedAudio'));
      return;
    }
    createMutation.mutate(pendingBlob);
  };

  const playServerPreview = (clone: ClonedVoicePublicRow) => {
    previewAudioRef.current?.pause();
    const audio = new Audio(clonedVoicePreviewUrl(clone.id, clone.language));
    previewAudioRef.current = audio;
    void audio.play().catch(() => {
      setError(t('persona.voiceClonePreviewFailed'));
    });
  };

  const selectCloneForPersona = (clone: ClonedVoicePublicRow) => {
    if (clone.voice_id) {
      usePersonaStore.getState().setVoiceId(clone.voice_id);
    }
  };

  const voices = listQuery.data ?? [];
  const tracking = pollQuery.data;
  const isSubmitting = createMutation.isPending;

  return (
    <div className="space-y-4" data-testid="voice-clone-panel">
      <p className="text-sm leading-relaxed text-neutral-600">{t('persona.voiceCloneHint')}</p>
      <p className="rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-800">
        {t('persona.voiceCloneScript')}
      </p>

      <label className="block text-sm font-medium text-neutral-700">
        {t('persona.sampleLanguage')}
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="mt-2 h-11 w-full max-w-sm rounded-xl border border-neutral-300 bg-white px-3 text-sm"
          disabled={isSubmitting || recording}
        >
          {(sampleLanguagesQuery.data ?? [{ code: 'pt', label: 'Português' }]).map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-start gap-2 text-sm text-neutral-800">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={isSubmitting || recording}
          className="mt-1"
        />
        <span>{t('persona.voiceCloneConsent')}</span>
      </label>

      <div className="flex flex-wrap gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={isSubmitting}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:border-neutral-400"
          >
            {t('persona.voiceCloneRecord')}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-lg border border-accent bg-red-50 px-4 py-2 text-sm font-medium text-accent"
          >
            {t('persona.voiceCloneStop')} ({formatTimer(recordSeconds)} / {formatTimer(MAX_CLONE_REFERENCE_SECONDS)})
          </button>
        )}
        <label className="cursor-pointer rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:border-neutral-400">
          {t('persona.voiceCloneUpload')}
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/x-m4a"
            className="hidden"
            disabled={isSubmitting || recording}
            onChange={(e) => void handleFilePick(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <p className="text-xs text-neutral-500">
        {t('persona.voiceCloneDurationGuide', {
          min: MIN_CLONE_REFERENCE_SECONDS,
          max: MAX_CLONE_REFERENCE_SECONDS,
          soft: RECORD_SOFT_LIMIT_SECONDS,
        })}
      </p>

      {previewBlobUrl ? (
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="mb-2 text-sm font-medium text-neutral-800">{t('persona.voiceCloneLocalPreview')}</p>
          <audio controls src={previewBlobUrl} className="w-full" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (previewBlobUrl) {
                  URL.revokeObjectURL(previewBlobUrl);
                }
                setPreviewBlobUrl(null);
                setPendingBlob(null);
              }}
              className="text-sm text-neutral-600 hover:underline"
              disabled={isSubmitting}
            >
              {t('persona.voiceCloneRerecord')}
            </button>
            <button
              type="button"
              onClick={submitPending}
              disabled={isSubmitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <SpinnerIcon /> {t('persona.voiceCloneSubmitting')}
                </span>
              ) : (
                t('persona.voiceCloneSubmit')
              )}
            </button>
          </div>
        </div>
      ) : null}

      {tracking && tracking.status === 'pending' ? (
        <p className="flex items-center gap-2 text-sm text-neutral-700" role="status">
          <SpinnerIcon /> {t('persona.voiceClonePending')}
        </p>
      ) : null}
      {tracking && tracking.status === 'failed' ? (
        <p className="text-sm text-red-600" role="alert">
          {t('persona.voiceCloneFailed')}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {listQuery.isError ? (
        <p className="text-sm text-red-600">{t('persona.voiceCloneListError')}</p>
      ) : null}

      <ul className="space-y-2">
        {voices.map((clone) => {
          const isActive = clone.voice_id !== null && clone.voice_id === voiceId;
          const statusLabel =
            clone.status === 'ready'
              ? t('persona.voiceCloneStatusReady')
              : clone.status === 'pending'
                ? t('persona.voiceCloneStatusPending')
                : t('persona.voiceCloneStatusFailed');
          return (
            <li
              key={clone.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                isActive ? 'border-accent bg-red-50/40' : 'border-neutral-200'
              }`}
            >
              <MicIcon />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{clone.language ?? '—'}</span>
                <span className="ml-2 text-neutral-500">{statusLabel}</span>
              </span>
              {clone.status === 'ready' ? (
                <>
                  <button
                    type="button"
                    className="text-sm font-medium text-accent hover:underline"
                    onClick={() => playServerPreview(clone)}
                  >
                    {t('persona.voiceClonePlayPreview')}
                  </button>
                  <button
                    type="button"
                    className="text-sm font-medium text-neutral-900 hover:underline"
                    onClick={() => selectCloneForPersona(clone)}
                  >
                    {t('persona.voiceCloneUseOnPersona')}
                  </button>
                </>
              ) : null}
              {isActive ? <CheckIcon /> : null}
              <button
                type="button"
                aria-label={t('persona.voiceCloneDelete')}
                onClick={() => deleteMutation.mutate(clone.id)}
                disabled={deleteMutation.isPending}
                className="text-neutral-500 hover:text-red-600"
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
