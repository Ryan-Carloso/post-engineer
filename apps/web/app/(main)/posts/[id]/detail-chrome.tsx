'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';

export function DetailNotFound({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="text-sm font-semibold text-[#0d2b45]">{message ?? t('posts.notFound')}</p>
      <Link href="/posts" className="mt-4 inline-block rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]">
        {t('posts.back')}
      </Link>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse" data-testid="detail-skeleton">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-full bg-[#e8edf1]" />
        <div className="h-6 w-48 rounded-lg bg-[#e8edf1]" />
      </div>
      <div className="mt-6 aspect-video w-full rounded-2xl bg-[#e8edf1]" />
      <div className="mt-6 h-4 w-3/4 rounded bg-[#e8edf1]" />
      <div className="mt-3 h-4 w-1/2 rounded bg-[#e8edf1]" />
    </div>
  );
}
