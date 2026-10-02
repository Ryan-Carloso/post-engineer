'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  useSlotDetailQuery,
  useGenerationDetailQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
  type ScheduledSlot,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ProviderIcon } from '@/components/provider-icon';
import { ExternalLinkIcon } from '@/lib/ui';
import type { PublishLink } from '@/lib/publish-links';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';

//---------------
// PostDetailPage (/posts/[id]) — the full-page post detail: big video
// player when the engine produced one, live progress while generating,
// topic editing for awaiting slots, delete for awaiting/failed slots.
// The entity is resolved by id through the detail endpoints
// (GET /api/schedule/slots/:id and GET /api/persona/video-generations/:id)
// — never by scanning the history lists, so any post is reachable no
// matter how deep it sits in the history.
//---------------

interface AccountOption {
  id: string;
  provider: 'youtube' | 'instagram' | 'linkedin';
  label: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-[#e8edf1] text-[#60758a]',
  generating: 'bg-[#e3f0ff] text-[#1d5bbf]',
  running: 'bg-[#e3f0ff] text-[#1d5bbf]',
  ready: 'bg-[#fff4d6] text-[#9a6b00]',
  publishing: 'bg-[#e3f0ff] text-[#1d5bbf]',
  published: 'bg-[#cff5df] text-[#167246]',
  completed: 'bg-[#cff5df] text-[#167246]',
  failed: 'bg-[#ffe1de] text-[#c2301e]',
};

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  generating: 'posts.statusGenerating',
  ready: 'posts.statusReady',
  publishing: 'posts.statusPublishing',
  published: 'posts.statusPublished',
  failed: 'posts.statusFailed',
  completed: 'posts.statusCompleted',
};

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

//---------------
// PUBLISH_LINK_LABEL — the display name per provider. A fixed literal map
// rather than the raw provider id so the UI never shows an internal slug,
// and rather than the slug's capitalization so a new provider cannot leak
// untranslated into the page.
//---------------
const PUBLISH_LINK_LABEL: Record<PublishLink['provider'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
};

function formatDateTime(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function accountInitials(label: string): string {
  const tokens = label.replace(/^@/, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? '').join('');
}

export default function PostDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';

  // Both lookups run for the id: a scheduled post resolves through the
  // slots endpoint, a manual generation through the generations one.
  // A 404 resolves to null (not found); any other failure throws and is
  // surfaced by the error state.
  const slotQuery = useSlotDetailQuery(id);
  const generationQuery = useGenerationDetailQuery(id);
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();

  const accountOptions: AccountOption[] = useMemo(
    () => [
      ...(youtubeQuery.data?.accounts ?? []).map((account) => ({
        id: account.channelId,
        provider: 'youtube' as const,
        label: account.channelName,
      })),
      ...(instagramQuery.data?.accounts ?? []).map((account) => ({
        id: account.igUserId,
        provider: 'instagram' as const,
        label: `@${account.username}`,
      })),
      ...(linkedinQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        provider: 'linkedin' as const,
        label: account.accountName ?? account.providerAccountId,
      })),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data],
  );

  const slotDetail = slotQuery.data ?? null;
  const generation = generationQuery.data ?? null;
  const isLoading = slotQuery.isLoading || generationQuery.isLoading;

  const accounts: AccountOption[] = useMemo(() => {
    if (!slotDetail) return [];
    const ids = new Set([
      ...slotDetail.schedule.youtubeAccountIds,
      ...slotDetail.schedule.instagramAccountIds,
      ...slotDetail.schedule.linkedinAccountIds,
    ]);
    return accountOptions.filter((account) => ids.has(account.id));
  }, [slotDetail, accountOptions]);

  const slot = slotDetail?.slot ?? null;
  const personaName = slotDetail?.persona?.name ?? generation?.personaName ?? t('posts.personaFallback');

  if (isLoading) return <DetailSkeleton />;

  // Detail fetch failures carry the server's safe message; null results
  // mean genuinely not found (404 from both endpoints).
  const loadError =
    (slotQuery.isError ? (slotQuery.error instanceof Error ? slotQuery.error.message : null) : null) ??
    (generationQuery.isError ? (generationQuery.error instanceof Error ? generationQuery.error.message : null) : null);
  if (loadError) {
    return <DetailNotFound message={loadError} />;
  }
  if (!slot && !generation) return <DetailNotFound />;

  if (generation && !slot) {
    const videoUrl = generation.status === 'completed' ? videoUrlFor(generation.engineTaskId) : null;
    return (
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title={generation.personaName ?? t('posts.personaFallback')}
          statusLabel={t(STATUS_KEY[generation.status] ?? 'posts.statusPending')}
          statusStyle={STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}
        />
        <section aria-label={t('posts.detailsTitle')} className="mt-6">
          <p className="text-sm text-muted-foreground">
            {formatDateTime(generation.createdAt, locale)} · {generation.videoSubject ?? t('posts.unknownTopic')}
          </p>
          <DetailPlayer
            src={videoUrl}
            placeholder={t('posts.coverNoVideo')}
          />
          {generation.status === 'failed' && (
            <p className="mt-4 text-sm text-destructive">
              {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
            </p>
          )}
          {generation.tokensRefunded && (
            <Badge variant="outline" className="mt-4 border-transparent bg-[#cff5df] text-[#167246]">
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
      {slot && (
        <SlotDetail
          slot={slot}
          accounts={accounts}
          locale={locale}
          publishLinks={slotDetail?.slot.publishLinks ?? []}
        />
      )}
    </div>
  );
}

/* -----------------
   Local Components
------------------ */

//---------------
// DetailHeader — back link, title and the status pill, shared by the slot
// and generation views.
//---------------
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
          className="inline-flex size-9 items-center justify-center rounded-full border border-input bg-white text-[#0d2b45] hover:bg-[#f4f8fb]"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-bold tracking-[-0.02em] text-[#0d2b45]">{title}</h1>
      </div>
      <Badge variant="outline" className={`border-transparent ${statusStyle}`}>
        {statusLabel}
      </Badge>
    </div>
  );
};

//---------------
// DetailPlayer — the full-width player section. The video keeps its
// intrinsic aspect ratio (h-auto — faceless videos are often vertical
// 9:16; a forced 16:9 box letterboxes them into a black rectangle). The
// debug line below surfaces what the <video> element itself reports
// (state, resolution, duration, media error code) so a black player is
// never undiagnosable: if the proxy fails, the code shows up here.
// No video yet (awaiting, generating, failed or a generation that never
// completed) renders the reason, never a broken player.
//---------------
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

  // React nulls out event.currentTarget after the dispatch — capture the
  // element (and its MediaError) synchronously, before the state updater
  // runs, or Safari throws "null is not an object".
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
            className="h-auto w-full"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center text-sm font-medium text-[#8aa2b5]">
            {placeholder}
          </div>
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

//---------------
// PublishLinks — where the post went: one link per provider the engine
// published to. Renders nothing when there are no links, so the section
// never appears empty (a post that has not gone out, or an engine that
// recorded nothing).
//
// The href comes from the server, which already restricted it to https;
// target/rel keep the external site from reaching back into this tab.
//---------------
const PublishLinks = ({ links }: { links: PublishLink[] }) => {
  const { t } = useI18n();
  if (links.length === 0) return null;

  return (
    <section aria-label={t('posts.publishedLinksTitle')} className="mt-6">
      <h2 className="text-sm font-semibold text-[#0d2b45]">{t('posts.publishedLinksTitle')}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={`${link.provider}:${link.url}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-input bg-white px-3 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb]"
            >
              {PUBLISH_LINK_LABEL[link.provider]}
              <ExternalLinkIcon />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
};

//---------------
// SlotDetail — the scheduled-post body: player or generating progress,
// topic (editable while awaiting), target accounts, error, and the
// per-status actions. Delete redirects back to /posts on success;
// mutation errors render inline and never navigate away.
//---------------
const SlotDetail = ({
  slot,
  accounts,
  locale,
  publishLinks,
}: {
  slot: ScheduledSlot;
  accounts: AccountOption[];
  locale: 'pt' | 'en';
  publishLinks: PublishLink[];
}) => {
  const { t } = useI18n();
  const router = useRouter();
  const updateTopic = useUpdateSlotMutation();
  const deleteSlot = useDeleteSlotMutation();
  const [editing, setEditing] = useState(false);
  const [topicDraft, setTopicDraft] = useState(slot.topic ?? '');
  // Two-step delete: the first click arms the confirmation button.
  const [armed, setArmed] = useState(false);

  const videoUrl = videoUrlFor(slot.taskId);
  const canWatch = SLOT_VIDEO_STATUSES.has(slot.status) && videoUrl !== null;
  const canEdit = slot.status === 'awaiting';
  const canDelete = slot.status === 'awaiting' || slot.status === 'failed';
  const mutationError =
    (updateTopic.isError ? updateTopic.error?.message : null) ??
    (deleteSlot.isError ? deleteSlot.error?.message : null);

  const handleSave = (): void => {
    updateTopic.mutate(
      { slotId: slot.id, topic: topicDraft },
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

  const provider = accounts[0]?.provider;

  return (
    <section aria-label={t('posts.detailsTitle')} className="mt-6">
      <p className="text-sm text-muted-foreground">
        {formatDateTime(slot.status === 'published' && slot.publishedAt ? slot.publishedAt : slot.slotAt, locale)}
      </p>

      {canWatch && videoUrl ? (
        <DetailPlayer src={videoUrl} placeholder="" />
      ) : slot.status === 'generating' ? (
        <div className="mt-4 rounded-2xl bg-secondary p-6">
          <div className="flex items-center justify-between text-sm font-semibold text-[#0d2b45]">
            <span>{t('posts.videoGenerating')}</span>
            <span>{slot.progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={slot.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#dce6ee]"
          >
            <div className="h-full rounded-full bg-[#0d2b45] transition-all" style={{ width: `${slot.progress}%` }} />
          </div>
          {slot.stage && <p className="mt-2 text-xs text-muted-foreground">{slot.stage}</p>}
        </div>
      ) : (
        <DetailPlayer
          src={null}
          placeholder={slot.status === 'awaiting' ? t('posts.videoPending') : t('posts.coverNoVideo')}
        />
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('posts.topicLabel')}</p>
        {editing ? (
          <div className="mt-2">
            <label className="sr-only" htmlFor="slot-topic">{t('posts.topicLabel')}</label>
            <textarea
              id="slot-topic"
              value={topicDraft}
              onChange={(event) => setTopicDraft(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-input px-3 py-2 text-sm text-[#0d2b45] focus:border-[#0d2b45] focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={updateTopic.isPending || topicDraft.trim() === ''}
                className="rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e] disabled:opacity-50"
              >
                {t('posts.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTopicDraft(slot.topic ?? '');
                }}
                disabled={updateTopic.isPending}
                className="rounded-xl border border-input px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb]"
              >
                {t('posts.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[#0d2b45]">{slot.topic ?? t('posts.unknownTopic')}</p>
        )}
      </div>

      {accounts.length > 0 && (
        <div className="mt-6 flex items-center gap-2">
          {provider && <ProviderIcon provider={provider} />}
          <div className="flex -space-x-1.5">
            {accounts.map((account) => (
              <Avatar key={`${account.provider}:${account.id}`} className="size-7 ring-2 ring-white">
                <AvatarFallback className="bg-secondary text-[10px] font-semibold text-[#0d2b45]">
                  {accountInitials(account.label)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>
      )}

      {slot.status === 'failed' && slot.error && (
        <p className="mt-6 text-sm text-destructive">{slot.error}</p>
      )}

      <PublishLinks links={publishLinks} />

      {mutationError && (
        <p className="mt-6 rounded-xl bg-[#ffe1de] p-3 text-sm text-destructive" role="alert">
          {mutationError}
        </p>
      )}

      {(canEdit || canDelete) && (
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-[#edf2f5] pt-6">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={deleteSlot.isPending}
              className="rounded-xl border border-input px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb]"
            >
              {t('posts.edit')}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteSlot.isPending || updateTopic.isPending}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                armed ? 'bg-[#a1250f] hover:bg-[#8c1f0d]' : 'bg-destructive hover:bg-[#a1250f]'
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

//---------------
// DetailNotFound — unknown id (deleted slot, another user's post) or a
// failed detail fetch: an honest message and a way back, never a blank
// page.
//---------------
const DetailNotFound = ({ message }: { message?: string }) => {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="text-sm font-semibold text-[#0d2b45]">{message ?? t('posts.notFound')}</p>
      <Link href="/posts" className="mt-4 inline-block rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]">
        {t('posts.back')}
      </Link>
    </div>
  );
};

//---------------
// Skeleton
//---------------
const DetailSkeleton = () => (
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
