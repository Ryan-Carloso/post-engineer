'use client';

import Image from 'next/image';
import { useI18n } from '@/lib/i18n/provider';

export function SlotImagePreview({ src }: { src: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-black">
      <Image
        src={src}
        alt={t('posts.uploadedImage')}
        width={1080}
        height={1920}
        unoptimized
        className="mx-auto size-auto max-h-[46vh] max-w-full"
      />
    </div>
  );
}
