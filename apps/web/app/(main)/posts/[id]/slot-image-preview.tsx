'use client';

import { useI18n } from '@/lib/i18n/provider';

export function SlotImagePreview({ src }: { src: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={t('posts.generationUploadedImage')} className="mx-auto size-auto max-h-[46vh] max-w-full" />
    </div>
  );
}
