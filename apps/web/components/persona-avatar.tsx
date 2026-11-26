'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { ImageIcon } from '@/lib/ui';
import { logger } from '@/lib/logger';
import { describeImageSource } from '@/lib/image-source';

export interface PersonaAvatarProps {
  avatarUrl?: string;
  photoUrl?: string;
  name: string;
  className?: string;
  size?: number;
}

function displayCandidates(avatarUrl?: string, photoUrl?: string): string[] {
  const urls: string[] = [];
  if (typeof avatarUrl === 'string' && avatarUrl.length > 0) urls.push(avatarUrl);
  if (typeof photoUrl === 'string' && photoUrl.length > 0) urls.push(photoUrl);
  return urls;
}

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
  const candidates = displayCandidates(avatarUrl, photoUrl);
  const initials = personaInitials(name);
  const [failedCount, setFailedCount] = useState(0);
  const loggedEmptyChain = useRef(false);
  useEffect(() => {
    setFailedCount(0);
    loggedEmptyChain.current = false;
  }, [avatarUrl, photoUrl]);
  const imageUrl = candidates[failedCount];
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const imageFailed = failedCount >= candidates.length;

  useEffect(() => {
    if (imageUrl !== undefined || loggedEmptyChain.current) return;
    loggedEmptyChain.current = true;
    logger.debug('[persona-avatar] no avatar source, showing initials', { name });
  }, [imageUrl, name]);

  const handleImageLoad = () => {
    if (imageUrl !== undefined) setLoadedUrl(imageUrl);
  };

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (!event.currentTarget.isConnected) return;
    setFailedCount((count) => count + 1);
    logger.warn('[persona-avatar] avatar image failed to load', {
      name,
      source: describeImageSource(imageUrl),
    });
  };

  const imageLoading = imageUrl !== undefined && !imageFailed && loadedUrl !== imageUrl;

  return (
    <span
      data-ui-diff-mask=""
      aria-busy={imageLoading || undefined}
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken text-ink-soft ring-2 ring-hairline',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {imageUrl && !imageFailed ? (
        <>
          {imageLoading ? (
            <span data-testid="persona-avatar-skeleton" className="skeleton-shimmer absolute inset-0" />
          ) : null}
          <Image
            src={imageUrl}
            alt={name}
            width={size}
            height={size}
            unoptimized
            onLoad={handleImageLoad}
            onError={handleImageError}
            className={cn('size-full object-cover', imageLoading && 'opacity-0')}
          />
        </>
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
