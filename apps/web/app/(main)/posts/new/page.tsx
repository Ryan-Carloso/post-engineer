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
// NewPostPage — cria um post: escolhe a persona, de 1 a 10 temas, as contas
// onde publicar e os horários, e envia UMA requisição de generate-and-schedule
// (o vídeo e o slot de publicação nascem juntos).
//
// O rascunho vive no zustand store (lib/store.ts) e os dados de leitura vêm
// do React Query, então cada componente local abaixo lê direto da fonte em
// vez de receber props.
//---------------

// Lista curta de fusos; o fuso do navegador entra primeiro, então o caso
// comum não exige rolagem. O servidor valida o fuso (isValidTimezone) e
// rejeita qualquer zona desconhecida.
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

// Cartão de formulário: a mesma casca das telas de persona/personas.
const CARD_CLASS = 'rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6';
const PRIMARY_BUTTON_CLASS =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4';
const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4';
const ICON_BUTTON_CLASS =
  'flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 [&_svg]:size-4';

//---------------
// ERROR_KEY_BY_CODE — código de falha do servidor (lib/error-codes.ts) para
// texto traduzido. Códigos desconhecidos caem na mensagem genérica: o texto
// cru do servidor é em inglês e nunca pode aparecer numa tela localizada.
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
  // O resultado vive no store (para os componentes locais renderizarem sem
  // props), então ele sobrevive à navegação: descarta o resultado da visita
  // anterior ao montar, senão voltar para cá reaplicaria o redirect e o
  // banner de sucesso. O rascunho digitado é preservado.
  //---------------
  useEffect(() => {
    useNewPostStore.getState().setResult(null);
    useNewPostStore.getState().setValidationKey(null);
  }, []);

  //---------------
  // No sucesso o agendamento existe: volta para a lista de posts, que já foi
  // refetchada (a mutation invalidou os caches) e mostra os novos slots. Uma
  // falha parcial mantém o usuário aqui para o erro ficar visível.
  //
  // Lemos o valor vivo do store, não o `result` deste render: o efeito de
  // montagem acima limpa um resultado antigo no mesmo commit, e o valor do
  // render ainda seria o sucesso da visita anterior.
  //---------------
  useEffect(() => {
    const current = useNewPostStore.getState().result;
    if (current !== null && current.success) router.push('/posts');
    // `result` é o gatilho: a escrita no store re-renderiza esta tela.
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
// handleSubmit — monta a requisição a partir do rascunho no store, chama a
// única operação generate-and-schedule e guarda o resultado para o banner.
// As guardas locais rejeitam com chave traduzida e não enviam nada: a API
// cobra tokens, então um pedido que não pode dar certo não deve sair do
// navegador.
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
  // startInstant é não-nulo após a guarda acima; o ramo null mantém os tipos
  // honestos sem asserção.
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
    // Projeta a resposta no que o banner lê: o texto de erro cru da API
    // nunca entra no store (a UI traduz pelo código).
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
// Cabeçalho: voltar para os posts + identidade da tela.
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
// Banner de retorno: rejeição local, código de falha do servidor ou o estado
// de sucesso (a tela redireciona logo em seguida).
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
// Persona — obrigatória: é ela que renderiza o rosto e traz a voz, então um
// post não existe sem uma.
//
// shadcn RadioGroup + Label em vez de <select>: a persona é o objeto mais
// importante do formulário e precisa da foto (o mesmo avatar do card em
// /personas) — um select nativo não mostra imagem.
//
// O RadioGroupItem do shadcn é um leaf (ele desenha o pontinho e descarta
// children), então ele fica como o controle real, `sr-only` + `id`, e o card
// é um Label apontando para ele: clique no card seleciona, o item continua
// sendo o alvo de teclado e leitor de tela.
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
                // Foco no mesmo azul-marinho da seleção (o token `ring` é
                // outro azul e brigaria com o anel de selecionado).
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
// Rosto do vídeo — a persona sempre tem rosto; "sem rosto" é escolhido aqui,
// por post (100% stock footage, sem lipsync e sem imagem da biblioteca). A
// persona continua obrigatória porque é dela que vem a voz, o nicho e o
// roteiro. Mesmo padrão de cards do seletor de persona acima: RadioGroup do
// shadcn como item sr-only + Label como card clicável.
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
// Temas — um vídeo por linha. "Adicionar tema" para no limite compartilhado
// (MAX_POST_TOPICS), o mesmo número que a API aplica.
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
// Contas — as Same cards da tela de contas (AccountCard: miniatura real da
// conta + checkbox de seleção), agrupadas por rede com o glifo da rede. A
// seleção é estado global do app (useUploadStore), a mesma que /accounts
// escreve: quem marcou um canal lá encontra ele marcado aqui.
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
                // Uma coluna: o card da conta já tem avatar + nome + checkbox,
                // e a coluna do formulário é estreita — duas colunas cortam
                // o nome no meio.
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
// Plano de publicação — primeira publicação (hora wall clock + fuso) e os
// horários diários.
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
// Prévia da agenda — calculada pelo MESMO distributeSlots que a API chama,
// então o que o usuário vê é o que será criado, com aviso quando algum slot
// cai fora da janela de 3h–30d.
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
// Custo estimado — o mesmo preço por vídeo que a rota cobra
// (computeVideoTokens), vezes o número de temas. Sem rosto custa o preço
// faceless; com o rosto, o preço da qualidade escolhida na persona. É uma
// estimativa; o servidor é a autoridade de cobrança.
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
// Botão de envio — desabilitado durante o envio para que um clique duplo não
// enfileire um segundo agendamento (cada requisição cobra tokens).
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
// Estado vazio — um post precisa de uma persona, então o próximo passo é
// criar uma.
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
// Falha na lista de personas: nada nesta tela funciona sem ela, então é um
// estado bloqueante que aponta de volta para os posts, não um formulário
// vazio.
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
// SectionTitle — rótulo de seção no mesmo padrão de persona/personas: ícone
// + label em caixa alta + dica curta.
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
// Skeleton — apenas placeholders de UI: sem hooks, sem store, sem queries.
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
