'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

//---------------
// MaterialPreview — a 9:16 example frame for one material card, so the user
// sees what "real clips" vs "drawings" look like before spending tokens.
// The files are static (public/material-previews): the broll frame is free
// stock footage, the svg one is original line art — never licensed catalog
// art, which is not committed. A failed load falls back to the card icon and
// logs a warning (a handled, degraded state, like the persona avatar).
//---------------
export const MATERIAL_PREVIEW_SRC = {
  broll: '/material-previews/broll.webp',
  svg: '/material-previews/svg.svg',
} as const;

export const MaterialPreview = ({
  material,
  alt,
  fallbackIcon,
  selected,
}: {
  material: keyof typeof MATERIAL_PREVIEW_SRC;
  alt: string;
  fallbackIcon: ReactNode;
  selected: boolean;
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
          selected ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500',
        )}
      >
        {fallbackIcon}
      </span>
    );
  }
  return (
    <Image
      src={MATERIAL_PREVIEW_SRC[material]}
      alt={alt}
      width={36}
      height={64}
      unoptimized
      onError={() => {
        setFailed(true);
        logger.warn('[material-preview] preview image failed to load', { material });
      }}
      className={cn(
        'h-16 w-9 shrink-0 rounded-md border object-cover',
        selected ? 'border-accent' : 'border-neutral-200',
      )}
    />
  );
};
