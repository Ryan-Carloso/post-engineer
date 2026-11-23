'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  usePostDetailQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
  type ScheduledSlot,
  type SlotDetailPayload,
  type PostDetail,
  type ProgressHistoryEntry,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import AccountCard from '@/components/account-card';
import { DetailProgressBar } from './detail-progress-bar';
import { formatDateTime, ScheduleSection } from './schedule-section';
import { GenerationFactsSection } from './generation-facts-section';
import { HookPhotoSection } from './hook-photo-section';
import { RescheduleSection } from './reschedule-section';
import { ScriptAngleSection } from './script-angle-section';
import { usePostAccountCards, type AccountCardData } from './account-cards';
import { ExternalLinkIcon } from '@/lib/ui';
import type { PublishLink } from '@/lib/publish-links';
import { PROVIDER_LABELS, scheduleAccountIds } from '@/lib/account-options';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import type { TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { STATUS_KEY, STATUS_STYLE } from '../status';
import { PostFailureNotice } from './post-failure-notice';

const GENERATION_ERROR_KEY: Record<string, TranslationKey> = {
  custom_audio_invalid: 'posts.errorCustomAudio',
  engine_unavailable: 'posts.errorEngineUnavailable',
  engine_rejected: 'posts.errorEngineRejected',
  no_task_id: 'posts.errorNoTaskId',
  invalid_task_response: 'posts.errorInvalidTaskResponse',
  unknown: 'posts.errorUnknown',
};

function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);


export default function PostDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';

  const postQuery = usePostDetailQuery(id);
  const accountOptions = usePostAccountCards();

  const post: PostDetail | null = postQuery.data ?? null;
  const slotDetail = post?.kind === 'slot' ? post : null;
  const generation = post?.kind === 'generation' ? post.generation : null;
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
    ?? generation?.personaName
    ?? (personaMissing ? t('posts.noPersona') : t('posts.personaFallback'));

  if (isLoading) return <DetailSkeleton />;

  const loadError = postQuery.isError
    ? (postQuery.error instanceof Error ? postQuery.error.message : null)
    : null;
  if (loadError) {
    return <DetailNotFound message={t('posts.detailLoadError')} />;
  }
  if (!post) return <DetailNotFound />;

  if (post.kind === 'generation' && generation) {
    const videoUrl = generation.status === 'completed' ? videoUrlFor(generation.engineTaskId) : null;
    return (
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title={generation.personaName ?? t('posts.personaFallback')}
          statusLabel={t(STATUS_KEY[generation.status] ?? 'posts.statusPending')}
          statusStyle={STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}
        />
        <PostIdSection postId={generation.generationId} />
        <ScriptAngleSection angle={generation.scriptAngle} />
        <section aria-label={t('posts.detailsTitle')} className="mt-6">
          <p className="text-sm text-muted-foreground">
            {formatDateTime(generation.createdAt, locale)} · {generation.videoSubject ?? t('posts.unknownTitle')}
          </p>
          {(generation.status === 'pending' || generation.status === 'running') && generation.engineTaskId ? (
            <DetailProgressBar progress={generation.progress} stage={generation.stage} />
          ) : (
            <DetailPlayer
              src={videoUrl}
              placeholder={t('posts.coverNoVideo')}
            />
          )}
          {generation.status === 'failed' && (
            <p className="mt-4 text-sm text-destructive">
              {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
            </p>
          )}
          {generation.tokensRefunded && (
            <Badge variant="outline" className="mt-4 border-transparent bg-success-soft text-success">
              {t('posts.refundedBadge')}
            </Badge>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <DetailHeader
        title={personaName}
        statusLabel={t(STATUS_KEY[slot?.status ?? 'pending'] ?? 'posts.statusPending')}
        statusStyle={STATUS_STYLE[slot?.status ?? 'pending'] ?? STATUS_STYLE.pending}
      />
      {slot && slotDetail && (
        <SlotDetail
          slot={slot}
          accounts={accounts}
          locale={locale}
          timezone={slotDetail.schedule.timezone}
          publishMode={slotDetail.schedule.publishMode}
          publishLinks={slotDetail.slot.publishLinks ?? []}
          generation={slotDetail.generation}
          personaName={personaName}
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


const DetailPlayer = ({ src, placeholder }: { src: string | null; placeholder: string }) => {
  const { t } = useI18n();
  const [debug, setDebug] = useState<{
    status: 'loading' | 'ready' | 'error';
    width: number;
    height: number;
    duration: number;
    errorCode: number | null;
  }>({ status: 'loading', width: 0, height: 0, duration: 0, errorCode: null });

  const handleMetadata = (event: React.SyntheticEvent<HTMLVideoElement>): void => {
    const el = event.currentTarget;
    setDebug({
      status: 'ready',
      width: el.videoWidth,
      height: el.videoHeight,
      duration: el.duration,
      errorCode: null,
    });
  };

  const handleError = (event: React.SyntheticEvent<HTMLVideoElement>): void => {
    const el = event.target as HTMLVideoElement;
    const code = el.error?.code ?? null;
    setDebug((current) => ({
      ...current,
      status: 'error',
      errorCode: code,
    }));
  };

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-2xl bg-black">
        {src ? (
          <video
            src={src}
            controls
            preload="metadata"
            onLoadedMetadata={handleMetadata}
            onError={handleError}
            className="mx-auto h-auto max-h-[46vh] w-auto max-w-full"
          />
        ) : (
          <div className="flex h-56 w-full items-center justify-center bg-sunken text-sm font-medium text-muted-foreground">{placeholder}</div>
        )}
      </div>
      {src && (
        <p data-testid="video-debug" className="mt-2 font-mono text-xs text-[#8aa2b5]">
          {debug.status === 'ready' &&
            `${debug.width}×${debug.height} · ${Math.round(debug.duration)}s · ${src}`}
          {debug.status === 'error' && `${t('posts.videoLoadError')} (code ${debug.errorCode ?? '?'}) · ${src}`}
          {debug.status === 'loading' && `loading… · ${src}`}
        </p>
      )}
    </div>
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
  generation,
  personaName,
}: {
  slot: SlotDetailPayload['slot'];
  accounts: AccountCardData[];
  locale: 'pt' | 'en';
  timezone: string;
  publishMode: SlotDetailPayload['schedule']['publishMode'];
  publishLinks: PublishLink[];
  generation: SlotDetailPayload['generation'];
  personaName: string;
}) => {
  const { t } = useI18n();
  const router = useRouter();
  const updateTitle = useUpdateSlotMutation();
  const deleteSlot = useDeleteSlotMutation();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(slot.title ?? '');
  const [armed, setArmed] = useState(false);

  const videoUrl = videoUrlFor(slot.taskId);
  const canWatch = SLOT_VIDEO_STATUSES.has(slot.status) && videoUrl !== null;
  const canEdit = slot.status === 'awaiting' || slot.status === 'ready';
  const canDelete =
    slot.status === 'awaiting' || slot.status === 'ready' || slot.status === 'failed';
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
      {canWatch && videoUrl ? (
        <DetailPlayer src={videoUrl} placeholder="" />
      ) : slot.status === 'generating' ? (
        <DetailProgressBar progress={slot.progress} stage={slot.stage} />
      ) : (
        <DetailPlayer
          src={null}
          placeholder={slot.status === 'awaiting' ? t('posts.videoPending') : t('posts.coverNoVideo')}
        />
      )}

      <PostFailureNotice status={slot.status} error={slot.error} userNotices={slot.userNotices} />
      {canWatch && videoUrl && (
        <div className="mt-3">
          <a
            href={`${videoUrl}?source=download`}
            download
            className="inline-block rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
          >
            {t('posts.downloadVideo')}
          </a>
        </div>
      )}

      <HookPhotoSection hookPhoto={slot.hookPhoto} voiceover={generation.voiceover} />

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

      <ScriptAngleSection angle={slot.scriptAngle} />

      <PostIdSection postId={slot.id} />

      <ScheduleSection slot={slot} timezone={timezone} publishMode={publishMode} locale={locale} />

      <RescheduleSection slot={slot} timezone={timezone} publishMode={publishMode} />

      <GenerationFactsSection generation={generation} personaName={personaName} />

      {accounts.length > 0 && (
        <section aria-label={t('posts.accountsLabel')} className="mt-6">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('posts.accountsLabel')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {accounts.map((account) => (
              <AccountCard
                key={`${account.type}:${account.id}`}
                type={account.type}
                name={account.name}
                email={account.email}
                thumbnail={account.thumbnail}
                handle={account.handle}
              />
            ))}
          </div>
        </section>
      )}

      <PublishLinks links={publishLinks} />

      <ProgressHistory history={slot.progressHistory ?? []} />

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
          {canDelete && armed && (
            <span className="text-xs text-muted-foreground">{t('posts.deleteTokenNote')}</span>
          )}
        </div>
      )}
    </section>
  );
};

export const ProgressHistory = ({ history }: { history: ProgressHistoryEntry[] }) => {
  const { t, locale } = useI18n();
  if (history.length === 0) return null;
  return (
    <section aria-label={t('posts.progressHistoryTitle')} className="mt-6">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('posts.progressHistoryTitle')}
      </p>
      <ol className="mt-3 space-y-2">
        {history.map((entry, index) => {
          const regressed = index > 0 && entry.progress < history[index - 1].progress;
          return (
            <li
              key={`${entry.recordedAt}-${index}`}
              data-testid="progress-history-row"
              data-regressed={regressed ? 'true' : undefined}
              className={`flex items-baseline justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
                regressed ? 'border-warning/40 bg-warning-soft' : 'border-input bg-card'
              }`}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={`font-semibold ${regressed ? 'text-warning' : 'text-primary'}`}>
                  {entry.progress}%
                </span>
                {entry.stage && (
                  <span className="truncate font-mono text-xs text-muted-foreground">{entry.stage}</span>
                )}
              </span>
              <time className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(entry.recordedAt, locale)}
              </time>
            </li>
          );
        })}
      </ol>
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
