'use client';

import type { ReactNode } from 'react';

import type { HookPhoto } from '@/lib/hook-photo';
import { useI18n } from '@/lib/i18n/provider';

//---------------
// HookPhotoSection — the first photo of the video (issue #589). Read-only.
// The copy never claims the hook used this photo: videos generated before
// #589 opened the hook with the persona avatar, so a hook-usage claim
// would be false for every historical slot. On videos generated with the
// current behavior the first photo IS the hook photo. A URL photo renders;
// an upload (an engine temp asset, 1h TTL) or a persona fallback has no
// durable URL and renders an explanatory note instead — never the avatar,
// because dispatch may have used a library pick that is not stored on
// the slot. Faceless videos never show a face: the section renders
// nothing.
//---------------
export const HookPhotoSection = ({
  hookPhoto,
  faceless,
}: {
  hookPhoto: HookPhoto;
  faceless: boolean;
}) => {
  const { t } = useI18n();
  if (faceless) return null;
  const position =
    hookPhoto.segmentIndex !== null && hookPhoto.imageIndex !== null
      ? { segment: hookPhoto.segmentIndex + 1, image: hookPhoto.imageIndex + 1 }
      : null;
  let body: ReactNode;
  if (hookPhoto.source === 'segment' && hookPhoto.url !== null && position !== null) {
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- user-provided photo URL, arbitrary host, next/image needs remotePatterns */}
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
