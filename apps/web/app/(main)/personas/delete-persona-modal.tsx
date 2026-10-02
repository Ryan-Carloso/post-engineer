'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import {
  deletePersona,
  fetchDeletePreview,
  type DeletePreview,
} from '@/lib/api';

//---------------
// DeletePersonaModal — two-step persona deletion.
//
// Step 1 (preview): GET /api/persona/delete-preview lists exactly what will
// be deleted (counts) plus per-video download links, so the user can save
// their videos first. Step 2 (confirm): the user types the persona name to
// arm the Delete button. Tokens are never refunded — the dialog says so
// explicitly, matching the API's deliberate product decision.
//---------------

interface DeletePersonaModalProps {
  persona: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}

type Phase = 'loading' | 'ready' | 'loadError' | 'deleting' | 'deleteError';

export function DeletePersonaModal({ persona, onClose, onDeleted }: DeletePersonaModalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [typedName, setTypedName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const loadedPersonaId = useRef<string | null>(null);

  useEffect(() => {
    if (!persona) {
      // The modal stays mounted while closed (persona flips to null); clear
      // the ref so reopening always re-arms the type-to-confirm gate.
      loadedPersonaId.current = null;
      return;
    }
    // A new persona resets everything; a retry (attempt bump, e.g. from the
    // links-incomplete note) keeps the typed confirmation name.
    const isNewPersona = loadedPersonaId.current !== persona.id;
    loadedPersonaId.current = persona.id;
    setPhase('loading');
    setPreview(null);
    if (isNewPersona) setTypedName('');
    let cancelled = false;
    // Rejections (network failure, non-JSON body) surface as loadError —
    // the dialog must never wedge in 'loading' with no retry.
    void fetchDeletePreview(persona.id)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPreview(result);
          setPhase('ready');
        } else {
          setPhase('loadError');
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('loadError');
      });
    return () => {
      cancelled = true;
    };
  }, [persona, attempt]);

  if (!persona) return null;

  const counts = preview?.counts;
  const videos = preview?.videos ?? [];
  const nameMatches = typedName === persona.name;

  const handleDelete = (): void => {
    if (!nameMatches || phase === 'deleting') return;
    setPhase('deleting');
    // A rejection after 'deleting' would disable Delete, Cancel and the
    // input at once — surface it as deleteError so the user can retry.
    void deletePersona(persona.id)
      .then((result) => {
        if (result.success) {
          onDeleted();
          onClose();
        } else {
          setPhase('deleteError');
        }
      })
      .catch(() => setPhase('deleteError'));
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-persona-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="delete-persona-title" className="text-lg font-semibold text-neutral-900">
          {t('personas.deleteDialogTitle')}
        </h2>

        {phase === 'loading' && (
          <p className="mt-4 text-sm text-neutral-500">{t('personas.deleteDialogIntro')}</p>
        )}

        {phase === 'loadError' && (
          <div className="mt-4">
            <p className="text-sm text-red-600">{t('personas.deleteDialogLoadError')}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              {t('personas.tryAgain')}
            </button>
          </div>
        )}

        {(phase === 'ready' || phase === 'deleting' || phase === 'deleteError') && counts && (
          <>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {t('personas.deleteDialogIntro')}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-neutral-800">
              <li>
                <strong className="font-semibold">{counts.schedules}</strong>{' '}
                {t(counts.schedules === 1 ? 'personas.deleteDialogSchedule' : 'personas.deleteDialogSchedules')}
              </li>
              <li>
                <strong className="font-semibold">{counts.upcomingSlots}</strong>{' '}
                {t(counts.upcomingSlots === 1 ? 'personas.deleteDialogSlot' : 'personas.deleteDialogSlots')}
              </li>
              <li>
                <strong className="font-semibold">{counts.generatedVideos}</strong>{' '}
                {t(counts.generatedVideos === 1 ? 'personas.deleteDialogVideo' : 'personas.deleteDialogVideos')}
              </li>
              <li>
                <strong className="font-semibold">{counts.personaImages}</strong>{' '}
                {t(counts.personaImages === 1 ? 'personas.deleteDialogImage' : 'personas.deleteDialogImages')}
              </li>
            </ul>

            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              {t('personas.deleteDialogNoRefund')}
            </div>

            {videos.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-neutral-700">
                  {t('personas.deleteDialogDownloadHint')}
                </p>
                {preview?.videosTruncated === true && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {t('personas.deleteDialogVideosTruncated', {
                      shown: videos.length,
                      total: counts?.generatedVideos ?? videos.length,
                    })}
                  </p>
                )}
                {preview?.linksIncomplete === true && (
                  <p className="mt-1 text-xs text-amber-700">
                    {t('personas.deleteDialogLinksIncomplete')}{' '}
                    <button
                      type="button"
                      onClick={() => setAttempt((n) => n + 1)}
                      className="font-medium underline hover:no-underline"
                    >
                      {t('personas.tryAgain')}
                    </button>
                  </p>
                )}
                <ul className="mt-2 space-y-1.5">
                  {videos.map((video, index) => (
                    <li
                      key={video.taskId ?? `video-${index}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-neutral-700">
                        {video.topic ?? video.taskId ?? `video-${index + 1}`}
                      </span>
                      {video.downloadUrl ? (
                        <a
                          href={video.downloadUrl}
                          download
                          className="shrink-0 font-medium text-blue-700 hover:underline"
                        >
                          {t('personas.deleteDialogDownload')}
                        </a>
                      ) : (
                        <span className="shrink-0 text-xs text-neutral-400">
                          {t('personas.deleteDialogDownloadUnavailable')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {phase === 'deleteError' && (
              <p className="mt-4 text-sm text-red-600">{t('personas.deleteDialogDeleteError')}</p>
            )}

            <label
              htmlFor="delete-persona-confirm-name"
              className="mt-5 block text-sm font-medium text-neutral-700"
            >
              {t('personas.deleteDialogTypeName')}
            </label>
            <input
              id="delete-persona-confirm-name"
              type="text"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={persona.name}
              autoComplete="off"
              disabled={phase === 'deleting'}
              aria-describedby={typedName !== '' && !nameMatches ? 'delete-persona-name-hint' : undefined}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-red-500 focus:outline-none"
            />
            {typedName !== '' && !nameMatches && (
              <p id="delete-persona-name-hint" className="mt-1.5 text-xs text-neutral-500">
                {t('personas.deleteDialogNameMismatch')}
              </p>
            )}
          </>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'deleting'}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            {t('personas.cancel')}
          </button>
          {(phase === 'ready' || phase === 'deleting' || phase === 'deleteError') && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={!nameMatches || phase === 'deleting'}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
            >
              {phase === 'deleting' ? t('personas.delete') : t('personas.deleteConfirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
