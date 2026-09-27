'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

//---------------
// AccountCard — card compartilhado de conta social.
// Suporta YouTube, Instagram, Bluesky, LinkedIn.
// Usado na página de contas (com seleção/desconexão), na criação de API key
// (com seleção via checkbox) e no schedule de persona (modo compacto:
// apenas o avatar no tamanho da imagem, com fallback para a primeira letra).
//---------------

export interface AccountCardProps {
  type: 'youtube' | 'instagram' | 'bluesky' | 'linkedin';
  name: string;
  email?: string;
  thumbnail?: string;
  customUrl?: string;
  handle?: string;
  onSelect?: () => void;
  selected?: boolean;
  compact?: boolean;
  showDisconnect?: boolean;
  onDisconnect?: () => void;
}

//---------------
// nameInitials — fallback do avatar: 2 primeiras letras do nome
// (ignora "@" de handles), ou "?" quando não há nada utilizável.
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
  onSelect,
  selected = false,
  compact = false,
  showDisconnect = false,
  onDisconnect,
}: AccountCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  const { t } = useI18n();

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

  const body = (
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
          <h3 className="truncate text-sm font-semibold text-[#101728]">{handle || name}</h3>
        </div>
        {email || customUrl ? (
          <p className="mt-1 truncate text-xs text-[#718096]">{email || customUrl}</p>
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

      {showDisconnect && onDisconnect ? (
        <button
          type="button"
          data-testid={`${type}-disconnect-button`}
          className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:border-red-200 hover:text-red-600"
          onClick={onDisconnect}
        >
          {t('accounts.disconnect')}
        </button>
      ) : null}
    </div>
  );

  if (onSelect) {
    return (
      <label
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

  return <div className="rounded-xl border border-[#dfe5ec] bg-white p-4">{body}</div>;
}

//---------------
// AccountAvatar — avatar do tamanho exato da imagem (48px) usado no modo
// compacto. Sem imagem, ou se a imagem falhar ao carregar, mostra as
// primeiras letras do nome da conta como fallback.
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
