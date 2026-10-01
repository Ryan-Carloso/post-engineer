'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
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
import { Card, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { ProviderIcon } from '@/components/provider-icon';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { SpinnerIcon } from '@/lib/ui';

//---------------
// PostsPage — post history + upcoming posts on the same page, across all
// connected accounts. Read-only: consumes GET /api/schedule/status with a
// raised limit and joins each slot with its schedule, persona and the
// publishing accounts. No MCP changes.
//---------------

type Tab = 'upcoming' | 'history';
type ProviderFilter = 'all' | 'youtube' | 'instagram' | 'linkedin';

interface AccountOption {
  id: string;
  provider: Exclude<ProviderFilter, 'all'>;
  label: string;
}

//---------------
// resolveAccountFilter — a selected account only stays applied when it
// belongs to the network filter ('all' keeps any account). Unknown ids
// and incompatible networks fall back to 'all'.
//---------------
function resolveAccountFilter(
  accountId: string,
  provider: ProviderFilter,
  accounts: AccountOption[],
): string {
  if (accountId === 'all') return 'all';
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return 'all';
  if (provider !== 'all' && account.provider !== provider) return 'all';
  return accountId;
}

const PROVIDER_FILTERS: ProviderFilter[] = ['all', 'youtube', 'instagram', 'linkedin'];

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
};

//---------------
// Generation history cards — standalone video generations (manual/debug),
// not scheduled posts. A failed generation shows the friendly, translated
// error for its error_code; the raw engine text stays in the database for
// support and is never rendered (it may contain paths or upstream bodies).
//---------------
const GENERATION_STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'posts.statusPending',
  running: 'posts.statusRunning',
  completed: 'posts.statusCompleted',
  failed: 'posts.statusFailed',
};

const GENERATION_ERROR_KEY: Record<string, TranslationKey> = {
  custom_audio_invalid: 'posts.errorCustomAudio',
  engine_unavailable: 'posts.errorEngineUnavailable',
  engine_rejected: 'posts.errorEngineRejected',
  no_task_id: 'posts.errorNoTaskId',
  invalid_task_response: 'posts.errorInvalidTaskResponse',
  unknown: 'posts.errorUnknown',
};

const GenerationCard = ({
  generation,
  locale,
  onOpen,
}: {
  generation: VideoGeneration;
  locale: 'pt' | 'en';
  onOpen: () => void;
}) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const hasThumb = generation.status === 'completed' && videoUrl !== null;
  return (
    <button type="button" onClick={onOpen} className="h-full text-left">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          <span role="img" aria-label="video" className="inline-flex text-[#60758a]">
            <Play className="h-5 w-5" />
          </span>
          <p className="text-xs text-muted-foreground">
            {formatDate(generation.createdAt, locale)} · {formatTime(generation.createdAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <p className="line-clamp-3 text-sm leading-snug text-[#0d2b45]">
              <span className="font-semibold">{generation.personaName ?? t('posts.personaFallback')}</span>
              {' — '}
              <span className="text-[#60758a]">{generation.videoSubject ?? t('posts.unknownTopic')}</span>
            </p>
            {generation.status === 'failed' && (
              <p className="mt-2 line-clamp-2 text-xs text-[#c2301e]">
                {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
              </p>
            )}
          </div>
          <PostThumb src={hasThumb ? videoUrl : null} />
        </div>
        <CardFooter className="mt-auto items-center justify-between p-0 pt-4">
          <span className="min-w-0 truncate text-xs text-[#60758a]">{generation.videoSubject ?? t('posts.unknownTopic')}</span>
          <div className="flex shrink-0 items-center gap-2">
            {generation.tokensRefunded && (
              <Badge variant="outline" className="border-transparent bg-[#cff5df] text-[#167246]">
                {t('posts.refundedBadge')}
              </Badge>
            )}
            <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}`}>
              {t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
            </Badge>
          </div>
        </CardFooter>
      </Card>
    </button>
  );
};

//---------------
// GenerationDetailModal — watch a manual video generation. Completed
// generations stream through the engine download proxy via the stored
// engine task id; failed ones show only the friendly, translated error.
// History-only: no edit/delete actions exist for generations.
//---------------
const GenerationDetailModal = ({
  generation,
  locale,
  onClose,
}: {
  generation: VideoGeneration;
  locale: 'pt' | 'en';
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const videoUrl = videoUrlFor(generation.engineTaskId);
  const canWatch = generation.status === 'completed' && videoUrl !== null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d2b45]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('posts.detailsTitle')}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#0d2b45]">
              {formatDateTime(generation.createdAt, locale)}
            </p>
            <p className="mt-1 text-base font-bold text-[#0d2b45]">
              {generation.personaName ?? t('posts.personaFallback')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[generation.status] ?? STATUS_STYLE.pending}`}>
              {t(GENERATION_STATUS_KEY[generation.status] ?? 'posts.statusPending')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('posts.close')}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-[#60758a] hover:bg-[#f1f6fa]"
            >
              ✕
            </button>
          </div>
        </div>

        <p className="mt-2 text-sm text-[#60758a]">{generation.videoSubject ?? t('posts.unknownTopic')}</p>

        {canWatch && videoUrl && (
          <video
            src={videoUrl}
            controls
            preload="metadata"
            className="mt-4 w-full rounded-xl bg-black"
          />
        )}

        {generation.status === 'failed' && (
          <p className="mt-4 text-xs text-[#c2301e]">
            {t(GENERATION_ERROR_KEY[generation.errorCode ?? 'unknown'] ?? 'posts.errorUnknown')}
          </p>
        )}
        {generation.tokensRefunded && (
          <p className="mt-4">
            <span className="rounded-full bg-[#cff5df] px-2.5 py-1 text-xs font-semibold text-[#167246]">
              {t('posts.refundedBadge')}
            </span>
          </p>
        )}
      </div>
    </div>
  );
};

// Max rows fetched per tab; the API caps ?limit= at 500, the page asks for
// fewer to keep the render cheap. Exported for tests.
export const POSTS_LIMIT = 200;

function formatDateTime(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDate(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
  });
}

function formatTime(value: string, locale: 'pt' | 'en'): string {
  return new Date(value).toLocaleTimeString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    timeStyle: 'short',
  });
}

//---------------
// resolveSlotAccounts — human-readable account labels for one slot, based
// on the schedule's targeted account ids per provider.
//---------------
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

const PostCard = ({
  slot,
  personaName,
  accounts,
  locale,
  onOpen,
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: 'pt' | 'en';
  onOpen: () => void;
}) => {
  const { t } = useI18n();
  const isHistory = slot.status === 'published' || slot.status === 'failed';
  const shownAt = isHistory && slot.publishedAt ? slot.publishedAt : slot.slotAt;
  const videoUrl = videoUrlFor(slot.taskId);
  const hasThumb = SLOT_VIDEO_STATUSES.has(slot.status) && videoUrl !== null;
  const provider = accounts[0]?.provider;
  return (
    <button type="button" onClick={onOpen} className="h-full text-left">
      <Card className={`flex h-full flex-col gap-0 rounded-xl p-4 transition-colors ${CARD_BORDER}`}>
        <div className="flex items-center justify-between gap-2">
          {provider ? <ProviderIcon provider={provider} /> : <span />}
          <p className="text-xs text-muted-foreground">
            {formatDate(shownAt, locale)} · {formatTime(shownAt, locale)}
          </p>
        </div>
        <div className="mt-3 flex gap-3">
          <p className="line-clamp-3 flex-1 text-sm leading-snug text-[#0d2b45]">
            <span className="font-semibold">{personaName}</span>
            {' — '}
            <span className="text-[#60758a]">{slot.topic ?? t('posts.unknownTopic')}</span>
          </p>
          <PostThumb src={hasThumb ? videoUrl : null} />
        </div>
        <CardFooter className="mt-auto items-center justify-between p-0 pt-4">
          <AccountAvatarGroup accounts={accounts} />
          <Badge variant="outline" className={`border-transparent ${STATUS_STYLE[slot.status] ?? STATUS_STYLE.pending}`}>
            {t(STATUS_KEY[slot.status] ?? 'posts.statusPending')}
          </Badge>
        </CardFooter>
      </Card>
      {slot.status === 'failed' && slot.error && (
        <p className="sr-only">{slot.error}</p>
      )}
    </button>
  );
};

//---------------
// accountInitials — compact circular avatars use the account label's
// initials (first letters of up to two tokens, unicode-aware so non-Latin
// accounts get real initials too).
//---------------
function accountInitials(label: string): string {
  const tokens = label.replace(/^@/, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.slice(0, 2).map((token) => token[0]?.toUpperCase() ?? '').join('');
}

const AccountAvatarGroup = ({ accounts }: { accounts: AccountOption[] }) => (
  <div className="flex -space-x-1.5">
    {accounts.slice(0, 4).map((account) => (
      <Avatar key={`${account.provider}:${account.id}`} className="h-6 w-6 ring-2 ring-white">
        <AvatarFallback className="bg-[#f1f6fa] text-[9px] font-semibold text-[#0d2b45]">
          {accountInitials(account.label)}
        </AvatarFallback>
      </Avatar>
    ))}
  </div>
);

//---------------
// PostThumb — the 72×72 thumbnail on the card body's right: the video
// itself (metadata-only preload, muted, control-less — playback happens
// in the detail modal) under a small play glyph. No video yet → a quiet
// muted square.
//---------------
const PostThumb = ({ src }: { src: string | null }) => (
  <div className="relative w-[72px] shrink-0">
    <AspectRatio ratio={1} className="w-[72px] rounded-[9px] bg-[#e8edf1]">
      {src ? (
        <video src={src} preload="metadata" muted playsInline className="size-full object-cover" />
      ) : null}
    </AspectRatio>
    {src && (
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Play className="h-4 w-4 fill-white text-white drop-shadow" />
      </span>
    )}
  </div>
);

const CARD_BORDER = 'border-[#e3ebf1] shadow-[0_1px_2px_rgba(13,43,69,0.05)] hover:border-[#c8d6e0]';

//---------------
// videoUrlFor — the engine download proxy serves the final render for a
// task; only slots whose video was actually produced have one.
//---------------
function videoUrlFor(taskId: string | null | undefined): string | null {
  return taskId ? `/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4` : null;
}

const SLOT_VIDEO_STATUSES = new Set<ScheduledSlot['status']>(['ready', 'publishing', 'published']);

//---------------
// SlotDetailModal — the card's details: video player (when the engine
// produced one), topic, target accounts, and the per-status actions.
// Awaiting slots can have their topic edited (the engine generates the
// video from the stored topic) and be deleted; failed slots can be
// deleted; published posts are watch-only. Mutation errors keep the modal
// open and are shown inline — a committed mutation is never reported as a
// total failure.
//---------------
const SlotDetailModal = ({
  slot,
  personaName,
  accounts,
  locale,
  onClose,
}: {
  slot: ScheduledSlot;
  personaName: string;
  accounts: AccountOption[];
  locale: 'pt' | 'en';
  onClose: () => void;
}) => {
  const { t } = useI18n();
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
    deleteSlot.mutate(slot.id, { onSuccess: onClose });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d2b45]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('posts.detailsTitle')}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#0d2b45]">
              {formatDateTime(slot.status === 'published' && slot.publishedAt ? slot.publishedAt : slot.slotAt, locale)}
            </p>
            <p className="mt-1 text-base font-bold text-[#0d2b45]">{personaName}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[slot.status] ?? STATUS_STYLE.pending}`}>
              {t(STATUS_KEY[slot.status] ?? 'posts.statusPending')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('posts.close')}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-[#60758a] hover:bg-[#f1f6fa]"
            >
              ✕
            </button>
          </div>
        </div>

        {canWatch && videoUrl && (
          <video
            src={videoUrl}
            controls
            preload="metadata"
            className="mt-4 w-full rounded-xl bg-black"
          />
        )}
        {!canWatch && slot.taskId && slot.status === 'generating' && (
          <p className="mt-4 rounded-xl bg-[#f1f6fa] p-3 text-sm text-[#60758a]">{t('posts.videoGenerating')}</p>
        )}
        {!canWatch && slot.status === 'awaiting' && (
          <p className="mt-4 rounded-xl bg-[#f1f6fa] p-3 text-sm text-[#60758a]">{t('posts.videoPending')}</p>
        )}

        <div className="mt-4">
          <p className="text-xs font-semibold tracking-wide text-[#60758a] uppercase">{t('posts.topicLabel')}</p>
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
          <div className="mt-4 flex flex-wrap gap-2">
            {accounts.map((account) => (
              <span key={`${account.provider}:${account.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#f1f6fa] px-2.5 py-1.5 text-xs font-medium text-[#0d2b45]">
                <ProviderDot provider={account.provider} />
                {account.label}
              </span>
            ))}
          </div>
        )}

        {slot.status === 'failed' && slot.error && (
          <p className="mt-4 text-xs text-[#c2301e]">{slot.error}</p>
        )}

        {mutationError && (
          <p className="mt-4 rounded-xl bg-[#ffe1de] p-3 text-sm text-[#c2301e]" role="alert">
            {mutationError}
          </p>
        )}

        {(canEdit || canDelete) && (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#edf2f5] pt-4">
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
      </div>
    </div>
  );
};

const ProviderDot = ({ provider }: { provider: Exclude<ProviderFilter, 'all'> }) => {
  const color = provider === 'youtube' ? 'text-[#ff2d20]' : provider === 'instagram' ? 'text-[#e1306c]' : 'text-[#0a66c2]';
  const glyph = provider === 'youtube' ? '▶' : provider === 'instagram' ? '◎' : 'in';
  return <span className={`font-bold ${color}`}>{glyph}</span>;
};

export default function PostsPage() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  // Open detail modal: the slot is identified by id and re-resolved from
  // the query data on every render, so a refetch updates the open modal
  // instead of showing a stale copy.
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);

  const statusQuery = useScheduleStatusQuery(POSTS_LIMIT);
  const schedulesQuery = useSchedulesQuery();
  const personasQuery = usePersonaListQuery();
  const generationsQuery = useVideoGenerationsQuery(POSTS_LIMIT);
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

  const visibleAccounts = useMemo(
    () => (providerFilter === 'all' ? accountOptions : accountOptions.filter((account) => account.provider === providerFilter)),
    [accountOptions, providerFilter],
  );

  // Switching the network resets the account filter when the account no
  // longer belongs to the selected network.
  const effectiveAccountFilter = useMemo(
    () => resolveAccountFilter(accountFilter, providerFilter, accountOptions),
    [accountFilter, accountOptions, providerFilter],
  );

  // Slots whose schedule was deleted are dropped everywhere — the tab
  // counts and the rendered list must agree, so both derive from these.
  const joinedUpcoming = useMemo(
    () => (statusQuery.data?.upcoming ?? []).filter((slot) => scheduleById.has(slot.scheduleId)),
    [statusQuery.data, scheduleById],
  );
  const joinedRecent = useMemo(
    () => (statusQuery.data?.recent ?? []).filter((slot) => scheduleById.has(slot.scheduleId)),
    [statusQuery.data, scheduleById],
  );

  const filteredSlots = useMemo(() => {
    const slots = tab === 'upcoming' ? joinedUpcoming : joinedRecent;
    return slots.filter((slot) => {
      const schedule = scheduleById.get(slot.scheduleId);
      if (!schedule) return false;
      if (providerFilter !== 'all' && !schedule.providers.includes(providerFilter)) return false;
      if (effectiveAccountFilter !== 'all') {
        const ids = new Set([
          ...schedule.youtubeAccountIds,
          ...schedule.instagramAccountIds,
          ...schedule.linkedinAccountIds,
        ]);
        if (!ids.has(effectiveAccountFilter)) return false;
      }
      return true;
    });
  }, [tab, joinedUpcoming, joinedRecent, scheduleById, providerFilter, effectiveAccountFilter]);

  const isLoading = statusQuery.isLoading || schedulesQuery.isLoading || personasQuery.isLoading || generationsQuery.isLoading;
  const isError = statusQuery.isError || schedulesQuery.isError || personasQuery.isError || generationsQuery.isError;
  const hasActiveFilter = providerFilter !== 'all' || effectiveAccountFilter !== 'all';
  const upcomingCount = joinedUpcoming.length;
  const generations = generationsQuery.data ?? [];
  const historyCount = joinedRecent.length + generations.length;
  // The error state covers all four queries, so retry must refetch all of
  // them — a failed schedules, personas or generations query would otherwise
  // never clear without a full page reload.
  const handleRetry = useCallback(() => {
    void statusQuery.refetch();
    void schedulesQuery.refetch();
    void personasQuery.refetch();
    void generationsQuery.refetch();
  }, [statusQuery, schedulesQuery, personasQuery, generationsQuery]);
  // The fetch truncates at POSTS_LIMIT rows; say so instead of implying the
  // list is complete.
  const activeSlots = tab === 'upcoming' ? joinedUpcoming : joinedRecent;
  const isCapped = activeSlots.length >= POSTS_LIMIT;

  const selectedSlot = selectedSlotId === null
    ? null
    : [...joinedUpcoming, ...joinedRecent].find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedGeneration = selectedGenerationId === null
    ? null
    : generations.find((generation) => generation.id === selectedGenerationId) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#0d2b45]">{t('posts.title')}</h1>
          <p className="mt-1 text-sm text-[#60758a]">{t('posts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={statusQuery.isFetching}
            className="rounded-xl border border-[#d7e2ea] bg-white px-4 py-2 text-sm font-semibold text-[#0d2b45] hover:bg-[#f4f8fb] disabled:opacity-50"
          >
            {t('posts.refresh')}
          </button>
          <Link href="/schedule" className="rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]">
            {t('posts.newSchedule')}
          </Link>
        </div>
      </div>

      <div className="mt-6 flex gap-1 rounded-xl bg-[#edf2f5] p-1">
        {(['upcoming', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-pressed={tab === value}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === value ? 'bg-white text-[#0d2b45] shadow-sm' : 'text-[#60758a] hover:text-[#0d2b45]'
            }`}
          >
            {t(value === 'upcoming' ? 'posts.tabUpcoming' : 'posts.tabHistory')} ({value === 'upcoming' ? upcomingCount : historyCount})
          </button>
        ))}
      </div>

      {isCapped && !isLoading && !isError && (
        <p className="mt-3 text-xs text-[#60758a]">{t('posts.listCapped', { count: POSTS_LIMIT })}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#60758a]">
          {t('posts.filterProvider')}
          <select
            value={providerFilter}
            onChange={(event) => {
              const next = event.target.value as ProviderFilter;
              setProviderFilter(next);
              // A selected account that doesn't belong to the new network
              // would otherwise linger in state and silently reactivate when
              // switching back — reset it instead.
              setAccountFilter((current) => resolveAccountFilter(current, next, accountOptions));
            }}
            className="rounded-xl border border-[#d7e2ea] bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
          >
            <option value="all">{t('posts.allProviders')}</option>
            {PROVIDER_FILTERS.filter((provider) => provider !== 'all').map((provider) => (
              <option key={provider} value={provider}>
                {provider === 'youtube' ? 'YouTube' : provider === 'instagram' ? 'Instagram' : 'LinkedIn'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#60758a]">
          {t('posts.filterAccount')}
          <select
            value={effectiveAccountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
            className="rounded-xl border border-[#d7e2ea] bg-white px-3 py-2 text-sm font-medium text-[#0d2b45]"
          >
            <option value="all">{t('posts.allAccounts')}</option>
            {visibleAccounts.map((account) => (
              <option key={`${account.provider}:${account.id}`} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#60758a]">
            <SpinnerIcon /> {t('posts.refresh')}…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-[#d7e2ea] bg-white p-8 text-center">
            <p className="text-sm font-semibold text-[#0d2b45]">{t('posts.loadError')}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-xl bg-[#0d2b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123a5e]"
            >
              {t('posts.refresh')}
            </button>
          </div>
        ) : (
          <>
            {tab === 'history' && (
              <section aria-label={t('posts.generationsTitle')} className="mb-8">
                <h2 className="text-base font-bold tracking-[-0.01em] text-[#0d2b45]">
                  {t('posts.generationsTitle')}
                </h2>
                {generations.length === 0 ? (
                  <p className="mt-3 text-sm text-[#60758a]">{t('posts.generationsEmpty')}</p>
                ) : (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {generations.map((generation) => (
                      <GenerationCard
                        key={generation.id}
                        generation={generation}
                        locale={locale}
                        onOpen={() => setSelectedGenerationId(generation.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
            {filteredSlots.length === 0 ? (
              <div className="rounded-xl border border-[#d7e2ea] bg-white p-8 text-center text-sm text-[#60758a]">
                {hasActiveFilter
                  ? t('posts.noResultsForFilter')
                  : t(tab === 'upcoming' ? 'posts.noUpcoming' : 'posts.noHistory')}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredSlots.map((slot) => (
                  <PostCard
                    key={slot.id}
                    slot={slot}
                    personaName={personaNameById.get(scheduleById.get(slot.scheduleId)?.personaId ?? '') ?? t('posts.personaFallback')}
                    accounts={resolveSlotAccounts(scheduleById.get(slot.scheduleId), accountOptions)}
                    locale={locale}
                    onOpen={() => setSelectedSlotId(slot.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {selectedSlot && (
        <SlotDetailModal
          slot={selectedSlot}
          personaName={personaNameById.get(scheduleById.get(selectedSlot.scheduleId)?.personaId ?? '') ?? t('posts.personaFallback')}
          accounts={resolveSlotAccounts(scheduleById.get(selectedSlot.scheduleId), accountOptions)}
          locale={locale}
          onClose={() => setSelectedSlotId(null)}
        />
      )}

      {selectedGeneration && (
        <GenerationDetailModal
          generation={selectedGeneration}
          locale={locale}
          onClose={() => setSelectedGenerationId(null)}
        />
      )}
    </div>
  );
}
