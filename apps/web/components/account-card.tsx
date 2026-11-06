'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { reportAccountCardDisplay } from '@/lib/account-card-telemetry';
import type { AccountLabelOrigin } from '@/lib/account-display-diagnostics';
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
          'relative block size-16 cursor-pointer overflow-hidden rounded-xl border bg-white transition-colors',
          selected
            ? 'border-accent ring-2 ring-accent/15'
            : 'border-neutral-200 hover:border-neutral-400',
        )}
      >
        <AccountAvatar name={handle || name} thumbnail={thumbnail} selected={selected} />
      </label>
    );
  }

  // The disconnect button gets its own row: inline next to the label it
  // leaves the name eight characters of width on any grid, and every card
  // renders as `C…`. The text zone keeps the full card width instead.
  const actions =
    showDisconnect && onDisconnect ? (
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-testid={`${type}-disconnect-button`}
          className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:border-red-200 hover:text-red-600"
          onClick={onDisconnect}
        >
          {t('accounts.disconnect')}
        </button>
      </div>
    ) : null;

  const body = (
    <div>
      <div className="flex items-center gap-3.5">
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
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-base font-bold text-neutral-600"
          >
            {nameInitials(handle || name)}
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <span role="img" className="size-2 shrink-0 rounded-full bg-emerald-500" aria-label={t('accounts.connectedAccount')} />
            <h3 ref={labelRef} className="truncate text-sm font-semibold text-[#101728]">{shownLabel}</h3>
          </div>
          {secondaryLabel ? (
            <p ref={secondaryRef} className="mt-1 truncate text-xs text-[#718096]">{secondaryLabel}</p>
          ) : null}
        </div>

        {onSelect && !showDisconnect ? (
          <input
            type="checkbox"
            data-testid="account-card-select"
            checked={selected}
            onChange={onSelect}
            className="size-4 shrink-0 accent-[#101728]"
          />
        ) : null}
      </div>
      {actions}
    </div>
  );

  if (onSelect) {
    return (
      <label
        ref={(node) => { cardRef.current = node; }}
        data-testid="account-card"
        className={cn(
          'block cursor-pointer rounded-xl border bg-white p-4 transition-colors focus-within:ring-2 focus-within:ring-[#101728]/15',
          selected ? 'border-neutral-900' : 'border-neutral-200 hover:border-[#b9c5d2] hover:bg-[#fbfcfd]',
        )}
      >
        {body}
      </label>
    );
  }

  return <div ref={(node) => { cardRef.current = node; }} data-testid="account-card" className="rounded-xl border border-[#dfe5ec] bg-white p-4">{body}</div>;
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
        'flex size-full items-center justify-center bg-pink-50 text-base font-bold text-pink-600',
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
