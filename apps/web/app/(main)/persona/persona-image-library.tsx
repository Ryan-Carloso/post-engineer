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

// Single source of truth for the library cap; the picker limit, the
// server count check, and the SQL trigger all derive from this value.
const MAX_LIBRARY_IMAGES = MAX_PERSONA_IMAGES;

// Module-level counter for pending-item ids when crypto.randomUUID is
// unavailable (non-secure contexts). Collision-free within the session,
// unlike Date.now()+Math.random().
let nextPendingId = 0;

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  tag: string;
  description: string;
}

// Map server warning codes to localized messages; unknown codes map to a
// localized generic message so new server warnings are neither silently
// dropped nor rendered as raw English slugs. Shared by the upload flow and
// the card flows so a new code is added in one place.

// Hoisted: the code→i18n-key map is static; rebuilding it per warning
// message would re-allocate the object on every call.
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
    // Unknown codes are never silently dropped — but a raw English slug
    // must never reach the UI either: a future server code the client
    // doesn't know yet maps to a localized generic message.
    return key ? t(key) : t('persona.libraryWarningUnknown');
  }).join(' ');
}

// Server failure classes the UI renders with specific localized copy.
// Dynamic server strings (interpolated limits) match by shape so a limit
// change can't silently fall through to the generic message. Unknown
// server errors fall back to the generic localized message: the raw
// English server string must never reach the UI.
const ERROR_CLASS_PATTERNS: Array<{
  test: (error: string) => boolean;
  key: TranslationKey;
}> = [
  {
    test: (error) => /^Image library is full \(\d+ images max\)\.$/.test(error),
    key: 'persona.libraryErrorFull',
  },
  {
    test: (error) => error === 'Faceless persona must not include library images.',
    key: 'persona.libraryErrorFaceless',
  },
  {
    test: (error) => error === 'The image content does not match its declared file type.',
    key: 'persona.libraryErrorContentMismatch',
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

//---------------
// PersonaImageLibrarySection — up to 10 tagged photos of the same person.
// Shown when editing an existing persona. Each video generation picks the
// best-matching image deterministically (explicit override, tag match,
// primary, recent-use exclusion).
//---------------
export function PersonaImageLibrarySection({ personaId }: { personaId: string }) {
  const { t } = useI18n();
  const imagesQuery = usePersonaImagesQuery(personaId);
  const uploadMutation = useUploadPersonaImageMutation(personaId);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Partial-success notes (e.g. the image uploaded but the primary swap
  // failed): success:true with warnings must not look like a full success.
  const [warning, setWarning] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks live preview URLs so they can be revoked if the component
  // unmounts while items are still pending.
  const livePreviewsRef = useRef<Set<string>>(new Set());

  const images = imagesQuery.data ?? [];
  const full = images.length >= MAX_LIBRARY_IMAGES;

  // Revoke any previews still alive on unmount (navigation away mid-queue).
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
    // Rejected files are a silent failure if dropped without feedback: tell
    // the user which picks were skipped and why instead of losing them.
    const picked: File[] = [];
    let rejectedCount = 0;
    for (const file of all) {
      // The explicit allowlist is the whole check: a bare startsWith('image/')
      // would also accept image/gif or image/svg+xml, which the server
      // rejects — keep client and server in agreement.
      if (
        ALLOWED_IMAGE_MIME_TYPES.has(file.type) &&
        file.size > 0 &&
        file.size <= MAX_IMAGE_BYTES
      ) {
        picked.push(file);
      } else {
        rejectedCount += 1;
      }
    }
    const accepted = picked.slice(0, Math.max(room, 0));
    // Both conditions are reported when they co-occur: otherwise a user
    // whose picks were dropped for type/size reasons only sees the limit
    // message and gets no signal about the real problem.
    const messages: string[] = [];
    if (picked.length > accepted.length) {
      // Either the library is full or the picker selection overflowed the
      // remaining room — the server re-validates on upload either way.
      messages.push(t('persona.libraryLimitReached', { max: MAX_LIBRARY_IMAGES }));
    }
    if (rejectedCount > 0) {
      messages.push(t('persona.libraryFilesRejected', { count: rejectedCount }));
    }
    if (messages.length > 0) setError(messages.join(' '));
    setPending((prev) => [
      ...prev,
      ...accepted.map((file) => {
        const preview = URL.createObjectURL(file);
        trackPreview(preview);
        return {
          // crypto.randomUUID is undefined in non-secure contexts (plain
          // HTTP): fall back to a module-level counter so file pick never
          // throws and ids cannot collide.
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
    // Side effects must not run inside the state updater: StrictMode invokes
    // updaters twice, so revoke the preview outside the update.
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
      // Sequential on purpose: stop at the first failure so the user sees
      // one actionable error instead of N parallel failures, and completed
      // items can leave the queue while failed/untried ones stay retryable.
      for (const item of pending) {
        let result: ImageMutationResult;
        try {
          result = await uploadMutation.mutateAsync({
            file: item.file,
            tag: item.tag.trim() || undefined,
            description: item.description.trim() || undefined,
          });
        } catch (uploadError) {
          console.error('[persona-image-library] upload failed', { error: uploadError });
          setError(`${t('persona.libraryUploadError')} (${item.file.name})`);
          break;
        }
        if (!result.success) {
          setError(
            `${mapPersonaImageError(result.error, t, 'persona.libraryUploadError')} (${item.file.name})`,
          );
          break;
        }
        uploadedIds.add(item.id);
        // Collect the preview for revocation AFTER setPending below: the
        // item is still rendered until the queue updates, and revoking
        // early would show a broken image on any re-render in between.
        uploadedPreviews.push(item.preview);
        if (result.warnings) warnings.push(...result.warnings);
      }
      // On partial failure the already-uploaded items leave the queue; only
      // the failed (and not-yet-tried) items stay so the user can retry.
      setPending((prev) => prev.filter((item) => !uploadedIds.has(item.id)));
      // Defer revocation until after the queue update commits: setPending is
      // async, so revoking synchronously here could let a removed card
      // render one frame with a revoked blob URL (broken image flash).
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

  // Extracted so the JSX below has no nested ternary: the empty state
  // shows only once loading finished without error.
  const showEmptyState =
    images.length === 0 && !imagesQuery.isPending && !imagesQuery.isError;

  return (
    <section aria-label={t('persona.libraryLabel')}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-neutral-900">{t('persona.libraryLabel')}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {t('persona.libraryCount', { count: images.length, max: MAX_LIBRARY_IMAGES })}
        </span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
      <p className="mt-2 text-sm text-neutral-500">{t('persona.libraryHint')}</p>

      {imagesQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">{t('persona.libraryLoadError')}</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {warning ? <p className="mt-3 text-sm text-amber-700">{warning}</p> : null}

      {images.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <LibraryImageCard key={image.id} image={image} personaId={personaId} />
          ))}
        </div>
      ) : showEmptyState ? (
        <p className="mt-3 text-sm text-neutral-500">{t('persona.libraryEmpty')}</p>
      ) : null}

      {/* The pending queue renders outside the full/partial conditional: a
          refetch that fills the library must not silently hide queued items
          (with their upload button) while their previews stay alive. */}
      {full ? (
        <p className="mt-3 text-sm text-amber-700">{t('persona.libraryLimitReached', { max: MAX_LIBRARY_IMAGES })}</p>
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
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
          >
            {t('persona.libraryAdd')}
          </button>
        </div>
      )}
      {pending.length > 0 ? (
        <div className="mt-3 space-y-3">
          {pending.map((item) => (
            <div key={item.id} className="mt-3 flex gap-3 rounded-lg border border-neutral-200 p-3">
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
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm disabled:opacity-50"
                />
                <input
                  value={item.description}
                  onChange={(event) => updatePending(item.id, { description: event.target.value })}
                  placeholder={t('persona.libraryDescriptionPlaceholder')}
                  aria-label={t('persona.libraryDescription')}
                  maxLength={500}
                  disabled={uploading}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm disabled:opacity-50"
                />
              </div>
              {/* Disabled while uploading: removePending would revoke the
                  preview and drop the item from state, but the upload loop
                  captured the queue at render time and would still store
                  the cancelled file on the server. */}
              <button
                type="button"
                onClick={() => removePending(item.id)}
                disabled={uploading}
                className="self-start text-sm text-neutral-500 hover:text-red-600 disabled:opacity-50"
              >
                {t('persona.libraryRemove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={uploadPending}
            disabled={uploading}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {uploading ? t('persona.libraryUploading') : t('persona.libraryUpload')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

//---------------
// LibraryImageCard — thumbnail with tag/description, primary toggle,
// inline metadata edit, and delete.
//---------------
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
  // Partial-success warnings (e.g. metadata saved but primary swap failed)
  // are not errors; render them amber so the true state isn't misleading.
  const [cardWarning, setCardWarning] = useState<string | null>(null);

  // The card keeps local copies for the inline editor. Sync them when the
  // library refetches (mutation invalidation) so a later edit starts from
  // fresh data — but never clobber an in-progress edit.
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
        // The metadata was NOT persisted on METADATA_SAVE_FAILED: keep the
        // editor open so the user can retry instead of losing their input
        // to the refetch sync.
        const metadataFailed =
          result.warnings?.includes(PERSONA_IMAGE_WARNING_CODES.METADATA_SAVE_FAILED) ?? false;
        if (!metadataFailed) setEditing(false);
        // Partial success (e.g. primary swap failed after metadata save):
        // surface the warning codes so the user knows the true state.
        if (result.warnings && result.warnings.length > 0) {
          setCardWarning(mapPersonaImageWarnings(result.warnings, t));
        }
      } else {
        setCardError(mapPersonaImageError(result.error, t, 'persona.libraryUpdateError'));
      }
    } catch (saveError) {
      console.error('[persona-image-library] update failed', { error: saveError });
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
        // Partial success: surface warning codes so the user knows the
        // true state (e.g. primary swapped but something else failed).
        setCardWarning(mapPersonaImageWarnings(result.warnings, t));
      }
    } catch (primaryError) {
      console.error('[persona-image-library] set primary failed', { error: primaryError });
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
      console.error('[persona-image-library] delete failed', { error: deleteError });
      setCardError(t('persona.libraryDeleteError'));
    }
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
      {image.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.image_url} alt={image.tag ?? ''} className="aspect-square w-full object-cover" />
      ) : (
        // A null URL with image_url_error means signing failed transiently;
        // a refetch re-signs, so tell the user it is retryable instead of
        // rendering a silently broken thumbnail.
        <div className="flex aspect-square w-full items-center justify-center bg-neutral-200 p-2 text-center text-xs text-neutral-500">
          {image.image_url_error ? t('persona.libraryImageUrlError') : null}
        </div>
      )}
      {image.is_primary ? (
        <span className="absolute top-2 left-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">
          {t('persona.libraryPrimary')}
        </span>
      ) : null}
      <div className="space-y-1 p-2">
        {cardError ? <p className="text-xs text-red-600">{cardError}</p> : null}
        {cardWarning ? <p className="text-xs text-amber-600">{cardWarning}</p> : null}
        {editing ? (
          <>
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder={t('persona.libraryTagPlaceholder')}
              maxLength={100}
              disabled={updateMutation.isPending}
              className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs disabled:opacity-50"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('persona.libraryDescriptionPlaceholder')}
              maxLength={500}
              disabled={updateMutation.isPending}
              className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs disabled:opacity-50"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={updateMutation.isPending}
                className="text-xs font-medium text-neutral-900 underline disabled:opacity-50"
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
                className="text-xs text-neutral-500 underline disabled:opacity-50"
              >
                {t('persona.libraryCancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="truncate text-xs font-medium text-neutral-800">
              {image.tag || '—'}
            </p>
            <p className="line-clamp-2 text-xs text-neutral-500">{image.description || '—'}</p>
          </>
        )}
        <div className="flex items-center gap-2 pt-1">
          {!image.is_primary ? (
            <button
              type="button"
              onClick={setPrimary}
              disabled={updateMutation.isPending}
              className="text-xs text-neutral-600 underline disabled:opacity-50"
            >
              {t('persona.librarySetPrimary')}
            </button>
          ) : null}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-600 underline"
              aria-label={t('persona.libraryEdit')}
            >
              {t('persona.libraryEdit')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={remove}
            disabled={deleteMutation.isPending}
            className="text-xs text-neutral-500 underline hover:text-red-600 disabled:opacity-50"
          >
            {t('persona.libraryRemove')}
          </button>
        </div>
      </div>
    </div>
  );
}
