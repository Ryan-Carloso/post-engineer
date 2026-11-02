'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useUploadPersonaImageMutation } from '@/lib/api';
import { logClientError } from '@/lib/client-logger';
import { useI18n } from '@/lib/i18n/provider';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_PERSONA_IMAGES } from '@/lib/persona-image-select';
import { usePersonaStore } from '@/lib/store';
import { ImageIcon, formatFileSize } from '@/lib/ui';
import { mapPersonaImageError } from './persona-image-library';
import { partitionPickedImages, runUploadsInParallel, type UploadOutcome } from './persona-image-upload-queue';

const ACCEPT = [...ALLOWED_IMAGE_MIME_TYPES].join(',');
const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

//---------------
// PersonaPhotoPicker — multi-photo upload from the device. Creating: picks
// are staged in the store (first = avatar, the rest = creation-time library)
// and appended on every pick. Editing (`personaId`): picks go straight to
// the persona's image library, so earlier photos are never replaced.
//---------------
export const PersonaPhotoPicker = ({ personaId }: { personaId?: string }) => {
  const photo = usePersonaStore((s) => s.photo);
  const extraPhotos = usePersonaStore((s) => s.extraPhotos);
  const storedPhotoUrl = usePersonaStore((s) => s.storedPhotoUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadPersonaImageMutation(personaId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { t } = useI18n();

  const staged = useMemo(() => (photo ? [photo, ...extraPhotos] : []), [photo, extraPhotos]);
  const previews = useMemo(() => staged.map((file) => URL.createObjectURL(file)), [staged]);
  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview);
    },
    [previews],
  );

  const uploadToLibrary = async (files: File[]): Promise<void> => {
    setUploading(true);
    try {
      const outcomes = await runUploadsInParallel(files, async (file): Promise<UploadOutcome<string>> => {
        try {
          const result = await uploadMutation.mutateAsync({ file });
          if (!result.success) {
            return { ok: false, error: mapPersonaImageError(result.error, t, 'persona.libraryUploadError') };
          }
          return { ok: true, warnings: result.warnings ?? [] };
        } catch (uploadError) {
          logClientError('[persona-photo-picker] upload failed', uploadError);
          return { ok: false, error: t('persona.libraryUploadError') };
        }
      });
      const failed = outcomes.find((outcome) => outcome !== undefined && !outcome.ok);
      if (failed && !failed.ok) setError(failed.error);
    } finally {
      setUploading(false);
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { picked, rejectedCount } = partitionPickedImages(Array.from(e.target.files ?? []));
    e.target.value = '';
    const messages: string[] = [];
    if (rejectedCount > 0) {
      messages.push(t('persona.libraryFilesRejected', { count: rejectedCount, sizeMb: MAX_IMAGE_MB }));
    }
    if (personaId) {
      setError(messages.length > 0 ? messages.join(' ') : null);
      if (picked.length > 0) void uploadToLibrary(picked);
      return;
    }
    if (staged.length + picked.length > MAX_PERSONA_IMAGES) {
      messages.push(t('persona.libraryLimitReached', { max: MAX_PERSONA_IMAGES }));
    }
    setError(messages.length > 0 ? messages.join(' ') : null);
    usePersonaStore.getState().addPhotos(picked);
  };

  const input = (
    <input ref={inputRef} type="file" accept={ACCEPT} multiple onChange={handlePick} className="hidden" />
  );
  const pickButton = (label: string, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
    >
      {label}
    </button>
  );

  // Edit mode with nothing picked: show the photo already stored, so the tab
  // is not an empty uploader for a persona that clearly has a face.
  if (staged.length === 0 && storedPhotoUrl) {
    return (
      <div className="mt-4">
        <div className="flex items-center gap-3 rounded-lg border border-neutral-300 bg-white p-3">
          <Image
            src={storedPhotoUrl}
            alt={t('persona.photoLabel')}
            width={56}
            height={96}
            unoptimized
            className="aspect-9/16 h-24 w-14 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-900">{t('persona.photoCurrent')}</div>
          </div>
          {pickButton(t('persona.photoUpload'), uploading)}
          {input}
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-4">
      {input}
      {staged.length > 0 ? (
        <ul className="space-y-2">
          {staged.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-3 rounded-lg border border-neutral-300 bg-white p-3"
            >
              <Image
                src={previews[index]}
                alt={t('persona.photoLabel')}
                width={56}
                height={96}
                unoptimized
                className="aspect-9/16 h-24 w-14 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-900">{file.name}</div>
                <div className="mt-0.5 text-xs text-neutral-500">{formatFileSize(file.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => usePersonaStore.getState().removePhoto(index)}
                className="text-xs font-medium text-neutral-500 hover:text-neutral-800 hover:underline"
              >
                {t('persona.libraryRemove')}
              </button>
            </li>
          ))}
          <li>{pickButton(t('persona.photoUpload'), staged.length >= MAX_PERSONA_IMAGES)}</li>
        </ul>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="group flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-white px-6 py-8 text-sm font-medium text-neutral-700 transition-colors hover:border-accent/60 hover:bg-red-50/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors group-hover:bg-red-100 group-hover:text-accent">
            <ImageIcon />
          </span>
          <span>{t('persona.photoUpload')}</span>
        </button>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{error}</p> : null}
      <p className="mt-3 text-sm leading-5 text-neutral-600">{t('persona.photoHint', { max: MAX_PERSONA_IMAGES })}</p>
    </div>
  );
};
