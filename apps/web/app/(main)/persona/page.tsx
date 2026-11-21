'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Autoplay from 'embla-carousel-autoplay';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { useVoicesQuery, usePersonaListQuery } from '@/lib/api';
import { emptyPersonaDefaultAccounts } from '@/lib/persona-publishing-accounts';
import { usePersonaStore } from '@/lib/store';
import { personaFormSchema, parsePersonaCtaType } from '@/lib/persona-schema';
import { useI18n } from '@/lib/i18n/provider';
import { PersonaTokensSection } from './persona-tokens';
import { PersonaImageLibrarySection, mapPersonaImageWarnings } from './persona-image-library';
import { PersonaPreferencesSection } from './persona-preferences-section';
import { PersonaCtaSection } from './persona-cta-section';
import { PersonaPublishingAccountsSection } from './persona-publishing-accounts-section';
import { PersonaPageSkeleton } from './persona-page-skeleton';
import { PersonaErrorDialog } from './persona-error-dialog';
import { PersonaFormSync } from './persona-form-sync';
import { PersonaPhotoPicker } from './persona-photo-picker';
import { isPersonaVoiceHydrated, PersonaVoiceSection } from './persona-voice-section';
import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { PersonaSubmit, resolveEditingPersonaId } from './persona-submit';
import { DEFAULT_PERSONA_FACE_IDS } from '@/lib/persona-faces';
import {
  AlertIcon,
  CheckIcon,
  SparklesIcon,
  ImageIcon,
  SpinnerIcon,
  UploadIcon,
  INPUT_CLASS,
} from '@/lib/ui';

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
  const voicesQuery = useVoicesQuery();

  const methods = useForm({
    mode: 'onBlur',
    resolver: zodResolver(personaFormSchema),
    defaultValues: {
      name: usePersonaStore.getState().name,
      niche: usePersonaStore.getState().niche,
      scriptPrompt: usePersonaStore.getState().scriptPrompt,
    },
  });

  useEffect(() => {
    const persona = editingPersona;
    if (!persona) return;
    const store = usePersonaStore.getState();
    store.setName(persona.name);
    store.setAvatarUrl(persona.avatarUrl ?? null);
    store.setStoredPhotoUrl(persona.photoUrl ?? null);
    store.setVoiceId(persona.voiceId ?? null);
    store.setLanguage(persona.language ?? null);
    store.setVideoAspect(persona.videoAspect ?? '9:16');
    store.setVideoLayout(persona.videoLayout ?? 'standard');
    store.setHookPanel(persona.hookPanel !== false);
    store.setFaceQuality(persona.faceQuality === 'very_good' ? 'very_good' : 'ok');
    store.setScriptPrompt(persona.scriptPrompt ?? '');
    store.setCta({
      type: parsePersonaCtaType(persona.ctaType),
      url: persona.ctaUrl ?? '',
      instruction: persona.ctaInstruction ?? '',
    });
    store.setNiche(persona.niche ?? '');
    store.setResult(null);
    methods.setValue('name', persona.name);
    methods.setValue('scriptPrompt', persona.scriptPrompt ?? '');
    methods.setValue('niche', persona.niche ?? '');
  }, [editingPersona, methods]);

  useEffect(() => {
    if (editingPersonaId !== null) return;
    const store = usePersonaStore.getState();
    store.setPublishingAccounts(emptyPersonaDefaultAccounts());
    store.setLoadedPublishingAccounts(emptyPersonaDefaultAccounts());
    store.setPublishingAccountsLoaded(true);
  }, [editingPersonaId]);

  const retryFailedQueries = async (): Promise<void> => {
    const failed = [voicesQuery, personasQuery].filter((query) => query.isError);
    await Promise.all(failed.map((query) => query.refetch()));
  };

  if (voicesQuery.isError || personasQuery.isError) {
    return <PersonaPageError onRetry={retryFailedQueries} isRetrying={voicesQuery.isFetching} />;
  }

  if (
    voicesQuery.isPending || voicesQuery.isLoading || voicesQuery.data === undefined
  ) {
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
            {editingPersonaId && editingPersona !== undefined ? (
              <PersonaImageLibrarySection personaId={editingPersonaId} />
            ) : null}
            <PersonaTokensSection />
          </section>
          <section className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
            <PersonaVoiceSection
              voiceHydrated={isPersonaVoiceHydrated(editingPersonaId, editingPersona)}
              isEditing={Boolean(editingPersonaId)}
              hasVoiceAudio={Boolean(editingPersona?.voiceAudioUrl)}
            />
          </section>
          <section className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
            <PersonaPreferencesSection />
          </section>
          <section className="rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
            <PersonaCtaSection />
          </section>
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const personasQuery = usePersonaListQuery();
  const editingPersonaId = resolveEditingPersonaId(pathname, searchParams.get('edit'));
  const editingAvatarUrl = editingPersonaId
    ? personasQuery.data?.find((persona) => persona.id === editingPersonaId)?.avatarUrl
    : undefined;
  const [source, setSource] = useState<'characters' | 'upload'>(editingAvatarUrl ? 'characters' : 'upload');
  useEffect(() => {
    if (editingAvatarUrl) setSource('characters');
  }, [editingAvatarUrl]);
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  return (
    <section data-error-field="avatar">
      <SectionDivider label={t('persona.photoLabel')} />
      <div className="mt-4 inline-flex gap-1 rounded-lg border border-line bg-sunken p-1">
        <SourceTab
          active={source === 'characters'}
          label={t('persona.characterTab')}
          icon={<ImageIcon />}
          onSelect={() => setSource('characters')}
        />
        <SourceTab
          active={source === 'upload'}
          label={t('persona.uploadTab')}
          icon={<UploadIcon />}
          onSelect={() => setSource('upload')}
        />
      </div>
      <div hidden={source !== 'characters'}>
        <PersonaCharacterPicker />
      </div>
      <div hidden={source !== 'upload'}>
        <PersonaPhotoPicker personaId={editingPersonaId ?? undefined} />
      </div>
      {result && !result.success && result.error === t('persona.errAvatar') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};

const SourceTab = ({
  active,
  label,
  icon,
  onSelect,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onSelect}
    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-card text-ink shadow-sm' : 'text-muted-text hover:text-ink'
    }`}
  >
    {icon}
    {label}
  </button>
);

const PersonaCharacterPicker = () => {
  const avatarUrl = usePersonaStore((s) => s.avatarUrl);
  const searchParams = useSearchParams();
  const personasQuery = usePersonaListQuery();
  const editId = searchParams.get('edit');
  const editingAvatarUrl = editId
    ? personasQuery.data?.find((persona) => persona.id === editId)?.avatarUrl
    : undefined;
  const selectedAvatarUrl = avatarUrl ?? editingAvatarUrl ?? null;
  const startIndexRef = useRef(getCharacterIndex(avatarUrl ?? editingAvatarUrl ?? null));
  const autoplay = useRef(Autoplay({ delay: editId ? 1_000_000 : 5000, stopOnInteraction: true }));
  const { t } = useI18n();

  const handleCharacterSelect = (imageUrl: string): void => {
    autoplay.current.stop();
    usePersonaStore.getState().setAvatarUrl(imageUrl);
  };

  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-ink-soft">{t('persona.characterLabel')}</p>
      <p className="mt-3 text-sm leading-5 text-muted-text">{t('persona.characterHint')}</p>
      <Carousel
        aria-label={t('persona.characterLabel')}
        className="mt-3 px-10"
        opts={{ align: 'start', loop: true, startIndex: startIndexRef.current }}
        plugins={selectedAvatarUrl ? [] : [autoplay.current]}
      >
        <CarouselContent>
          {DEFAULT_PERSONA_FACE_IDS.map((character, index) => {
            const imageUrl = `/caracter-samples/${character}.png`;
            const isSelected = selectedAvatarUrl === imageUrl;
            return (
              <CarouselItem key={character} className="basis-1/2 sm:basis-1/3 lg:basis-1/4 xl:basis-1/5">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${t('persona.characterLabel')} ${index + 1}`}
                  onClick={() => handleCharacterSelect(imageUrl)}
                  className={`relative block w-full overflow-hidden rounded-xl border-2 bg-background transition-[border-color,box-shadow] ${
                    isSelected
                      ? 'border-accent shadow-lg ring-4 ring-accent/30'
                      : 'border-border hover:border-foreground/40'
                  }`}
                >
                  <Image
                    src={imageUrl}
                    alt=""
                    width={270}
                    height={480}
                    unoptimized
                    className="aspect-9/16 w-full object-cover"
                  />
                  {isSelected ? (
                    <span className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-accent text-on-ink shadow-md ring-2 ring-card">
                      <CheckIcon />
                    </span>
                  ) : null}
                </button>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <CarouselPrevious className="left-0" />
        <CarouselNext className="right-0" />
      </Carousel>
    </div>
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
  const { reset } = useFormContext<{
    name: string;
    niche: string;
    scriptPrompt: string;
  }>();

  if (!result) return null;

  const handleCreateAnother = () => {
    reset({ name: '', niche: '', scriptPrompt: '' });
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
              {result.warnings && result.warnings.length > 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-warning">
                  {mapPersonaImageWarnings(result.warnings, t)}
                </p>
              ) : null}
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
    result.error === t('persona.errAvatar') ||
    result.error === t('persona.errVoice') ||
    result.error === t('publishing.mustSelectAccount')
  ) {
    return null;
  }

  return <PersonaErrorDialog />;
};

const getCharacterIndex = (avatarUrl: string | null): number => {
  const match = avatarUrl?.match(/\/file-(\d+)\.png$/);
  const index = match ? Number(match[1]) - 1 : 0;
  return index >= 0 && index < DEFAULT_PERSONA_FACE_IDS.length ? index : 0;
};
