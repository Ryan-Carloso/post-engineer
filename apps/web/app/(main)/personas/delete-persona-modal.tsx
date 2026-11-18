'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import {
  deletePersona,
  fetchDeletePreview,
  type DeletePreview,
} from '@/lib/api';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const personaId = persona?.id ?? null;

  useEffect(() => {
    if (phase === 'ready') {
      nameInputRef.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (!personaId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'deleting') {
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href]',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, phase, personaId]);

  useEffect(() => {
    if (!personaId) {
      loadedPersonaId.current = null;
      return;
    }
    const isNewPersona = loadedPersonaId.current !== personaId;
    loadedPersonaId.current = personaId;
    setPhase('loading');
    setPreview(null);
    if (isNewPersona) setTypedName('');
    let cancelled = false;
    void fetchDeletePreview(personaId)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPreview(result);
          setPhase('ready');
        } else if (result.code === 'PERSONA_NOT_FOUND') {
          onDeleted();
          onClose();
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
  }, [personaId, attempt]);

  if (!persona) return null;

  const counts = preview?.counts;
  const videos = preview?.videos ?? [];
  const nameMatches = typedName === persona.name;

  const handleDelete = (): void => {
    if (!nameMatches || phase === 'deleting') return;
    setPhase('deleting');
    void deletePersona(persona.id)
      .then((result) => {
        if (result.success) {
          onDeleted();
          onClose();
        } else if (result.code === 'PERSONA_NOT_FOUND') {
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
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-persona-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-xl">
        <h2 id="delete-persona-title" className="text-lg font-semibold text-ink">
          {t('personas.deleteDialogTitle')}
        </h2>

        {phase === 'loading' && (
          <p className="mt-4 text-sm text-muted-text">{t('personas.deleteDialogIntro')}</p>
        )}

        {phase === 'loadError' && (
          <div className="mt-4">
            <p className="text-sm text-destructive">{t('personas.deleteDialogLoadError')}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft hover:bg-surface"
            >
              {t('personas.tryAgain')}
            </button>
          </div>
        )}

        {(phase === 'ready' || phase === 'deleting' || phase === 'deleteError') && counts && (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-text">
              {t('personas.deleteDialogIntro')}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-ink">
              <li>
                <strong className="font-semibold">{counts.schedules}</strong>{' '}
                {t(counts.schedules === 1 ? 'personas.deleteDialogSchedule' : 'personas.deleteDialogSchedules')}
              </li>
              <li>
                <strong className="font-semibold">{counts.upcomingSlots}</strong>{' '}
                {t(counts.upcomingSlots === 1 ? 'personas.deleteDialogSlot' : 'personas.deleteDialogSlots')}
              </li>
              {counts.publishedSlots > 0 && (
                <li>
                  <strong className="font-semibold">{counts.publishedSlots}</strong>{' '}
                  {t(
                    counts.publishedSlots === 1
                      ? 'personas.deleteDialogPublishedSlot'
                      : 'personas.deleteDialogPublishedSlots',
                  )}
                </li>
              )}
              {counts.failedSlots > 0 && (
                <li>
                  <strong className="font-semibold">{counts.failedSlots}</strong>{' '}
                  {t(
                    counts.failedSlots === 1
                      ? 'personas.deleteDialogFailedSlot'
                      : 'personas.deleteDialogFailedSlots',
                  )}
                </li>
              )}
              <li>
                <strong className="font-semibold">{counts.generatedVideos}</strong>{' '}
                {t(counts.generatedVideos === 1 ? 'personas.deleteDialogVideo' : 'personas.deleteDialogVideos')}
              </li>
              <li>
                <strong className="font-semibold">{counts.personaImages}</strong>{' '}
                {t(counts.personaImages === 1 ? 'personas.deleteDialogImage' : 'personas.deleteDialogImages')}
              </li>
            </ul>

            <div className="mt-4 rounded-lg bg-warning-soft p-3 text-sm leading-6 text-warning">
              {t('personas.deleteDialogNoRefund')}
            </div>

            {videos.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-ink-soft">
                  {t('personas.deleteDialogDownloadHint')}
                </p>
                {preview?.videosTruncated === true && (
                  <p className="mt-1 text-xs text-muted-text">
                    {t('personas.deleteDialogVideosTruncated', {
                      shown: videos.length,
                      total: counts?.generatedVideos ?? videos.length,
                    })}
                  </p>
                )}
                {preview?.linksIncomplete === true && (
                  <p className="mt-1 text-xs text-warning">
                    {t('personas.deleteDialogLinksIncomplete')}{' '}
                    <button
                      type="button"
                      onClick={() => setAttempt((n) => n + 1)}
                      disabled={phase === 'deleting'}
                      className="font-medium underline hover:no-underline disabled:no-underline disabled:opacity-50"
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
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {video.title ?? video.taskId ?? `video-${index + 1}`}
                      </span>
                      {video.downloadUrl ? (
                        <a
                          href={video.downloadUrl}
                          download
                          className="shrink-0 font-medium text-info hover:underline"
                        >
                          {t('personas.deleteDialogDownload')}
                        </a>
                      ) : (
                        <span className="shrink-0 text-xs text-faint">
                          {t('personas.deleteDialogDownloadUnavailable')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {phase === 'deleteError' && (
              <p className="mt-4 text-sm text-destructive">{t('personas.deleteDialogDeleteError')}</p>
            )}

            <label
              htmlFor="delete-persona-confirm-name"
              className="mt-5 block text-sm font-medium text-ink-soft"
            >
              {t('personas.deleteDialogTypeName')}
            </label>
            <input
              ref={nameInputRef}
              id="delete-persona-confirm-name"
              type="text"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={persona.name}
              autoComplete="off"
              disabled={phase === 'deleting'}
              aria-describedby={typedName !== '' && !nameMatches ? 'delete-persona-name-hint' : undefined}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-destructive focus:outline-none"
            />
            {typedName !== '' && !nameMatches && (
              <p id="delete-persona-name-hint" className="mt-1.5 text-xs text-muted-text">
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
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-50"
          >
            {t('personas.cancel')}
          </button>
          {(phase === 'ready' || phase === 'deleting' || phase === 'deleteError') && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={!nameMatches || phase === 'deleting'}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive-hover disabled:opacity-40"
            >
              {t('personas.deleteConfirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
