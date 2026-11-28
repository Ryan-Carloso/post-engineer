'use client';

import { useId, useRef } from 'react';
import Image from 'next/image';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineFieldError } from '@/components/ui/form-field';
import { useI18n } from '@/lib/i18n/provider';
import { UploadIcon, formatFileSize } from '@/lib/ui';
import type { ComposerMediaKind, MediaContentType } from '@/lib/post-composer/compose';

export interface MediaSelection {
  file: File;
  contentType: MediaContentType;
  kind: ComposerMediaKind;
  previewUrl: string;
}

const ACCEPT = '.mp4,.mov,.jpg,.jpeg,.png,video/mp4,video/quicktime,image/jpeg,image/png';

export function MediaField({
  media,
  issue,
  error,
  disabled,
  onSelect,
  onRemove,
}: {
  media: MediaSelection | null;
  issue: string | null;
  error: string | null;
  disabled: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null): void => {
    const [file] = files === null ? [] : Array.from(files);
    if (file !== undefined) onSelect(file);
  };

  return (
    <section
      className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6"
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        handleFiles(event.dataTransfer.files);
      }}
      data-testid="composer-media"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t('composer.mediaLabel')}</h2>
        <p className="text-xs text-muted-text">{t('composer.mediaHint')}</p>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
        data-testid="composer-file-input"
      />

      {media === null ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-sunken text-muted-text">
            <UploadIcon />
          </span>
          <p className="text-sm text-muted-text">{t('composer.mediaDrop')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon />
            {t('composer.mediaChoose')}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="overflow-hidden rounded-xl border border-line bg-black">
            {media.kind === 'video' ? (
              <video
                src={media.previewUrl}
                controls
                playsInline
                className="max-h-80 w-full object-contain"
                data-testid="composer-video-preview"
              />
            ) : (
              <Image
                src={media.previewUrl}
                alt={media.file.name}
                width={1280}
                height={720}
                unoptimized
                className="mx-auto size-auto max-h-80 max-w-full object-contain"
                data-testid="composer-image-preview"
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{media.file.name}</p>
              <p className="text-xs text-muted-text">
                {media.kind === 'video' ? t('composer.mediaVideo') : t('composer.mediaImage')} ·{' '}
                {formatFileSize(media.file.size)}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
              >
                {t('composer.mediaReplace')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onRemove}
              >
                <Trash2 aria-hidden />
                {t('composer.mediaRemove')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {issue !== null && <InlineFieldError message={issue} />}
      {error !== null && <InlineFieldError message={error} />}
    </section>
  );
}
