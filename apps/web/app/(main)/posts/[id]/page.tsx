'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  useScheduleStatusQuery,
  useSchedulesQuery,
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useVideoGenerationsQuery,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
  type ScheduledSlot,
  type ScheduleConfig,
  type VideoGeneration,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';

//---------------
// PostDetailPage (/posts/[id]) — the full-page replacement for the old
// detail modal: big video player when the engine produced one, live
// progress while generating, topic editing for awaiting slots, delete for
// awaiting/failed slots. The route param carries the id only; the slot or
// generation is resolved from the React Query cache every render, so a
// refetch updates the page in place.
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

const GENERATIONS_LIMIT = 200;
const SLOTS_LIMIT = 200;

function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);

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

function resolveSlotAccounts(
  schedule: ScheduleConfig | undefined,
  accounts: AccountOption[],
): AccountOption[] {
  if (!schedule) return [];
  const ids = new Set([
    ...schedule.youtubeAccountIds,
    ...schedule.instagramAccountIds,
    ...schedule.linkedinAccountIds,
  ]);
  return accounts.filter((account) => ids.has(account.id));
}

export default function PostDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';

  const statusQuery = useScheduleStatusQuery(SLOTS_LIMIT);
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const generationsQuery = useVideoGenerationsQuery(GENERATIONS_LIMIT);
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();

  const scheduleById = useMemo(
    () => new Map((schedulesQuery.data ?? []).map((schedule) => [schedule.id, schedule])),
    [schedulesQuery.data],
  );
  const personaNameById = useMemo(
    () => new Map((personasQuery.data ?? []).map((persona) => [persona.id, persona.name])),
    [personasQuery.data],
  );
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

  const isLoading =
    statusQuery.isLoading || schedulesQuery.isLoading || personasQuery.isLoading || generationsQuery.isLoading;

  const slot = useMemo(() => {
    const all = [...(statusQuery.data?.upcoming ?? []), ...(statusQuery.data?.recent ?? [])];
    return all.find((item) => item.id === id) ?? null;
  }, [statusQuery.data, id]);
  const generation = useMemo(
    () => (generationsQuery.data ?? []).find((item) => item.id === id) ?? null,
    [generationsQuery.data, id],
  );

  if (isLoading) return <DetailSkeleton />;
  if (!slot && !generation) return <DetailNotFound />;

  if (generation) {
    const videoUrl = generation.status === 'completed' ? videoUrlFor(generation.engineTaskId) : null;
    return (
      <div className="mx-auto max-w-3xl">
        <DetailHeader
          title={generation.personaName ?? t('posts.personaFallback')}
          statusLabel={t(STATUS_KEY[generation.status] ?? 'posts.statusPending')}
          statusStyle={STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}
        />
        <section aria-label={t('posts.detailsTitle')} className="mt-6">
          <p className="text-sm text-[#60758a]">
            {formatDateTime(generation.createdAt, locale)} · {generation.videoSubject ?? t('posts.unknownTopic')}
          </p>
          <DetailPlayer
            src={videoUrl}
            placeholder={t('posts.coverNoVideo')}
          />
          {generation.status === 'failed' && (
            <p className="mt-4 text-sm text-[#c2301e]">
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

  const slotEntity = slot as ScheduledSlot;
  const schedule = scheduleById.get(slotEntity.scheduleId);
  const personaName = personaNameById.get(schedule?.personaId ?? '') ?? t('posts.personaFallback');
  const accounts = resolveSlotAccounts(schedule, accountOptions);
  return (
    <div className="mx-auto max-w-3xl">
      <DetailHeader
        title={personaName}
        statusLabel={t(STATUS_KEY[slotEntity.status] ?? 'posts.statusPending')}
        statusStyle={STATUS_STYLE[slotEntity.status] ?? STATUS_STYLE.pending}
      />
      <SlotDetail slot={slotEntity} accounts={accounts} locale={locale} />
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
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#d7e2ea] bg-white text-[#0d2b45] hover:bg-[#f4f8fb]"
        >
          <ArrowLeft className="h-4 w-4" />
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
// DetailPlayer — the full-width player section. No video yet (awaiting,
// generating, failed or a generation that never completed) renders the
// reason, never a broken player.
//---------------
const DetailPlayer = ({ src, placeholder }: { src: string | null; placeholder: string }) => (
  <div className="mt-4 overflow-hidden rounded-2xl bg-black">
    {src ? (
      <video src={src} controls preload="metadata" className="aspect-video w-full" />
    ) : (
      <div className="flex aspect-video w-full items-center justify-center text-sm font-medium text-[#8aa2b5]">
        {placeholder}
      </div>
    )}
  </div>
);

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
}: {
  slot: ScheduledSlot;
  accounts: AccountOption[];
  locale: 'pt' | 'en';
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
      <p className="text-sm text-[#60758a]">
        {formatDateTime(slot.status === 'published' && slot.publishedAt ? slot.publishedAt : slot.slotAt, locale)}
      </p>

      {canWatch && videoUrl ? (
        <DetailPlayer src={videoUrl} placeholder="" />
      ) : slot.status === 'generating' ? (
        <div className="mt-4 rounded-2xl bg-[#f1f6fa] p-6">
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
          {slot.stage && <p className="mt-2 text-xs text-[#60758a]">{slot.stage}</p>}
        </div>
      ) : (
        <DetailPlayer
          src={null}
          placeholder={slot.status === 'awaiting' ? t('posts.videoPending') : t('posts.coverNoVideo')}
        />
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#60758a]">{t('posts.topicLabel')}</p>
        {editing ? (
          <div className="mt-2">
            <label className="sr-only" htmlFor="slot-topic">{t('posts.topicLabel')}</label>
            <textarea
              id="slot-topic"
              value={topicDraft}
              onChange={(event) => setTopicDraft(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-[#d7e2ea] px-3 py-2 text-sm text-[#0d2b45] focus:border-[#0d2b45] focus:outline-none"
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
                className="rounded-xl border border-[#d7e2ea] px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb]"
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
              <Avatar key={`${account.provider}:${account.id}`} className="h-7 w-7 ring-2 ring-white">
                <AvatarFallback className="bg-[#f1f6fa] text-[10px] font-semibold text-[#0d2b45]">
                  {accountInitials(account.label)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>
      )}

      {slot.status === 'failed' && slot.error && (
        <p className="mt-6 text-sm text-[#c2301e]">{slot.error}</p>
      )}

      {mutationError && (
        <p className="mt-6 rounded-xl bg-[#ffe1de] p-3 text-sm text-[#c2301e]" role="alert">
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
              className="rounded-xl border border-[#d7e2ea] px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb]"
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
                armed ? 'bg-[#a1250f] hover:bg-[#8c1f0d]' : 'bg-[#c2301e] hover:bg-[#a1250f]'
              }`}
            >
              {armed ? t('posts.deleteConfirm') : t('posts.delete')}
            </button>
          )}
          {canDelete && armed && (
            <span className="text-xs text-[#60758a]">{t('posts.deleteTokenNote')}</span>
          )}
        </div>
      )}
    </section>
  );
};

//---------------
// DetailNotFound — unknown id (deleted slot, another user's post): an
// honest message and a way back, never a blank page.
//---------------
const DetailNotFound = () => {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl py-16 text-center">
      <p className="text-sm font-semibold text-[#0d2b45]">{t('posts.notFound')}</p>
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
      <div className="h-9 w-9 rounded-full bg-[#e8edf1]" />
      <div className="h-6 w-48 rounded-lg bg-[#e8edf1]" />
    </div>
    <div className="mt-6 aspect-video w-full rounded-2xl bg-[#e8edf1]" />
    <div className="mt-6 h-4 w-3/4 rounded bg-[#e8edf1]" />
    <div className="mt-3 h-4 w-1/2 rounded bg-[#e8edf1]" />
  </div>
);
