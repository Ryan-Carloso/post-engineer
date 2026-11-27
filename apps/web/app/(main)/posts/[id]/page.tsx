'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  usePostDetailQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
  type SlotDetailPayload,
  type PostDetail,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { ScheduleSection } from './schedule-section';
import { PostAccountsSection } from './post-accounts-section';
import { SlotImagePreview } from './slot-image-preview';
import { RescheduleSection } from './reschedule-section';
import { PromptSection } from './prompt-section';
import type { PostPromptFacts } from '@/lib/slot-detail';
import { usePostAccountCards, type AccountCardData } from './account-cards';
import { ExternalLinkIcon } from '@/lib/ui';
import type { PublishLink } from '@/lib/publish-links';
import { PROVIDER_LABELS, scheduleAccountIds } from '@/lib/account-options';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import { STATUS_KEY, STATUS_STYLE, slotDisplayStatus } from '../status';
import { useAccessQuery } from '@/lib/access-query';
import { PostFailureNotice } from './post-failure-notice';

export default function PostDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';

  const postQuery = usePostDetailQuery(id);
  const accessQuery = useAccessQuery();
  const hasAccess = accessQuery.data?.active ?? true;
  const accountOptions = usePostAccountCards();

  const post: PostDetail | null = postQuery.data ?? null;
  const slotDetail = post;
  const isLoading = postQuery.isLoading;

  const accounts: AccountCardData[] = useMemo(() => {
    if (!slotDetail) return [];
    const ids = new Set(scheduleAccountIds(slotDetail.schedule));
    return accountOptions.filter((account) => ids.has(account.id));
  }, [slotDetail, accountOptions]);

  const slot = slotDetail?.slot ?? null;
  const personaMissing =
    slotDetail !== null && slotDetail !== undefined && slotDetail.schedule.personaId === null;
  const personaName = slotDetail?.persona?.name
    ?? (personaMissing ? t('posts.noPersona') : t('posts.personaFallback'));

  if (isLoading) return <DetailSkeleton />;

  const loadError = postQuery.isError
    ? (postQuery.error instanceof Error ? postQuery.error.message : null)
    : null;
  if (loadError) {
    return <DetailNotFound message={t('posts.detailLoadError')} />;
  }
  if (!post) return <DetailNotFound />;

  return (
    <div className="mx-auto max-w-3xl">
      <DetailHeader
        title={personaName}
        statusLabel={t(STATUS_KEY[slotDisplayStatus(slot?.status ?? 'ready', hasAccess)] ?? 'posts.statusReady')}
        statusStyle={STATUS_STYLE[slotDisplayStatus(slot?.status ?? 'ready', hasAccess)] ?? STATUS_STYLE.ready}
      />
      {slot && slotDetail && (
        <SlotDetail
          slot={slot}
          accounts={accounts}
          locale={locale}
          timezone={slotDetail.schedule.timezone}
          publishMode={slotDetail.schedule.publishMode}
          publishLinks={slotDetail.slot.publishLinks ?? []}
          prompt={slotDetail.prompt}
        />
      )}
    </div>
  );
}

const DetailHeader = ({
  title,
  statusLabel,
  statusStyle,
}: {
  title: string;
  statusLabel: string;
  statusStyle: string;
}) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link
          href="/posts"
          aria-label={t('posts.back')}
          className="inline-flex size-9 items-center justify-center rounded-full border border-input bg-card text-primary hover:bg-background"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-[-0.02em] text-primary">{title}</h1>
      </div>
      <Badge variant="outline" className={`border-transparent ${statusStyle}`}>
        {statusLabel}
      </Badge>
    </div>
  );
};

export const PostIdSection = ({ postId }: { postId: string }) => {
  const { t } = useI18n();
  const { copied, copy } = useCopyText();

  return (
    <section aria-label={t('posts.postIdLabel')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('posts.postIdLabel')}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-input bg-secondary px-3 py-2 font-mono text-sm text-primary">
          {postId}
        </code>
        <button
          type="button"
          onClick={() => copy(postId)}
          aria-label={t('posts.copyPostId')}
          className="shrink-0 rounded-xl border border-input bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-background"
        >
          {copied ? t('posts.copied') : t('posts.copy')}
        </button>
      </div>
    </section>
  );
};


const PublishLinks = ({ links }: { links: PublishLink[] }) => {
  const { t } = useI18n();
  if (links.length === 0) return null;

  return (
    <section aria-label={t('posts.publishedLinksTitle')} className="mt-6">
      <h2 className="text-sm font-semibold text-primary">{t('posts.publishedLinksTitle')}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={`${link.provider}:${link.url}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-background"
            >
              {PROVIDER_LABELS[link.provider]}
              <ExternalLinkIcon />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};

export const SlotDetail = ({
  slot,
  accounts,
  locale,
  timezone,
  publishMode,
  publishLinks,
  prompt,
}: {
  slot: SlotDetailPayload['slot'];
  accounts: AccountCardData[];
  locale: 'pt' | 'en';
  timezone: string;
  publishMode: SlotDetailPayload['schedule']['publishMode'];
  publishLinks: PublishLink[];
  prompt: PostPromptFacts | null;
}) => {
  const { t } = useI18n();
  const router = useRouter();
  const updateTitle = useUpdateSlotMutation();
  const deleteSlot = useDeleteSlotMutation();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(slot.title ?? '');
  const [armed, setArmed] = useState(false);

  const canEdit = slot.status === 'ready';
  const canDelete =
    slot.status === 'ready' || slot.status === 'failed' || slot.status === 'expired';
  const mutationError =
    (updateTitle.isError ? updateTitle.error?.message : null) ??
    (deleteSlot.isError ? deleteSlot.error?.message : null);

  const handleSave = (): void => {
    updateTitle.mutate(
      { slotId: slot.id, title: titleDraft },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleDelete = (): void => {
    if (!armed) {
      setArmed(true);
      return;
    }
    deleteSlot.mutate(slot.id, { onSuccess: () => router.push('/posts') });
  };

  return (
    <section aria-label={t('posts.detailsTitle')} className="mt-6">
      {slot.media?.kind === 'image' && slot.media.url ? (
        <SlotImagePreview src={slot.media.url} />
      ) : slot.media?.kind === 'upload' && slot.media.url ? (
        <div className="mt-4 overflow-hidden rounded-2xl bg-black">
          <video src={slot.media.url} controls className="mx-auto h-auto max-h-[70vh] w-full" />
        </div>
      ) : null}
      <PostFailureNotice status={slot.status} error={slot.error} userNotices={slot.userNotices} />
      <div className="mt-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('posts.captionLabel')}</p>
        {editing ? (
          <div className="mt-2">
            <label className="sr-only" htmlFor="slot-title">{t('posts.captionLabel')}</label>
            <textarea
              id="slot-title"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-input px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={updateTitle.isPending || titleDraft.trim() === ''}
              >
                {t('posts.save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { setEditing(false); setTitleDraft(slot.title ?? ''); }}
                disabled={updateTitle.isPending}
              >
                {t('posts.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-xl bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-primary">
            {slot.title ?? t('posts.unknownCaption')}
          </p>
        )}
      </div>

      <PostIdSection postId={slot.id} />

      <PromptSection prompt={prompt} />

      <ScheduleSection slot={slot} timezone={timezone} publishMode={publishMode} locale={locale} />

      <RescheduleSection slot={slot} timezone={timezone} publishMode={publishMode} />

      <PostAccountsSection accounts={accounts} />

      <PublishLinks links={publishLinks} />

      {mutationError && (
        <p className="mt-6 rounded-xl bg-destructive-soft p-3 text-sm text-destructive" role="alert">
          {mutationError}
        </p>
      )}

      {(canEdit || canDelete) && (
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-6">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={deleteSlot.isPending}
              className="rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
            >
              {t('posts.editCaption')}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteSlot.isPending || updateTitle.isPending}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50 ${
                armed ? 'bg-destructive-hover' : 'bg-destructive hover:bg-destructive-hover'
              }`}
            >
              {armed ? t('posts.deleteConfirm') : t('posts.delete')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

const DetailNotFound = ({ message }: { message?: string }) => {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="text-sm font-semibold text-primary">{message ?? t('posts.notFound')}</p>
      <Button asChild size="sm" className="mt-4">
        <Link href="/posts">{t('posts.back')}</Link>
      </Button>
    </div>
  );
};

const DetailSkeleton = () => (
  <div className="mx-auto max-w-3xl animate-pulse" data-testid="detail-skeleton">
    <div className="flex items-center gap-3">
      <div className="size-9 rounded-full bg-sunken" />
      <div className="h-6 w-48 rounded-lg bg-sunken" />
    </div>
    <div className="mt-6 aspect-video w-full rounded-2xl bg-sunken" />
    <div className="mt-6 h-4 w-3/4 rounded bg-sunken" />
    <div className="mt-3 h-4 w-1/2 rounded bg-sunken" />
  </div>
);
