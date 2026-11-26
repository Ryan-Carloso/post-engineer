'use client';

import React, { Suspense, useEffect, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { usePersonaListQuery } from '@/lib/api';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { usePersonaStore } from '@/lib/store';
import { personaFormSchema } from '@/lib/persona-schema';
import { useI18n } from '@/lib/i18n/provider';
import { PersonaIdentityCardSection } from './persona-identity-card-section';
import { PersonaPublishingAccountsSection } from './persona-publishing-accounts-section';
import { PersonaPageSkeleton } from './persona-page-skeleton';
import { PersonaErrorDialog } from './persona-error-dialog';
import { PersonaFormSync } from './persona-form-sync';
import { PersonaPhotoPicker } from './persona-photo-picker';
import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { PersonaSubmit, resolveEditingPersonaId } from './persona-submit';
import { AlertIcon, CheckIcon, SparklesIcon, SpinnerIcon, INPUT_CLASS } from '@/lib/ui';

export default function PersonaPage() {
  return (
    <Suspense fallback={<PersonaPageSkeleton />}>
      <PersonaPageContent />
    </Suspense>
  );
}

const PersonaPageContent = () => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const editId = searchParams.get('edit');
  const editingPersonaId = resolveEditingPersonaId(pathname, editId);
  const personasQuery = usePersonaListQuery();
  const editingPersona = useMemo(
    () => (editingPersonaId ? personasQuery.data?.find((item) => item.id === editingPersonaId) : undefined),
    [editingPersonaId, personasQuery.data],
  );

  const methods = useForm({
    mode: 'onBlur',
    resolver: zodResolver(personaFormSchema),
    defaultValues: {
      name: usePersonaStore.getState().name,
    },
  });

  useEffect(() => {
    const persona = editingPersona;
    if (!persona) return;
    const store = usePersonaStore.getState();
    store.setName(persona.name);
    store.setPhoto(null);
    store.setStoredPhotoUrl(persona.photoUrl ?? persona.avatarUrl ?? null);
    store.setResult(null);
    methods.setValue('name', persona.name);
  }, [editingPersona, methods]);

  useEffect(() => {
    if (editingPersonaId !== null) return;
    const store = usePersonaStore.getState();
    store.setPublishingAccounts(emptyPersonaDefaultAccounts());
    store.setLoadedPublishingAccounts(emptyPersonaDefaultAccounts());
    store.setPublishingAccountsLoaded(true);
  }, [editingPersonaId]);

  const retryFailedQueries = async (): Promise<void> => {
    if (personasQuery.isError) await personasQuery.refetch();
  };

  if (personasQuery.isError) {
    return <PersonaPageError onRetry={retryFailedQueries} isRetrying={personasQuery.isFetching} />;
  }

  if (editingPersonaId !== null && personasQuery.isPending) {
    return <PersonaPageSkeleton />;
  }

  return (
    <FormProvider {...methods}>
      <PersonaFormSync />
      <div className="space-y-8">
        <PersonaHeader editing={Boolean(editId)} />
        <div className="space-y-5">
          <section className="space-y-6 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
            <PersonaNameField />
            <PersonaAvatarSection />
          </section>
          <PersonaIdentityCardSection personaId={editingPersonaId} />
          <PersonaPublishingAccountsSection personaId={editingPersonaId ?? undefined} />
          <PersonaSubmit editId={editId} />
          <PersonaFeedback />
        </div>
      </div>
    </FormProvider>
  );
}

type PersonaPageErrorProps = { onRetry: () => Promise<void>; isRetrying: boolean };

const PersonaPageError = ({ onRetry, isRetrying }: PersonaPageErrorProps) => {
  const { t } = useI18n();

  return (
    <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center py-8">
      <section
        aria-live="polite"
        className="w-full max-w-xl rounded-2xl border border-destructive/30 bg-card px-6 py-10 text-center shadow-[0_12px_36px_rgba(13,43,69,0.08)] sm:px-10"
      >
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive-soft text-destructive">
          <AlertIcon />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
          {t('persona.loadError')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-text">
          {t('persona.loadErrorHint')}
        </p>
        <button
          type="button"
          disabled={isRetrying}
          onClick={() => void onRetry()}
          className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRetrying && <SpinnerIcon />}
          {t('persona.tryAgain')}
        </button>
      </section>
    </main>
  );
};

const PersonaHeader = ({ editing }: { editing: boolean }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-ink">
        <SparklesIcon />
      </span>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
          {t(editing ? 'personas.editTitle' : 'persona.title')}
        </h1>
        <p className="text-sm text-muted-text">{t(editing ? 'personas.editSubtitle' : 'persona.subtitle')}</p>
      </div>
    </div>
  );
};

const PersonaAvatarSection = () => {
  const { t } = useI18n();

  return (
    <section data-error-field="avatar">
      <SectionDivider label={t('persona.photoLabel')} />
      <PersonaPhotoPicker />
    </section>
  );
};

const PersonaNameField = () => {
  const { register, formState: { errors } } = useFormContext();
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  return (
    <div>
      <label htmlFor="persona-name" className="text-md block font-medium text-ink">
        {t('persona.name')}
      </label>
      <input
        id="persona-name"
        data-error-field="name"
        type="text"
        placeholder={t('persona.namePlaceholder')}
        className={INPUT_CLASS}
        {...register('name')}
      />
      {errors.name ? (
        <p role="alert" className="mt-1 text-sm text-destructive">{t('persona.errName')}</p>
      ) : null}
      {result && !result.success && result.error === t('persona.errName') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </div>
  );
};

const PersonaFeedback = () => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();
  const { reset } = useFormContext<{ name: string }>();

  if (!result) return null;

  const handleCreateAnother = () => {
    reset({ name: '' });
    usePersonaStore.getState().resetForm();
  };

  if (result.success) {
    return (
      <section>
        <SectionDivider label={t('persona.result')} />
        <div className="mt-4 rounded-xl border border-success/30 bg-success-soft p-5">
          <div className="flex items-start gap-3.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
              <CheckIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-success">{t('persona.created')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-success">{t('persona.createdHint')}</p>
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleCreateAnother}
                  className="text-xs font-medium text-success/80 hover:text-success"
                >
                  {t('persona.createAnother')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (
    result.error === t('persona.errName') ||
    result.error === t('publishing.mustSelectAccount')
  ) {
    return null;
  }

  return <PersonaErrorDialog />;
};
