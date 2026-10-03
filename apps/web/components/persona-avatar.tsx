'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { ImageIcon } from '@/lib/ui';

//---------------
// PersonaAvatar — the persona's face, as the app shows it everywhere: the
// avatar (AI) or the uploaded photo, falling back to a neutral glyph when the
// persona has neither (faceless). Extracted from the persona card so the
// create-post picker and the persona list can't drift (same size, same ring,
// same `unoptimized` — the URLs are Supabase signed links, not an optimizer
// source).
//---------------

export interface PersonaAvatarProps {
  /** Avatar first, then photo: the avatar is what the user picked last. */
  avatarUrl?: string;
  photoUrl?: string;
  /** Used as the alt text and to build the deterministic gradient fallback. */
  name: string;
  className?: string;
  /** Rendered size of the square image (px). Defaults to the card size. */
  size?: number;
}

/**
 * personaInitials — two letters for the gradient fallback, unicode-aware so a
 * non-Latin persona name still gets initials instead of an empty circle.
 */
function personaInitials(name: string): string {
  const tokens = name.trim().replace(/^@+/, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? '').join('');
}

export default function PersonaAvatar({
  avatarUrl,
  photoUrl,
  name,
  className,
  size = 48,
}: PersonaAvatarProps) {
  const imageUrl = avatarUrl ?? photoUrl;
  const initials = personaInitials(name);
  // A signed Supabase URL can 403 after it expires: without this the avatar
  // stays a blank circle forever (same guard as account-card.tsx).
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br from-neutral-100 to-neutral-200 text-neutral-500 ring-2 ring-neutral-100',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {imageUrl && !imageFailed ? (
        <Image
          src={imageUrl}
          alt={name}
          width={size}
          height={size}
          unoptimized
          onError={() => setImageFailed(true)}
          className="size-full object-cover"
        />
      ) : initials.length > 0 ? (
        <span className="text-sm font-bold" aria-hidden="true">
          {initials}
        </span>
      ) : (
        <ImageIcon />
      )}
    </span>
  );
}
