'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUploadStore, useNewPostStore, type NewPostOutcome } from '@/lib/store';
import {
  usePersonaListQuery,
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useBlueskyAccountsQuery,
  useCreatePostMutation,
  type CreatePostInput,
  type CreatePostResult,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import {
  AccountsIcon,
  CalendarIcon,
  CoinsIcon,
  ComposeIcon,
  FilmIcon,
  GlobeIcon,
  PlusIcon,
  SpinnerIcon,
  TrashIcon,
  AlertIcon,
  CheckIcon,
  SparklesIcon,
  INPUT_CLASS,
  SECTION_LABEL_CLASS,
} from '@/lib/ui';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import AccountCard from '@/components/account-card';
import PersonaAvatar from '@/components/persona-avatar';
import { ProviderIcon } from '@/components/provider-icon';
import { cn } from '@/lib/utils';
import { distributeSlots, MAX_POST_TOPICS } from '@/lib/schedule/slot-distribution';
import { parseZonedDateTime } from '@/lib/timezone';
import {
  validateScheduleWindow,
  SCHEDULE_MIN_ADVANCE_HOURS,
  SCHEDULE_MAX_AHEAD_DAYS,
} from '@/lib/schedule-window';
import { computeVideoTokens, type FaceQuality } from '@/lib/tokens';

//---------------
// NewPostPage — creates a post: pick the persona, 1-10 topics, the accounts
// to publish on and the times, then send ONE generate-and-schedule request
// (the video and its publish slot are born together).
//
// The draft lives in the zustand store (lib/store.ts) and the read data comes
// from React Query, so every local component below reads straight from the
// source instead of receiving props.
//---------------

// Short timezone list; the browser timezone goes first, so the common case
// needs no scrolling. The server validates the zone (isValidTimezone) and
// rejects anything unknown.
const COMMON_TIMEZONES = [
  'UTC',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

// Form card: the same shell as the persona/personas screens.
const CARD_CLASS = 'rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6';
const PRIMARY_BUTTON_CLASS =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4';
const ICON_BUTTON_CLASS =
  'flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 [&_svg]:size-4';

//---------------
// ERROR_KEY_BY_CODE — server failure code (lib/error-codes.ts) to translated
// text. Unknown codes fall back to the generic message: the raw server text is
// English and must never appear on a localized screen.
//---------------
const ERROR_KEY_BY_CODE: Record<string, TranslationKey> = {
  PERSONA_NOT_FOUND: 'newPost.errorPersonaNotFound',
  PERSONA_SCOPE_DENIED: 'newPost.errorPersonaScopeDenied',
  SOCIAL_ACCOUNT_NOT_OWNED: 'newPost.errorAccountNotOwned',
  INVALID_PROVIDER_ACCOUNT: 'newPost.errorInvalidProviderAccount',
  NO_CONNECTED_ACCOUNTS: 'newPost.errorNoConnectedAccounts',
  TOPICS_REQUIRED: 'newPost.errorTopicsRequired',
  TOPICS_LIMIT_EXCEEDED: 'newPost.errorTopicsLimit',
  INVALID_SCHEDULE_TIME: 'newPost.errorInvalidScheduleTime',
  SCHEDULE_OUT_OF_RANGE: 'newPost.errorScheduleOutOfRange',
  INSUFFICIENT_TOKENS: 'newPost.errorInsufficientTokens',
  RATE_LIMIT_EXCEEDED: 'newPost.errorRateLimited',
  ENGINE_UNAVAILABLE: 'newPost.errorEngineUnavailable',
};

export default function NewPostPage() {
  const personasQuery = usePersonaListQuery();
  const createPost = useCreatePostMutation();
  const router = useRouter();
  const result = useNewPostStore((s) => s.result);

  const personas = personasQuery.data ?? [];

  //---------------
  // The result lives in the store (so the local components render it without
  // props), which means it survives navigation: drop the previous visit's
  // result on mount, otherwise coming back here would replay the redirect and
  // the success banner. The typed draft is preserved.
  //---------------
  useEffect(() => {
    useNewPostStore.getState().setResult(null);
    useNewPostStore.getState().setValidationKey(null);
  }, []);

  //---------------
  // On success the schedule exists: go back to the posts list, which was
  // already refetched (the mutation invalidated the caches) and shows the new
  // slots. A partial failure keeps the user here so the error stays visible.
  //
  // We read the live store value, not this render's `result`: the mount effect
  // above clears an old result in the same commit, so the render's value would
  // still be the previous visit's success.
  //---------------
  useEffect(() => {
    const current = useNewPostStore.getState().result;
    if (current !== null && current.success) router.push('/posts');
    // `result` is the trigger: the store write re-renders this screen.
  }, [result, router]);

  if (personasQuery.isLoading) return <NewPostPageSkeleton />;
  if (personasQuery.isError) return <NewPostLoadError />;
  if (personas.length === 0) return <NewPostNoPersonas />;

  return (
    <div className="space-y-6">
      <NewPostHeader />
      <NewPostFeedback />
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(createPost.mutateAsync);
        }}
      >
        <div className="space-y-6">
          <NewPostPersonaField />
          <NewPostFaceField />
          <NewPostTopicsField />
          <NewPostAccountsField />
          <NewPostScheduleField />
        </div>
        <div className="space-y-6 lg:sticky lg:top-6">
          <NewPostPreviewCard />
          <NewPostCostSummary />
          <NewPostSubmitRow />
        </div>
      </form>
    </div>
  );
}

//---------------
// handleSubmit — builds the request from the store draft, calls the single
// generate-and-schedule operation and keeps the result for the banner. The
// local guards reject with a translated key and send nothing: the API charges
// tokens, so a request that cannot succeed must never leave the browser.
//---------------
async function handleSubmit(
  mutateAsync: (input: CreatePostInput) => Promise<CreatePostResult>,
): Promise<void> {
  const store = useNewPostStore.getState();
  const { selectedAccountIds } = useUploadStore.getState();
  const filledTopics = store.topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0);
  const filledTimes = store.times.map((time) => time.trim()).filter((time) => time.length > 0);
  const startInstant = parseZonedDateTime(store.startAt, store.timezone);

  const accounts: Record<string, string[]> = {};
  const providers: string[] = [];
  for (const [provider, ids] of Object.entries(selectedAccountIds)) {
    if (ids.length === 0) continue;
    accounts[provider] = ids;
    providers.push(provider);
  }

  const rejection: TranslationKey | null =
    store.personaId.trim().length === 0
      ? 'newPost.personaRequired'
      : filledTopics.length === 0
        ? 'newPost.errorTopicsRequired'
        : filledTimes.length === 0
          ? 'newPost.errorInvalidScheduleTime'
          : startInstant === null
            ? 'newPost.previewEmpty'
            : providers.length === 0
              ? 'publishing.mustSelectAccount'
              : null;

  if (rejection !== null) {
    store.setValidationKey(rejection);
    store.setResult(null);
    return;
  }
  // startInstant is non-null after the guard above; the null branch keeps the
  // types honest without an assertion.
  if (startInstant === null) return;

  store.setValidationKey(null);
  store.setPending(true);
  try {
    const response = await mutateAsync({
      personaId: store.personaId.trim(),
      topics: filledTopics,
      providers,
      accounts,
      startAt: startInstant.toISOString(),
      times: filledTimes,
      timezone: store.timezone,
      faceless: store.faceless,
    });
    // Projects the response onto what the banner reads: the raw API error text
    // never enters the store (the UI translates by code).
    const outcome: NewPostOutcome = {
      success: response.success,
      scheduleId: response.scheduleId,
      slotCount: response.slots.length,
      code: response.code,
      need: response.need,
      have: response.have,
    };
    store.setResult(outcome);
  } finally {
    store.setPending(false);
  }
}

/* -----------------
   Local Components
------------------ */

//---------------
// Header: back to the posts + screen identity.
//---------------
const NewPostHeader = () => {
  const { t } = useI18n();
  return (
    <header className="space-y-4">
      <Link
        href="/posts"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900"
      >
        ← {t('newPost.backToPosts')}
      </Link>
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
          <ComposeIcon />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{t('newPost.title')}</h1>
          <p className="text-sm text-neutral-500">{t('newPost.subtitle')}</p>
        </div>
      </div>
    </header>
  );
};

//---------------
// Feedback banner: local rejection, server failure code, or the success
// state (the screen redirects right after).
//---------------
const NewPostFeedback = () => {
  const { t } = useI18n();
  const result = useNewPostStore((s) => s.result);
  const validationKey = useNewPostStore((s) => s.validationKey);
  const params: Record<string, string | number> = {
    max: MAX_POST_TOPICS,
    minHours: SCHEDULE_MIN_ADVANCE_HOURS,
    maxDays: SCHEDULE_MAX_AHEAD_DAYS,
    need: result?.need ?? 0,
    have: result?.have ?? 0,
  };

  if (result !== null && result.success) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
          <CheckIcon />
        </span>
        <div>
          <p className="text-sm font-semibold text-green-900">{t('newPost.successTitle')}</p>
          <p className="mt-0.5 text-sm text-green-800">
            {t(pluralKey(result.slotCount, 'newPost.successHintOne', 'newPost.successHint'), {
              count: result.slotCount,
            })}
          </p>
        </div>
      </div>
    );
  }

  const key =
    validationKey !== null
      ? validationKey
      : result !== null
        ? (ERROR_KEY_BY_CODE[result.code ?? ''] ?? 'newPost.errorGeneric')
        : null;
  if (key === null) return null;

  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
        <AlertIcon />
      </span>
      <div>
        <p className="text-sm font-semibold text-red-900">{t('newPost.errorTitle')}</p>
        <p className="mt-0.5 text-sm text-red-800">
          {t(key, params)}
          {result !== null && result.scheduleId !== null ? ` ${t('newPost.successPartial')}` : ''}
        </p>
      </div>
    </div>
  );
};

//---------------
// Persona — required: it renders the face and brings the voice, so a post
// does not exist without one.
//
// shadcn RadioGroup + Label instead of <select>: the persona is the most
// important object in the form and needs the photo (the same avatar as the
// card in /personas) — a native select shows no image.
//
// shadcn's RadioGroupItem is a leaf (it draws the dot and discards children),
// so it stays the real control, `sr-only` + `id`, and the card is a Label
// pointing at it: clicking the card selects, and the item remains the keyboard
// and screen-reader target.
//---------------
const NewPostPersonaField = () => {
  const { t } = useI18n();
  const personasQuery = usePersonaListQuery();
  const personaId = useNewPostStore((s) => s.personaId);
  const setPersonaId = useNewPostStore((s) => s.setPersonaId);
  return (
    <section className={cn(CARD_CLASS, 'space-y-4')}>
      <SectionTitle icon={<FilmIcon />} label={t('newPost.personaLabel')} hint={t('newPost.personaHint')} />
      <RadioGroup
        value={personaId}
        onValueChange={setPersonaId}
        aria-label={t('newPost.personaLabel')}
        className="grid gap-3"
      >
        {(personasQuery.data ?? []).map((persona) => {
          const itemId = `new-post-persona-${persona.id}`;
          const selected = personaId === persona.id;
          return (
            <Label
              key={persona.id}
              htmlFor={itemId}
              data-selected={selected ? 'true' : 'false'}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-2xl border bg-white p-3 transition-colors',
                // Focus uses the same navy as the selection (the `ring` token is
                // a different blue and would fight the selected ring).
                'has-focus-visible:ring-2 has-focus-visible:ring-accent/40 has-focus-visible:ring-offset-2',
                selected
                  ? 'border-accent bg-accent/5 ring-1 ring-accent'
                  : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50',
              )}
            >
              <RadioGroupItem value={persona.id} id={itemId} aria-label={persona.name} className="sr-only" />
              <PersonaAvatar
                avatarUrl={persona.avatarUrl}
                photoUrl={persona.photoUrl}
                name={persona.name}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-900">{persona.name}</span>
                <span className="mt-0.5 block truncate text-xs text-neutral-500">
                  {persona.niche ?? t('newPost.personaNoNiche')}
                </span>
              </span>
              {selected ? (
                <span className="shrink-0 text-accent">
                  <CheckIcon />
                </span>
              ) : null}
            </Label>
          );
        })}
      </RadioGroup>
    </section>
  );
};

//---------------
// Video face — every persona has a face; "no face" is chosen here, per
// post (100% stock footage, no lipsync, no library image). The persona is
// still required: it supplies the voice, the niche and the script. Same card
// pattern as the persona picker above: shadcn RadioGroup as the sr-only item
// + Label as the clickable card.
//---------------
const NewPostFaceField = () => {
  const { t } = useI18n();
  const faceless = useNewPostStore((s) => s.faceless);
  const setFaceless = useNewPostStore((s) => s.setFaceless);

  const options = [
    { value: 'face', faceless: false, label: t('newPost.faceWithAvatar'), hint: t('newPost.faceWithAvatarHint') },
    { value: 'faceless', faceless: true, label: t('newPost.faceFaceless'), hint: t('newPost.faceFacelessHint') },
  ] as const;

  return (
    <section className={cn(CARD_CLASS, 'space-y-4')}>
      <SectionTitle icon={<SparklesIcon />} label={t('newPost.faceLabel')} hint={t('newPost.faceHint')} />
      <RadioGroup
        value={faceless ? 'faceless' : 'face'}
        onValueChange={(value) => setFaceless(value === 'faceless')}
        aria-label={t('newPost.faceLabel')}
        className="grid gap-3"
      >
        {options.map((option) => {
          const itemId = `new-post-face-${option.value}`;
          const selected = faceless === option.faceless;
          return (
            <Label
              key={option.value}
              htmlFor={itemId}
              data-selected={selected ? 'true' : 'false'}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 transition-colors',
                'has-focus-visible:ring-2 has-focus-visible:ring-accent/40 has-focus-visible:ring-offset-2',
                selected
                  ? 'border-accent bg-accent/5 ring-1 ring-accent'
                  : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50',
              )}
            >
              <RadioGroupItem
                value={option.value}
                id={itemId}
                aria-label={option.label}
                className="sr-only"
              />
              <span
                className={cn(
                  'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
                  selected ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500',
                )}
              >
                {option.faceless ? <FilmIcon /> : <SparklesIcon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-900">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-neutral-500">{option.hint}</span>
              </span>
              {selected ? (
                <span className="mt-0.5 shrink-0 text-accent">
                  <CheckIcon />
                </span>
              ) : null}
            </Label>
          );
        })}
      </RadioGroup>
    </section>
  );
};

//---------------
// Topics — one video per row. "Add topic" stops at the shared limit
// (MAX_POST_TOPICS), the same number the API enforces.
//---------------
const NewPostTopicsField = () => {
  const { t } = useI18n();
  const topics = useNewPostStore((s) => s.topics);
  const setTopic = useNewPostStore((s) => s.setTopic);
  const addTopic = useNewPostStore((s) => s.addTopic);
  const removeTopic = useNewPostStore((s) => s.removeTopic);
  const atCap = topics.length >= MAX_POST_TOPICS;
  return (
    <section className={cn(CARD_CLASS, 'space-y-4')}>
      <SectionTitle
        icon={<FilmIcon />}
        label={t('newPost.topicsLabel')}
        hint={t('newPost.topicsHint', { max: MAX_POST_TOPICS })}
      />
      <div className="space-y-2">
        {topics.map((topic, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-500">
              {index + 1}
            </span>
            <input
              type="text"
              value={topic}
              placeholder={t('newPost.topicPlaceholder')}
              aria-label={`${t('newPost.topicsLabel')} ${index + 1}`}
              onChange={(event) => setTopic(index, event.target.value)}
              className={cn(INPUT_CLASS, 'mt-0')}
            />
            <button
              type="button"
              onClick={() => removeTopic(index)}
              disabled={topics.length <= 1}
              aria-label={`${t('newPost.removeTopic')} ${index + 1}`}
              className={ICON_BUTTON_CLASS}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addTopic} disabled={atCap} className={SECONDARY_BUTTON_CLASS}>
        <PlusIcon />
        {t('newPost.addTopic')}
      </button>
    </section>
  );
};

//---------------
// Accounts — the same cards as the accounts screen (AccountCard: real
// account thumbnail + selection checkbox), grouped by network with the
// network glyph. The selection is app-wide state (useUploadStore), the same
// one /accounts writes: a channel checked there is checked here too.
//---------------
const NewPostAccountsField = () => {
  const { t } = useI18n();
  const youtube = useYouTubeAccountsQuery();
  const instagram = useInstagramAccountsQuery();
  const linkedin = useLinkedinAccountsQuery();
  const bluesky = useBlueskyAccountsQuery();
  const selected = useUploadStore((s) => s.selectedAccountIds);
  const toggle = useUploadStore((s) => s.toggleSelectedAccount);

  const groups = useMemo(
    () => [
      {
        provider: 'youtube' as const,
        label: 'YouTube',
        cards: (youtube.data?.accounts ?? []).map((account) => (
          <AccountCard
            key={`${account.provider}:${account.channelId}`}
            type="youtube"
            name={account.channelName}
            email={account.email}
            thumbnail={account.thumbnail}
            selected={selected.youtube.includes(account.channelId)}
            onSelect={() => toggle('youtube', account.channelId)}
          />
        )),
      },
      {
        provider: 'instagram' as const,
        label: 'Instagram',
        cards: (instagram.data?.accounts ?? []).map((account) => (
          <AccountCard
            key={`${account.provider}:${account.igUserId}`}
            type="instagram"
            name={`@${account.username}`}
            thumbnail={account.profilePictureUrl}
            selected={selected.instagram.includes(account.igUserId)}
            onSelect={() => toggle('instagram', account.igUserId)}
          />
        )),
      },
      {
        provider: 'linkedin' as const,
        label: 'LinkedIn',
        cards: (linkedin.data?.accounts ?? []).map((account) => (
          <AccountCard
            key={`${account.provider}:${account.providerAccountId}`}
            type="linkedin"
            name={account.accountName ?? account.providerAccountId}
            selected={selected.linkedin.includes(account.providerAccountId)}
            onSelect={() => toggle('linkedin', account.providerAccountId)}
          />
        )),
      },
      {
        provider: 'bluesky' as const,
        label: 'Bluesky',
        cards: (bluesky.data?.accounts ?? []).map((account) => (
          <AccountCard
            key={`${account.provider}:${account.did}`}
            type="bluesky"
            name={account.handle}
            handle={`@${account.handle}`}
            selected={selected.bluesky.includes(account.did)}
            onSelect={() => toggle('bluesky', account.did)}
          />
        )),
      },
    ],
    [youtube.data, instagram.data, linkedin.data, bluesky.data, selected, toggle],
  );

  const connectedCount = groups.reduce((total, group) => total + group.cards.length, 0);

  return (
    <section className={cn(CARD_CLASS, 'space-y-4')}>
      <SectionTitle icon={<AccountsIcon />} label={t('newPost.accountsLabel')} hint={t('newPost.accountsHint')} />
      {connectedCount === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
          <p className="text-sm text-neutral-600">{t('newPost.accountsNone', { provider: 'YouTube' })}</p>
          <Button variant="outline" className="mt-4 border-dashed" asChild>
            <Link href="/accounts">
              <PlusIcon />
              {t('newPost.connectAccounts')}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.provider}>
              <div className="flex items-center gap-2">
                <ProviderIcon provider={group.provider} />
                <p className="text-sm font-semibold text-neutral-900">{group.label}</p>
                <Badge variant="secondary" className="text-[11px]">
                  {group.cards.length}
                </Badge>
                {group.cards.length === 0 && (
                  <span className="text-xs text-neutral-400">
                    {t('newPost.accountsNone', { provider: group.label })}
                  </span>
                )}
              </div>
              {group.cards.length > 0 && (
                // One column: the account card already has avatar + name +
                // checkbox, and the form column is narrow — two columns cut
                // the name in half.
                <div className="mt-2 grid grid-cols-1 gap-3">{group.cards}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

//---------------
// Publishing plan — the first publish (wall-clock time + timezone) and the
// daily times.
//---------------
const NewPostScheduleField = () => {
  const { t } = useI18n();
  const startAt = useNewPostStore((s) => s.startAt);
  const times = useNewPostStore((s) => s.times);
  const timezone = useNewPostStore((s) => s.timezone);
  const setStartAt = useNewPostStore((s) => s.setStartAt);
  const setTime = useNewPostStore((s) => s.setTime);
  const addTime = useNewPostStore((s) => s.addTime);
  const removeTime = useNewPostStore((s) => s.removeTime);
  const setTimezone = useNewPostStore((s) => s.setTimezone);

  const timezoneOptions = useMemo(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return [...new Set([browserZone, timezone, ...COMMON_TIMEZONES])];
  }, [timezone]);

  return (
    <section className={cn(CARD_CLASS, 'space-y-5')}>
      <SectionTitle
        icon={<CalendarIcon />}
        label={t('newPost.startAtLabel')}
        hint={t('newPost.startAtHint')}
      />
      <input
        type="datetime-local"
        value={startAt}
        aria-label={t('newPost.startAtLabel')}
        onChange={(event) => setStartAt(event.target.value)}
        className={cn(INPUT_CLASS, 'mt-0')}
      />

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <GlobeIcon />
          {t('newPost.timezoneLabel')}
        </label>
        <p className="mt-1 text-xs text-neutral-500">{t('newPost.timezoneHint')}</p>
        <select
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          aria-label={t('newPost.timezoneLabel')}
          className={cn(INPUT_CLASS, 'cursor-pointer')}
        >
          {timezoneOptions.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-neutral-700">{t('newPost.timesLabel')}</p>
        <p className="mt-1 text-xs text-neutral-500">{t('newPost.timesHint')}</p>
        <div className="mt-3 space-y-2">
          {times.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="time"
                value={time}
                aria-label={`${t('newPost.timesLabel')} ${index + 1}`}
                onChange={(event) => setTime(index, event.target.value)}
                className={cn(INPUT_CLASS, 'mt-0')}
              />
              <button
                type="button"
                onClick={() => removeTime(index)}
                disabled={times.length <= 1}
                aria-label={`${t('newPost.removeTime')} ${index + 1}`}
                className={ICON_BUTTON_CLASS}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addTime} className={cn(SECONDARY_BUTTON_CLASS, 'mt-3')}>
          <PlusIcon />
          {t('newPost.addTime')}
        </button>
      </div>
    </section>
  );
};

//---------------
// Schedule preview — computed by the SAME distributeSlots the API calls, so
// what the user sees is what will be created, with a warning when a slot falls
// outside the 3h-30d window.
//---------------
const NewPostPreviewCard = () => {
  const { t, locale } = useI18n();
  const startAt = useNewPostStore((s) => s.startAt);
  const times = useNewPostStore((s) => s.times);
  const timezone = useNewPostStore((s) => s.timezone);
  const topics = useNewPostStore((s) => s.topics);

  const filledTopics = useMemo(
    () => topics.map((topic) => topic.trim()).filter((topic) => topic.length > 0),
    [topics],
  );
  const filledTimes = useMemo(
    () => times.map((time) => time.trim()).filter((time) => time.length > 0),
    [times],
  );

  const preview = useMemo(() => {
    if (startAt.trim().length === 0 || filledTopics.length === 0 || filledTimes.length === 0) return null;
    const startInstant = parseZonedDateTime(startAt, timezone);
    if (startInstant === null) return null;
    try {
      return distributeSlots({
        startAtISO: startInstant.toISOString(),
        times: filledTimes,
        timezone,
        count: filledTopics.length,
      });
    } catch {
      return null;
    }
  }, [startAt, timezone, filledTopics, filledTimes]);

  const outOfWindow =
    preview !== null && preview.some((slot) => !validateScheduleWindow(new Date(slot.slotAtISO)).ok);

  const dateFormatter = new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'medium',
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
    timeStyle: 'short',
    timeZone: timezone,
  });

  return (
    <section className={cn(CARD_CLASS, 'space-y-4')}>
      <SectionTitle icon={<CalendarIcon />} label={t('newPost.previewTitle')} />
      {preview === null ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-xs text-neutral-500">
          {t('newPost.previewEmpty')}
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {preview.map((slot, index) => {
              const instant = new Date(slot.slotAtISO);
              return (
                <li key={slot.slotAtISO} className="flex items-start gap-3">
                  <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-neutral-900">
                      {dateFormatter.format(instant)}
                      <span className="mx-1.5 text-neutral-300">·</span>
                      {timeFormatter.format(instant)}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{filledTopics[index]}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {outOfWindow && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {t('newPost.previewOutOfWindow', {
                minHours: SCHEDULE_MIN_ADVANCE_HOURS,
                maxDays: SCHEDULE_MAX_AHEAD_DAYS,
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
};

//---------------
// Estimated cost — the same per-video price the route charges
// (computeVideoTokens), times the number of topics. No face costs the
// faceless price; with the face, the persona's chosen quality price. It is an
// estimate; the server is the billing authority.
//---------------
const NewPostCostSummary = () => {
  const { t } = useI18n();
  const personaId = useNewPostStore((s) => s.personaId);
  const topics = useNewPostStore((s) => s.topics);
  const faceless = useNewPostStore((s) => s.faceless);
  const personasQuery = usePersonaListQuery();
  const persona = (personasQuery.data ?? []).find((item) => item.id === personaId);
  const videoCount = topics.filter((topic) => topic.trim().length > 0).length;
  const perVideo = persona
    ? computeVideoTokens(faceless, (persona.faceQuality as FaceQuality) ?? 'ok')
    : 0;
  return (
    <section className={cn(CARD_CLASS, 'flex items-center justify-between gap-3')}>
      <span className="flex items-center gap-2 text-sm text-neutral-600">
        <CoinsIcon />
        {t('newPost.costLabel')}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-neutral-900">
          {t(pluralKey(perVideo * videoCount, 'newPost.costValueOne', 'newPost.costValue'), {
            cost: perVideo * videoCount,
          })}
        </span>
        <span className="block text-xs text-neutral-500">
          {t(pluralKey(videoCount, 'newPost.costHintOne', 'newPost.costHint'), { videos: videoCount })}
        </span>
      </span>
    </section>
  );
};

//---------------
// Submit button — disabled while submitting so a double click cannot queue a
// second schedule (every request charges tokens).
//---------------
const NewPostSubmitRow = () => {
  const { t } = useI18n();
  const pending = useNewPostStore((s) => s.pending);
  return (
    <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
      {pending ? (
        <>
          <SpinnerIcon />
          {t('newPost.submitting')}
        </>
      ) : (
        <>
          <ComposeIcon />
          {t('newPost.submit')}
        </>
      )}
    </button>
  );
};

//---------------
// Empty state — a post needs a persona, so the next step is creating one.
//---------------
const NewPostNoPersonas = () => {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <NewPostHeader />
      <section className="rounded-2xl border border-dashed border-neutral-300 bg-linear-to-b from-white to-neutral-50 px-6 py-14 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <FilmIcon />
        </span>
        <h2 className="mt-5 text-base font-semibold text-neutral-900">{t('newPost.noPersonasTitle')}</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-5 text-neutral-600">
          {t('newPost.noPersonasHint')}
        </p>
        <div className="mt-7">
          <Link
            href="/persona"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md [&_svg]:size-4"
          >
            <PlusIcon />
            {t('newPost.createPersona')}
          </Link>
        </div>
      </section>
    </div>
  );
};

//---------------
// Persona list failure: nothing on this screen works without it, so it is a
// blocking state that points back to the posts, not an empty form.
//---------------
const NewPostLoadError = () => {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <NewPostHeader />
      <section role="alert" className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-base font-semibold text-neutral-900">{t('posts.loadError')}</h2>
        <Link href="/posts" className={cn(SECONDARY_BUTTON_CLASS, 'mt-5')}>
          {t('posts.refresh')}
        </Link>
      </section>
    </div>
  );
};

/* -----------------
   Local Helpers
------------------ */

//---------------
// pluralKey — English/Portuguese need their own count form, and "(s)" in a
// localized sentence is exactly the kind of thing that ships. Follows the
// app's existing convention (accountConnected / accountsConnected).
//---------------
function pluralKey(count: number, one: TranslationKey, many: TranslationKey): TranslationKey {
  return count === 1 ? one : many;
}

//---------------
// SectionTitle — section label in the same persona/personas pattern: icon
// + uppercase label + short hint.
//---------------
const SectionTitle = ({ icon, label, hint }: { icon: React.ReactNode; label: string; hint?: string }) => (
  <div className="flex items-start gap-2.5">
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 [&_svg]:size-4">
      {icon}
    </span>
    <div>
      <p className={SECTION_LABEL_CLASS}>{label}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-neutral-500">{hint}</p> : null}
    </div>
  </div>
);

//---------------
// Skeleton — UI placeholders only: no hooks, no store, no queries.
//---------------
const NewPostPageSkeleton = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-3">
      <span className="size-10 rounded-xl bg-neutral-100" />
      <div className="space-y-2">
        <div className="h-5 w-32 rounded bg-neutral-100" />
        <div className="h-3.5 w-56 rounded bg-neutral-100" />
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-6">
        <div className={CARD_CLASS}>
          <div className="h-4 w-24 rounded bg-neutral-100" />
          <div className="mt-4 h-11 rounded-lg bg-neutral-100" />
        </div>
        <div className={CARD_CLASS}>
          <div className="h-4 w-24 rounded bg-neutral-100" />
          <div className="mt-4 space-y-2">
            <div className="h-11 rounded-lg bg-neutral-100" />
            <div className="h-11 rounded-lg bg-neutral-100" />
          </div>
          <div className="mt-4 h-11 w-32 rounded-xl bg-neutral-100" />
        </div>
        <div className={CARD_CLASS}>
          <div className="h-4 w-32 rounded bg-neutral-100" />
          <div className="mt-4 h-11 rounded-lg bg-neutral-100" />
          <div className="mt-4 h-11 rounded-lg bg-neutral-100" />
        </div>
      </div>
      <div className="space-y-6">
        <div className={CARD_CLASS}>
          <div className="h-4 w-28 rounded bg-neutral-100" />
          <div className="mt-4 h-32 rounded-xl bg-neutral-100" />
        </div>
        <div className={cn(CARD_CLASS, 'h-16')} />
        <div className="h-12 rounded-xl bg-neutral-100" />
      </div>
    </div>
  </div>
);
