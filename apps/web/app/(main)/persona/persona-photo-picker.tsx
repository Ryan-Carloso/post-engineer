'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';
import { ImageIcon, formatFileSize } from '@/lib/ui';

const ALLOWED_PHOTO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_MB = MAX_PHOTO_BYTES / (1024 * 1024);
const ACCEPT = ALLOWED_PHOTO_MIME_TYPES.join(',');

export const PersonaPhotoPicker = () => {
  const photo = usePersonaStore((s) => s.photo);
  const storedPhotoUrl = usePersonaStore((s) => s.storedPhotoUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (file === null) return;
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) {
      setError(t('persona.photoRejected', { sizeMb: MAX_PHOTO_MB }));
      return;
    }
    setError(null);
    usePersonaStore.getState().setPhoto(file);
  };

  const shownUrl = preview ?? storedPhotoUrl;
  const input = <input ref={inputRef} type="file" accept={ACCEPT} onChange={handlePick} className="hidden" />;

  return (
    <div className="mt-4">
      {input}
      {shownUrl !== null ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-card p-3">
          <Image
            src={shownUrl}
            alt={t('persona.photoLabel')}
            width={96}
            height={96}
            unoptimized
            className="size-24 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">
              {photo ? photo.name : t('persona.photoCurrent')}
            </div>
            {photo ? (
              <div className="mt-0.5 text-xs text-muted-text">{formatFileSize(photo.size)}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-medium text-accent hover:underline"
          >
            {t('persona.photoUpload')}
          </button>
          {photo ? (
            <button
              type="button"
              onClick={() => usePersonaStore.getState().setPhoto(null)}
              className="text-xs font-medium text-muted-text hover:text-ink hover:underline"
            >
              {t('persona.photoRemove')}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-card px-6 py-8 text-sm font-medium text-ink-soft transition-colors hover:border-accent/60 hover:bg-destructive-soft/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-sunken text-muted-text transition-colors group-hover:bg-destructive-soft group-hover:text-accent">
            <ImageIcon />
          </span>
          <span>{t('persona.photoUpload')}</span>
        </button>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      <p className="mt-3 text-sm leading-5 text-muted-text">{t('persona.photoHint')}</p>
    </div>
  );
};
