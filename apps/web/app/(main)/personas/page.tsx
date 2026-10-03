'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePersonaListQuery,
  type PersonaRecord,
} from '@/lib/api';
import { DeletePersonaModal } from './delete-persona-modal';
import PersonaAvatar from '@/components/persona-avatar';
import { useI18n } from '@/lib/i18n/provider';
import {
  SparklesIcon,
  MicIcon,
  PlusIcon,
  GlobeIcon,
  TrashIcon,
} from '@/lib/ui';

export default function PersonasPage() {
  const personasQuery = usePersonaListQuery();

  if (personasQuery.isError) {
    return <PersonasPageError />;
  }

  if (personasQuery.isPending || personasQuery.isLoading || personasQuery.data === undefined) {
    return <PersonasPageSkeleton />;
  }

  const personas = personasQuery.data ?? [];

  return (
    <div className="space-y-8">
      <PersonasHeader />
      {personas.length === 0 ? <PersonasEmptyState /> : <PersonasList personas={personas} />}
    </div>
  );
}

/* -----------------
   Local Components
------------------ */

//---------------
// PersonasHeader — título e subtítulo da tela de personas
//---------------
const PersonasHeader = () => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
        <SparklesIcon />
      </span>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{t('personas.title')}</h1>
        <p className="text-sm text-neutral-500">{t('personas.subtitle')}</p>
      </div>
    </div>
  );
};

//---------------
// PersonasEmptyState — convite para criar a primeira persona
//---------------
const PersonasEmptyState = () => {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-linear-to-b from-white to-neutral-50 px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <SparklesIcon />
      </span>
      <h2 className="mt-5 text-base font-semibold text-neutral-900">{t('personas.emptyTitle')}</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-5 text-neutral-600">
        {t('personas.emptyHint')}
      </p>
      <div className="mt-7">
        <Link
          href="/persona"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:shadow-md [&_svg]:size-4"
        >
          <PlusIcon />
          {t('personas.createFirst')}
        </Link>
      </div>
    </div>
  );
};

//---------------
// PersonasPageError — informa a falha da lista e oferece nova tentativa
//---------------
const PersonasPageError = () => {
  const { t } = useI18n();
  const personasQuery = usePersonaListQuery();

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-6 text-center sm:p-8">
      <h1 className="text-xl font-semibold text-neutral-900">{t('personas.loadError')}</h1>
      <p className="mt-2 text-sm text-neutral-500">{t('personas.loadErrorHint')}</p>
      <button
        type="button"
        disabled={personasQuery.isFetching}
        onClick={() => void personasQuery.refetch()}
        className="mt-5 inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {t('personas.tryAgain')}
      </button>
    </section>
  );
};

//---------------
// PersonasList — grade das personas do usuário com botão para criar novas
//---------------
const PersonasList = ({ personas }: { personas: PersonaRecord[] }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [deletingPersona, setDeletingPersona] = useState<PersonaRecord | null>(null);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {personas.map((persona) => (
          <PersonaCard key={persona.id} persona={persona} onDeleteRequest={setDeletingPersona} />
        ))}
        <Link
          href="/persona"
          className="group flex min-h-30 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-white/60 px-4 py-6 text-sm font-medium text-neutral-500 transition-all hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 transition-colors group-hover:bg-accent/10 group-hover:text-accent [&_svg]:size-5">
            <PlusIcon />
          </span>
          {t('personas.createNew')}
        </Link>
      </div>
      <DeletePersonaModal
        persona={deletingPersona}
        onClose={() => setDeletingPersona(null)}
        onDeleted={() => {
          void queryClient.refetchQueries({ queryKey: ['persona-list'] });
        }}
      />
    </section>
  );
};

//---------------
// PersonaCard — cartão da persona: inteiro clicável, leva aos detalhes.
// Botão de deletar no canto abre o modal de confirmação (com preview do
// que será apagado), sem navegar para a edição.
//---------------
const PersonaCard = ({
  persona,
  onDeleteRequest,
}: {
  persona: PersonaRecord;
  onDeleteRequest: (persona: PersonaRecord) => void;
}) => {
  const { t } = useI18n();

  return (
    <div className="group relative flex min-h-30 items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
      <Link
        href={`/persona?edit=${encodeURIComponent(persona.id)}`}
        aria-label={t('personas.details')}
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        {/* Avatar compartilhado com o seletor de /posts/new (mesmo
            fallback, mesmo anel) — duas cópias do bloco divergem. */}
        <PersonaAvatar
          avatarUrl={persona.avatarUrl}
          photoUrl={persona.photoUrl}
          name={persona.name}
          size={56}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-900">{persona.name}</div>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 [&_svg]:size-3.5">
            <MicIcon />
            {persona.voiceAudioUrl ? t('personas.voiceOwn') : t('personas.voiceHouse')}
          </span>
          {(persona.language || persona.videoAspect) && (
            <div className="mt-1.5 flex items-center gap-1.5">
              {persona.language && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 [&_svg]:size-3">
                  <GlobeIcon />
                  {persona.language}
                </span>
              )}
              {persona.videoAspect && (
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                  {persona.videoAspect}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      <button
        type="button"
        aria-label={t('personas.delete')}
        title={t('personas.delete')}
        onClick={() => onDeleteRequest(persona)}
        className="absolute top-2.5 right-2.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-300 transition-colors group-hover:text-neutral-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50 [&_svg]:size-4"
      >
        <TrashIcon />
      </button>
    </div>
  );
};

//---------------
// PersonasPageSkeleton — placeholder de carregamento da tela
//---------------
const PersonasPageSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="space-y-8">
    <div className="flex items-center gap-3">
      <div className="skeleton-shimmer size-10 shrink-0 rounded-xl" />
      <div className="space-y-2">
        <div className="skeleton-shimmer h-5 w-40 rounded" />
        <div className="skeleton-shimmer h-3.5 w-64 rounded" />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex min-h-30 items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="skeleton-shimmer size-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="skeleton-shimmer h-4 w-32 rounded" />
            <div className="skeleton-shimmer h-6 w-24 rounded-full" />
            <div className="skeleton-shimmer h-5 w-36 rounded-full" />
          </div>
        </div>
      ))}
      <div className="flex min-h-30 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-white/60">
        <div className="skeleton-shimmer size-10 rounded-full" />
        <div className="skeleton-shimmer h-4 w-32 rounded" />
      </div>
    </div>
  </div>
);
