'use client';

import type { ReactNode } from 'react';

import type { HookPhoto } from '@/lib/hook-photo';
import { useI18n } from '@/lib/i18n/provider';

export const HookPhotoSection = ({
  hookPhoto,
  voiceover,
}: {
  hookPhoto: HookPhoto;
  voiceover: boolean;
}) => {
  const { t } = useI18n();
  if (voiceover) return null;
  const position =
    hookPhoto.segmentIndex !== null && hookPhoto.imageIndex !== null
      ? { segment: hookPhoto.segmentIndex + 1, image: hookPhoto.imageIndex + 1 }
      : null;
  let body: ReactNode;
  if (hookPhoto.source === 'segment' && hookPhoto.url !== null && position !== null) {
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hookPhoto.url}
          alt={t('posts.hookPhotoAlt')}
          className="mt-3 max-h-64 w-auto rounded-2xl"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          {t('posts.hookPhotoSegmentNote', position)}
        </p>
      </>
    );
  } else if (hookPhoto.source === 'segment' && position !== null) {
    body = (
      <p className="mt-2 text-sm text-muted-foreground">
        {t('posts.hookPhotoSegmentNote', position)}
      </p>
    );
  } else if (hookPhoto.source === 'upload' && position !== null) {
    body = (
      <p className="mt-2 text-sm text-muted-foreground">
        {t('posts.hookPhotoUploadNote', position)}
      </p>
    );
  } else {
    body = <p className="mt-2 text-sm text-muted-foreground">{t('posts.hookPhotoPersonaNote')}</p>;
  }
  return (
    <section aria-label={t('posts.hookPhotoLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.hookPhotoLabel')}
      </p>
      {body}
    </section>
  );
};
