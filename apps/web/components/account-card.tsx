'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { reportAccountCardDisplay } from '@/lib/account-card-telemetry';
import type { AccountLabelOrigin } from '@/lib/account-display-diagnostics';
import { TrashIcon } from '@/lib/ui';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

//---------------
// AccountCard — shared social-account card.
// Supports YouTube, Instagram, Bluesky, LinkedIn and Threads.
// Used on the accounts page (select / disconnect), API-key creation
// (checkbox selection) and the persona schedule (compact mode: avatar
// only, falling back to the first letters of the name).
//---------------

export interface AccountCardProps {
  type: 'youtube' | 'instagram' | 'bluesky' | 'linkedin' | 'threads';
  name: string;
  email?: string;
  thumbnail?: string;
  customUrl?: string;
  handle?: string;
  // Display name stored for the account but not painted on this card
  // (Instagram `name`). Reported to PostHog; it does not change the label.
  storedDisplayName?: string;
  // 'provider_id' when the visible label is the opaque provider id because
  // accountName was empty (LinkedIn, Threads).
  labelOrigin?: AccountLabelOrigin;
  onSelect?: () => void;
  selected?: boolean;
  compact?: boolean;
  showDisconnect?: boolean;
  onDisconnect?: () => void;
}

//---------------
// Minimum visible label width (px): the floor that keeps ~8 letters of the
// account name on the card before the truncation "…" takes over. Pinned by
// the account-card test.
//---------------
export const ACCOUNT_LABEL_MIN_WIDTH_PX = 88;

//---------------
// nameInitials — avatar fallback: first two letters of the name
// ("@" on handles is ignored), or "?" when nothing usable remains.
//---------------
function nameInitials(name: string): string {
  const cleaned = name.trim().replace(/^@+/, '');
  return (cleaned.slice(0, 2) || '?').toUpperCase();
}

export default function AccountCard({
  type,
  name,
  email,
  thumbnail,
  customUrl,
  handle,
  storedDisplayName,
  labelOrigin,
  onSelect,
  selected = false,
  compact = false,
  showDisconnect = false,
  onDisconnect,
}: AccountCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const labelRef = useRef<HTMLHeadingElement>(null);
  const secondaryRef = useRef<HTMLParagraphElement>(null);

  const { t } = useI18n();
  const shownLabel = handle || name;
  const secondaryLabel = email || customUrl || null;

  useLayoutEffect(() => {
    if (compact) return;
    const publish = (): void => {
      reportAccountCardDisplay({
        provider: type,
        shownLabel,
        secondaryLabel,
        storedDisplayName,
        thumbnailUrl: thumbnail,
        thumbnailFailed,
        labelOrigin,
        compact: false,
        labelEl: labelRef.current,
        secondaryEl: secondaryRef.current,
        cardEl: cardRef.current,
      });
    };
    publish();
    const node = cardRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => publish());
    observer.observe(node);
    return () => observer.disconnect();
  }, [compact, type, shownLabel, secondaryLabel, storedDisplayName, thumbnail, thumbnailFailed, labelOrigin]);

  if (compact) {
    return (
      <label
        data-testid="account-card"
        title={handle || name}
        onClick={onSelect}
        className={cn(
          'relative block size-16 cursor-pointer overflow-hidden rounded-xl border bg-card transition-colors',
          selected
            ? 'border-accent ring-2 ring-accent/15'
            : 'border-line hover:border-muted-text',
        )}
      >
        <AccountAvatar name={handle || name} thumbnail={thumbnail} selected={selected} />
      </label>
    );
  }

  // The label never shrinks below this: with the inline trash button the
  // name keeps at least ~8 letters before the "…" takes over.
  const body = (
    <div className="flex items-center gap-3">
      {thumbnail && !thumbnailFailed ? (
        <Image
          src={thumbnail}
          alt={handle || name}
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-full object-cover ring-2 ring-white"
          onError={() => setThumbnailFailed(true)}
        />
      ) : (
        <span
          role="img"
          aria-label={handle || name}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sunken text-base font-bold text-muted-text"
        >
          {nameInitials(handle || name)}
        </span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-2">
          <span role="img" className="size-2 shrink-0 rounded-full bg-emerald-500" aria-label={t('accounts.connectedAccount')} />
          <h3
            ref={labelRef}
            title={shownLabel}
            style={{ minWidth: ACCOUNT_LABEL_MIN_WIDTH_PX }}
            className="truncate text-sm font-semibold text-ink"
          >
            {shownLabel}
          </h3>
        </div>
        {secondaryLabel ? (
          <p ref={secondaryRef} className="mt-1 truncate text-xs text-muted-text">{secondaryLabel}</p>
        ) : null}
      </div>

      {onSelect && !showDisconnect ? (
        <input
          type="checkbox"
          data-testid="account-card-select"
          checked={selected}
          onChange={onSelect}
          className="size-4 shrink-0 accent-ink"
        />
      ) : null}

      {showDisconnect && onDisconnect ? (
        <button
          type="button"
          data-testid={`${type}-disconnect-button`}
          aria-label={t('accounts.disconnect')}
          title={t('accounts.disconnect')}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
          onClick={onDisconnect}
        >
          <span className="[&>svg]:size-4"><TrashIcon /></span>
        </button>
      ) : null}
    </div>
  );

  if (onSelect) {
    return (
      <label
        ref={(node) => { cardRef.current = node; }}
        data-testid="account-card"
        className={cn(
          'block cursor-pointer rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ink/15',
          selected ? 'border-ink' : 'border-line hover:border-muted-text hover:bg-surface',
        )}
      >
        {body}
      </label>
    );
  }

  return <div ref={(node) => { cardRef.current = node; }} data-testid="account-card" className="rounded-xl border border-line bg-card p-4">{body}</div>;
}

//---------------
// AccountAvatar — image-sized avatar (the compact card is 64px and the
// image is scaled). With no image, or when the image fails to load, shows
// the first letters of the account name.
//---------------
const AccountAvatar = ({
  name,
  thumbnail,
  selected,
}: {
  name: string;
  thumbnail?: string;
  selected: boolean;
}) => {
  const [failed, setFailed] = useState(false);
  const initials = nameInitials(name);

  return !thumbnail || failed ? (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'flex size-full items-center justify-center bg-brand-soft text-base font-bold text-brand',
        !selected && 'grayscale',
      )}
    >
      {initials}
    </span>
  ) : (
    <Image
      src={thumbnail}
      alt={name}
      width={100}
      height={100}
      onError={() => setFailed(true)}
      className={cn('size-full scale-125 object-cover', !selected && 'grayscale')}
    />
  );
};
