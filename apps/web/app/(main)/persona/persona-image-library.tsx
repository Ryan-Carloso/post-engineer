'use client';

import { useEffect, useRef, useState } from 'react';

import {
  useDeletePersonaImageMutation,
  usePersonaImagesQuery,
  useUpdatePersonaImageMutation,
  useUploadPersonaImageMutation,
  type ImageMutationResult,
  type PersonaImageRecord,
} from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/provider';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PERSONA_IMAGES,
  PERSONA_IMAGE_WARNING_CODES,
} from '@/lib/persona-image-select';
import { logClientError } from '@/lib/client-logger';
import { partitionPickedImages, runUploadsInParallel, type UploadOutcome } from './persona-image-upload-queue';

const MAX_LIBRARY_IMAGES = MAX_PERSONA_IMAGES;

let nextPendingId = 0;

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  tag: string;
  description: string;
}

const WARNING_KEYS: Record<string, TranslationKey> = {
  [PERSONA_IMAGE_WARNING_CODES.PRIMARY_SWAP_FAILED]: 'persona.libraryWarningPrimarySwap',
  [PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED]: 'persona.libraryWarningMetadataSave',
  [PERSONA_IMAGE_WARNING_CODES.ROW_REFETCH_FAILED]: 'persona.libraryWarningRowRefetch',
};

export function mapPersonaImageWarnings(
  codes: string[],
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  return codes.map((code) => {
    const key = WARNING_KEYS[code];
    return key ? t(key) : t('persona.libraryWarningUnknown');
  }).join(' ');
}

const ERROR_CLASS_PATTERNS: Array<{
  test: (error: string) => boolean;
  key: TranslationKey;
}> = [
  {
    test: (error) => /^Image library is full \(\d+ images max\)\.$/.test(error),
    key: 'persona.libraryErrorFull',
  },
  {
    test: (error) => error === 'Voiceover persona must not include library images.',
    key: 'persona.libraryErrorVoiceover',
  },
  {
    test: (error) => /^(tag|description) must be at most \d+ characters\.$/.test(error),
    key: 'persona.libraryErrorTooLong',
  },
  {
    test: (error) => error === 'Image not found.' || error === 'Persona not found.',
    key: 'persona.libraryErrorNotFound',
  },
];

export function mapPersonaImageError(
  error: string | undefined,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  fallbackKey: TranslationKey,
): string {
  if (error) {
    const match = ERROR_CLASS_PATTERNS.find(({ test }) => test(error));
    if (match) return t(match.key);
  }
  return t(fallbackKey);
}

export function PersonaImageLibrarySection({ personaId }: { personaId: string }) {
  const { t } = useI18n();
  const imagesQuery = usePersonaImagesQuery(personaId);
  const uploadMutation = useUploadPersonaImageMutation(personaId);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const livePreviewsRef = useRef<Set<string>>(new Set());

  const images = imagesQuery.data ?? [];
  const full = images.length >= MAX_LIBRARY_IMAGES;

  useEffect(() => {
    const live = livePreviewsRef.current;

    return () => {
      for (const preview of live) URL.revokeObjectURL(preview);
      live.clear();
    };
  }, []);

  const trackPreview = (preview: string): void => {
    livePreviewsRef.current.add(preview);
  };

  const dropPreview = (preview: string): void => {
    livePreviewsRef.current.delete(preview);
    URL.revokeObjectURL(preview);
  };

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setError(null);
    setWarning(null);
    const room = MAX_LIBRARY_IMAGES - images.length - pending.length;
    const all = Array.from(event.target.files ?? []);
    const { picked, rejectedCount } = partitionPickedImages(all);
    const accepted = picked.slice(0, Math.max(room, 0));
    const messages: string[] = [];
    if (picked.length > accepted.length) {
      messages.push(t('persona.libraryLimitReached', { max: MAX_LIBRARY_IMAGES }));
    }
    if (rejectedCount > 0) {
      messages.push(t('persona.libraryFilesRejected', { count: rejectedCount, sizeMb: MAX_IMAGE_BYTES / (1024 * 1024) }));
    }
    if (messages.length > 0) setError(messages.join(' '));
    setPending((prev) => [
      ...prev,
      ...accepted.map((file) => {
        const preview = URL.createObjectURL(file);
        trackPreview(preview);
        return {
          id: typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `pending-${nextPendingId++}`,
          file,
          preview,
          tag: '',
          description: '',
        };
      }),
    ]);
    event.target.value = '';
  };

  const removePending = (id: string): void => {
    const target = pending.find((item) => item.id === id);
    if (target) dropPreview(target.preview);
    setPending((prev) => prev.filter((item) => item.id !== id));
  };

  const updatePending = (id: string, patch: Partial<Pick<PendingImage, 'tag' | 'description'>>): void => {
    setPending((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const uploadPending = async (): Promise<void> => {
    setError(null);
    setWarning(null);
    setUploading(true);
    const uploadedIds = new Set<string>();
    const uploadedPreviews: string[] = [];
    const warnings: string[] = [];
    try {
      const outcomes = await runUploadsInParallel(pending, async (item): Promise<UploadOutcome<string>> => {
        let result: ImageMutationResult;
        try {
          result = await uploadMutation.mutateAsync({
            file: item.file,
            tag: item.tag.trim() || undefined,
            description: item.description.trim() || undefined,
          });
        } catch (uploadError) {
          logClientError('[persona-image-library] upload failed', uploadError);
          return { ok: false, error: t('persona.libraryUploadError') };
        }
        if (!result.success) {
          return { ok: false, error: mapPersonaImageError(result.error, t, 'persona.libraryUploadError') };
        }
        return { ok: true, warnings: result.warnings ?? [] };
      });
      pending.forEach((item, index) => {
        const outcome = outcomes[index];
        if (outcome === undefined) return;
        if (!outcome.ok) {
          setError((prev) => prev ?? `${outcome.error} (${item.file.name})`);
          return;
        }
        uploadedIds.add(item.id);
        uploadedPreviews.push(item.preview);
        warnings.push(...outcome.warnings);
      });
      setPending((prev) => prev.filter((item) => !uploadedIds.has(item.id)));
      queueMicrotask(() => {
        for (const preview of uploadedPreviews) dropPreview(preview);
      });
      if (warnings.length > 0) {
        setWarning(mapPersonaImageWarnings(warnings, t));
      }
    } finally {
      setUploading(false);
    }
  };

  const showEmptyState =
    images.length === 0 && !imagesQuery.isPending && !imagesQuery.isError;

  return (
    <section aria-label={t('persona.libraryLabel')}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink">{t('persona.libraryLabel')}</span>
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted-text">
          {t('persona.libraryCount', { count: images.length, max: MAX_LIBRARY_IMAGES })}
        </span>
        <span className="h-px flex-1 bg-sunken" />
      </div>
      <p className="mt-2 text-sm text-muted-text">{t('persona.libraryHint', { max: MAX_LIBRARY_IMAGES, sizeMb: MAX_IMAGE_BYTES / (1024 * 1024) })}</p>

      {imagesQuery.isError ? (
        <p className="mt-3 text-sm text-destructive">{t('persona.libraryLoadError')}</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {warning ? <p className="mt-3 text-sm text-warning">{warning}</p> : null}

      {images.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <LibraryImageCard key={image.id} image={image} personaId={personaId} />
          ))}
        </div>
      ) : showEmptyState ? (
        <p className="mt-3 text-sm text-muted-text">{t('persona.libraryEmpty', { max: MAX_LIBRARY_IMAGES })}</p>
      ) : null}

      {full ? (
        <p className="mt-3 text-sm text-warning">{t('persona.libraryLimitReached', { max: MAX_LIBRARY_IMAGES })}</p>
      ) : (
        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ALLOWED_IMAGE_MIME_TYPES].join(',')}
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            {t('persona.libraryAdd')}
          </button>
        </div>
      )}
      {pending.length > 0 ? (
        <div className="mt-3 space-y-3">
          {pending.map((item) => (
            <div key={item.id} className="mt-3 flex gap-3 rounded-lg border border-line p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.preview}
                alt=""
                className="size-20 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={item.tag}
                  onChange={(event) => updatePending(item.id, { tag: event.target.value })}
                  placeholder={t('persona.libraryTagPlaceholder')}
                  aria-label={t('persona.libraryTag')}
                  maxLength={100}
                  disabled={uploading}
                  className="w-full rounded-md border border-line px-2 py-1.5 text-sm disabled:opacity-50"
                />
                <input
                  value={item.description}
                  onChange={(event) => updatePending(item.id, { description: event.target.value })}
                  placeholder={t('persona.libraryDescriptionPlaceholder')}
                  aria-label={t('persona.libraryDescription')}
                  maxLength={500}
                  disabled={uploading}
                  className="w-full rounded-md border border-line px-2 py-1.5 text-sm disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => removePending(item.id)}
                disabled={uploading}
                className="self-start text-sm text-muted-text hover:text-destructive disabled:opacity-50"
              >
                {t('persona.libraryRemove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={uploadPending}
            disabled={uploading}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-on-ink disabled:opacity-50"
          >
            {uploading ? t('persona.libraryUploading') : t('persona.libraryUpload')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LibraryImageCard({
  image,
  personaId,
}: {
  image: PersonaImageRecord;
  personaId: string;
}) {
  const { t } = useI18n();
  const updateMutation = useUpdatePersonaImageMutation(personaId);
  const deleteMutation = useDeletePersonaImageMutation(personaId);
  const [editing, setEditing] = useState(false);
  const [tag, setTag] = useState(image.tag ?? '');
  const [description, setDescription] = useState(image.description ?? '');
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardWarning, setCardWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setTag(image.tag ?? '');
      setDescription(image.description ?? '');
    }
  }, [editing, image.tag, image.description]);

  const save = async (): Promise<void> => {
    setCardError(null);
    setCardWarning(null);
    try {
      const result = await updateMutation.mutateAsync({
        id: image.id,
        tag: tag.trim(),
        description: description.trim(),
      });
      if (result.success) {
        const metadataFailed =
          result.warnings?.includes(PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED) ?? false;
        if (!metadataFailed) setEditing(false);
        if (result.warnings && result.warnings.length > 0) {
          setCardWarning(mapPersonaImageWarnings(result.warnings, t));
        }
      } else {
        setCardError(mapPersonaImageError(result.error, t, 'persona.libraryUpdateError'));
      }
    } catch (saveError) {
      logClientError('[persona-image-library] update failed', saveError);
      setCardError(t('persona.libraryUpdateError'));
    }
  };

  const setPrimary = async (): Promise<void> => {
    setCardError(null);
    setCardWarning(null);
    try {
      const result = await updateMutation.mutateAsync({ id: image.id, isPrimary: true });
      if (!result.success) {
        setCardError(mapPersonaImageError(result.error, t, 'persona.libraryUpdateError'));
      } else if (result.warnings && result.warnings.length > 0) {
        setCardWarning(mapPersonaImageWarnings(result.warnings, t));
      }
    } catch (primaryError) {
      logClientError('[persona-image-library] set primary failed', primaryError);
      setCardError(t('persona.libraryUpdateError'));
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(t('persona.libraryRemoveConfirm'))) return;
    setCardError(null);
    setCardWarning(null);
    try {
      const result = await deleteMutation.mutateAsync(image.id);
      if (!result.success) {
        setCardError(mapPersonaImageError(result.error, t, 'persona.libraryDeleteError'));
      }
    } catch (deleteError) {
      logClientError('[persona-image-library] delete failed', deleteError);
      setCardError(t('persona.libraryDeleteError'));
    }
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface">
      {image.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.image_url} alt={image.tag ?? ''} className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-sunken p-2 text-center text-xs text-muted-text">
          {image.image_url_error ? t('persona.libraryImageUrlError') : null}
        </div>
      )}
      {image.is_primary ? (
        <span className="absolute top-2 left-2 rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-on-ink">
          {t('persona.libraryPrimary')}
        </span>
      ) : null}
      <div className="space-y-1 p-2">
        {cardError ? <p className="text-xs text-destructive">{cardError}</p> : null}
        {cardWarning ? <p className="text-xs text-warning">{cardWarning}</p> : null}
        {editing ? (
          <>
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder={t('persona.libraryTagPlaceholder')}
              maxLength={100}
              disabled={updateMutation.isPending}
              className="w-full rounded border border-line px-1.5 py-1 text-xs disabled:opacity-50"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('persona.libraryDescriptionPlaceholder')}
              maxLength={500}
              disabled={updateMutation.isPending}
              className="w-full rounded border border-line px-1.5 py-1 text-xs disabled:opacity-50"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={updateMutation.isPending}
                className="text-xs font-medium text-ink underline disabled:opacity-50"
              >
                {t('persona.librarySave')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTag(image.tag ?? '');
                  setDescription(image.description ?? '');
                }}
                disabled={updateMutation.isPending}
                className="text-xs text-muted-text underline disabled:opacity-50"
              >
                {t('persona.libraryCancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="truncate text-xs font-medium text-ink">
              {image.tag || '—'}
            </p>
            <p className="line-clamp-2 text-xs text-muted-text">{image.description || '—'}</p>
          </>
        )}
        <div className="flex items-center gap-2 pt-1">
          {!image.is_primary ? (
            <button
              type="button"
              onClick={setPrimary}
              disabled={updateMutation.isPending}
              className="text-xs text-muted-text underline disabled:opacity-50"
            >
              {t('persona.librarySetPrimary')}
            </button>
          ) : null}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-muted-text underline"
              aria-label={t('persona.libraryEdit')}
            >
              {t('persona.libraryEdit')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={remove}
            disabled={deleteMutation.isPending}
            className="text-xs text-muted-text underline hover:text-destructive disabled:opacity-50"
          >
            {t('persona.libraryRemove')}
          </button>
        </div>
      </div>
    </div>
  );
}
