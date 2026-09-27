'use client';

import { useRef, useState } from 'react';

import {
  useDeletePersonaImageMutation,
  usePersonaImagesQuery,
  useUpdatePersonaImageMutation,
  useUploadPersonaImageMutation,
  type PersonaImageRecord,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';

const MAX_LIBRARY_IMAGES = 10;

interface PendingImage {
  id: string;
  file: File;
  preview: string;
  tag: string;
  description: string;
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const images = imagesQuery.data ?? [];
  const full = images.length >= MAX_LIBRARY_IMAGES;

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
    setPending((prev) => [
      ...prev,
      ...files.map((file, index) => ({
        id: `${file.name}-${file.size}-${prev.length + index}`,
        file,
        preview: URL.createObjectURL(file),
        tag: '',
        description: '',
      })),
    ]);
    event.target.value = '';
  };

  const removePending = (id: string): void => {
    setPending((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((item) => item.id !== id);
    });
  };

  const updatePending = (id: string, patch: Partial<Pick<PendingImage, 'tag' | 'description'>>): void => {
    setPending((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const uploadPending = async (): Promise<void> => {
    setError(null);
    setUploading(true);
    try {
      for (const item of pending) {
        const result = await uploadMutation.mutateAsync({
          file: item.file,
          tag: item.tag.trim() || undefined,
          description: item.description.trim() || undefined,
        });
        if (!result.success) {
          setError(result.error ?? t('persona.libraryUploadError'));
          return;
        }
        URL.revokeObjectURL(item.preview);
      }
      setPending([]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section aria-label={t('persona.libraryLabel')}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-neutral-900">{t('persona.libraryLabel')}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
          {t('persona.libraryCount', { count: images.length })}
        </span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
      <p className="mt-2 text-sm text-neutral-500">{t('persona.libraryHint')}</p>

      {imagesQuery.isError ? (
        <p className="mt-3 text-sm text-red-600">{t('persona.libraryLoadError')}</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {images.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <LibraryImageCard key={image.id} image={image} personaId={personaId} />
          ))}
        </div>
      ) : imagesQuery.isPending ? null : (
        <p className="mt-3 text-sm text-neutral-500">{t('persona.libraryEmpty')}</p>
      )}

      {full ? (
        <p className="mt-3 text-sm text-amber-700">{t('persona.libraryLimitReached')}</p>
      ) : (
        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            {t('persona.libraryAdd')}
          </button>
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
                  maxLength={100}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <input
                  value={item.description}
                  onChange={(event) => updatePending(item.id, { description: event.target.value })}
                  placeholder={t('persona.libraryDescriptionPlaceholder')}
                  maxLength={500}
                  className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => removePending(item.id)}
                className="self-start text-sm text-neutral-500 hover:text-red-600"
              >
                {t('persona.libraryRemove')}
              </button>
            </div>
          ))}
          {pending.length > 0 ? (
            <button
              type="button"
              onClick={uploadPending}
              disabled={uploading}
              className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {uploading ? t('persona.libraryUploading') : t('persona.libraryAdd')}
            </button>
          ) : null}
        </div>
      )}
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

  const save = async (): Promise<void> => {
    const result = await updateMutation.mutateAsync({
      id: image.id,
      tag: tag.trim(),
      description: description.trim(),
    });
    if (result.success) setEditing(false);
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(t('persona.libraryRemoveConfirm'))) return;
    await deleteMutation.mutateAsync(image.id);
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
      {image.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.image_url} alt={image.tag ?? ''} className="aspect-square w-full object-cover" />
      ) : (
        <div className="aspect-square w-full bg-neutral-200" />
      )}
      {image.is_primary ? (
        <span className="absolute top-2 left-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">
          {t('persona.libraryPrimary')}
        </span>
      ) : null}
      <div className="space-y-1 p-2">
        {editing ? (
          <>
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder={t('persona.libraryTagPlaceholder')}
              maxLength={100}
              className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('persona.libraryDescriptionPlaceholder')}
              maxLength={500}
              className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs"
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
                className="text-xs text-neutral-500 underline"
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
              onClick={() => updateMutation.mutate({ id: image.id, isPrimary: true })}
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
            >
              ✎
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
