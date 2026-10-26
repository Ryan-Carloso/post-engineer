'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { ImageIcon } from '@/lib/ui';
import { logger } from '@/lib/logger';
import { describeImageSource } from '@/lib/image-source';

//---------------
// PersonaAvatar — avatar, then photo, then library, then initials (or a
// glyph when the name has no letters). The personas list passes libraryUrl;
// the create-post picker does not. Shared size, ring, and `unoptimized`
// (Supabase signed links, not an optimizer source).
//---------------

export interface PersonaAvatarProps {
  /** Avatar, then photo, then library: the first URL that loads wins. */
  avatarUrl?: string;
  photoUrl?: string;
  libraryUrl?: string;
  /** Used as the alt text and to build the deterministic gradient fallback. */
  name: string;
  className?: string;
  /** Rendered size of the square image (px). Defaults to the card size. */
  size?: number;
}

function displayCandidates(avatarUrl?: string, photoUrl?: string, libraryUrl?: string): string[] {
  const urls: string[] = [];
  if (typeof avatarUrl === 'string' && avatarUrl.length > 0) urls.push(avatarUrl);
  if (typeof photoUrl === 'string' && photoUrl.length > 0) urls.push(photoUrl);
  if (typeof libraryUrl === 'string' && libraryUrl.length > 0) urls.push(libraryUrl);
  return urls;
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
  libraryUrl,
  name,
  className,
  size = 48,
}: PersonaAvatarProps) {
  const candidates = displayCandidates(avatarUrl, photoUrl, libraryUrl);
  const initials = personaInitials(name);
  // A signed Supabase URL can 403 after it expires: without this the avatar
  // stays a blank circle forever (same guard as account-card.tsx).
  const [failedCount, setFailedCount] = useState(0);
  const loggedEmptyChain = useRef(false);
  useEffect(() => {
    // A URL change is a new candidate chain and must start at 0.
    setFailedCount(0);
    loggedEmptyChain.current = false;
  }, [avatarUrl, photoUrl, libraryUrl]);
  const imageUrl = candidates[failedCount];
  const imageFailed = failedCount >= candidates.length;

  //---------------
  // Why no photo: the two silent causes are "the row has no avatar at all"
  // and "the URL exists but the browser refuses it". Both ended as a silent
  // initials circle until now, so each one leaves a trail (redacted: the
  // Supabase signature token lives in the query string).
  //---------------
  useEffect(() => {
    if (imageUrl !== undefined || loggedEmptyChain.current) return;
    loggedEmptyChain.current = true;
    logger.debug('[persona-avatar] no avatar source, showing initials', { name });
  }, [imageUrl, name]);

  //---------------
  // An aborted load (unmount, Fast Refresh, navigation) also fires `error`,
  // and treating that as a broken avatar logged a false failure and swapped a
  // perfectly good photo for the initials. A real failure leaves the element
  // in the document; an aborted one is already detached.
  //---------------
  //---------------
  // A broken photo is a handled, degraded state (the next candidate or the
  // initials take over), so it is a warning: still logged and reported, but
  // not a console.error, which the Next dev overlay shows as an "Issue".
  //---------------
  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (!event.currentTarget.isConnected) return;
    setFailedCount((count) => count + 1);
    logger.warn('[persona-avatar] avatar image failed to load', {
      name,
      source: describeImageSource(imageUrl),
    });
  };

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
          onError={handleImageError}
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
