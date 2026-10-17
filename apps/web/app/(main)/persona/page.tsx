'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Autoplay from 'embla-carousel-autoplay';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { useVoicesQuery, useVoiceSampleLanguagesQuery, createPersona, useUpdatePersonaMutation, usePersonaListQuery } from '@/lib/api';
import { resolveScriptLanguage, usePersonaStore } from '@/lib/store';
import { personaFormSchema } from '@/lib/persona-schema';
import { useI18n } from '@/lib/i18n/provider';
import { PersonaTokensSection } from './persona-tokens';
import { PersonaImageLibrarySection, mapPersonaImageWarnings } from './persona-image-library';
import { PersonaPreferencesSection } from './persona-preferences-section';
import { PersonaPublishingAccountsSection } from './persona-publishing-accounts-section';
import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { scrollToErrorField } from '@/lib/scroll-to-error';
import { DEFAULT_PERSONA_FACE_IDS } from '@/lib/persona-faces';
import {
  AlertIcon,
  CheckIcon,
  SparklesIcon,
  ImageIcon,
  MicIcon,
  SpinnerIcon,
  UploadIcon,
  formatFileSize,
  INPUT_CLASS,
} from '@/lib/ui';

// Voice ids come from the engine's Chatterbox catalog and are
// provider-qualified (`chatterbox:ryan`). There is no house-voice map any
// more, and no label fallback: a voice with no label must show its raw id, not
// borrow another voice's name — that fallback used to render every unknown id
// as "Voz feminina calma".
const voiceLabel = (voiceId: string): string => voiceId.replace(/^chatterbox:/, '').replace(/_/g, ' ');

export default function PersonaPage() {
  return (
    <Suspense fallback={<PersonaPageSkeleton />}>
      <PersonaPageContent />
    </Suspense>
  );
}

//---------------
// resolveEditingPersonaId — the persona id being edited comes from ?edit=
// (current route) or the legacy /personas/<id>/edit path. Shared by
// PersonaPageContent and PersonaSubmit so the two cannot drift if the
// legacy route format ever changes.
//---------------
function resolveEditingPersonaId(pathname: string, editId: string | null): string | null {
  const editMatch = pathname.match(/^\/personas\/([^/]+)\/edit$/);
  return editMatch?.[1] ?? editId;
}

const PersonaPageContent = () => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const editId = searchParams.get('edit');
  // Same edit-id resolution as PersonaSubmit: ?edit= or the legacy
  // /personas/<id>/edit path. The image library needs a persisted persona.
  const editingPersonaId = resolveEditingPersonaId(pathname, editId);
  const personasQuery = usePersonaListQuery();
  // Derived from the resolved id (not the raw ?edit= param): on the legacy
  // /personas/<id>/edit path the image library renders but the old derivation
  // left editingPersona undefined, so personaLanguage silently fell back to
  // the default instead of the persona's saved language.
  const editingPersona = useMemo(
    () => (editingPersonaId ? personasQuery.data?.find((item) => item.id === editingPersonaId) : undefined),
    [editingPersonaId, personasQuery.data],
  );
  const voicesQuery = useVoicesQuery();
  const sampleLanguagesQuery = useVoiceSampleLanguagesQuery();

  // RHF: text fields validate onBlur with the SAME server zod schema
  // (lib/persona-schema.ts) and block submit. Zustand remains
  // the persistence layer (buildPersonaFormData reads from the store).
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
    // avatarUrl is a CHOSEN character (public/caracter-samples or an AI
    // avatar). photoUrl is the 1h signed link to an uploaded photo — putting
    // it here made every save send it back as avatarUrl, which either stored
    // an expiring URL or (with the visual-identity check) 500'd. A photo
    // persona simply has no character selected.
    store.setAvatarUrl(persona.avatarUrl ?? null);
    store.setStoredPhotoUrl(persona.photoUrl ?? null);
    store.setVoiceId(persona.voiceId ?? null);
    store.setVideoAspect(persona.videoAspect ?? '9:16');
    // The column is nullable (migration 018), so a persona created before the
    // layout existed has none — fall back to what every older video rendered.
    store.setVideoLayout(persona.videoLayout ?? 'standard');
    store.setScriptPrompt(persona.scriptPrompt ?? '');
    store.setNiche(persona.niche ?? '');
    store.setResult(null);
    methods.setValue('name', persona.name);
    methods.setValue('scriptPrompt', persona.scriptPrompt ?? '');
    methods.setValue('niche', persona.niche ?? '');
  }, [editingPersona, methods]);

  // The error page must NOT subscribe to these queries: mounting it adds a
  // second observer, refetchOnMount refetches the errored query, and the
  // error page unmounts again — an infinite loop. Retry lives here instead.
  const retryFailedQueries = async (): Promise<void> => {
    const failed = [voicesQuery, sampleLanguagesQuery, personasQuery].filter((query) => query.isError);
    await Promise.all(failed.map((query) => query.refetch()));
  };

  if (voicesQuery.isError || sampleLanguagesQuery.isError || personasQuery.isError) {
    return <PersonaPageError onRetry={retryFailedQueries} isRetrying={voicesQuery.isFetching} />;
  }

  if (
    voicesQuery.isPending || voicesQuery.isLoading || voicesQuery.data === undefined ||
    sampleLanguagesQuery.isPending || sampleLanguagesQuery.isLoading || sampleLanguagesQuery.data === undefined
  ) {
    return <PersonaPageSkeleton />;
  }

  return (
    <FormProvider {...methods}>
      <PersonaFormSync />
      <div className="space-y-8">
        <PersonaHeader editing={Boolean(editId)} />
        <div className="space-y-5">
          <section className="space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <PersonaNameField />
            <PersonaAvatarSection />
            {/* Image library needs a PERSISTED persona, and the loaded data:
                while the list is fetching (or errored) editingPersona is
                undefined and the section stays hidden instead of flashing
                for a persona that does not exist yet. Every persona is faced
                (migration 007), so there is no faceless gate here anymore —
                a legacy persona without a photo is exactly the case this
                library exists to fix. */}
            {editingPersonaId && editingPersona !== undefined ? (
              <PersonaImageLibrarySection personaId={editingPersonaId} />
            ) : null}
            {/* Face quality + estimated cost per video. The face itself is
                always there; only the resolution is chosen here. */}
            <PersonaTokensSection />
          </section>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <PersonaVoiceSection personaLanguage={editingPersona?.language} />
          </section>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <PersonaPreferencesSection />
          </section>
          {/* Default publishing accounts need a PERSISTED persona (the API
              route is keyed by personaId), so the section only renders while
              editing an existing persona. */}
          {editingPersonaId ? (
            <PersonaPublishingAccountsSection personaId={editingPersonaId} />
          ) : null}
          <PersonaSubmit editId={editId} />
          <PersonaFeedback />
        </div>
      </div>
    </FormProvider>
  );
}

//---------------
// PersonaFormSync — mirrors RHF fields into the zustand store
// (only when the field is dirty, so the store is not overwritten
// on mount or in the edit flow).
//---------------
const PersonaFormSync = () => {
  const { formState: { dirtyFields } } = useFormContext();
  const name = useWatch({ name: 'name' });
  const niche = useWatch({ name: 'niche' });
  const scriptPrompt = useWatch({ name: 'scriptPrompt' });

  useEffect(() => {
    if (dirtyFields.name && typeof name === 'string') {
      usePersonaStore.getState().setName(name);
    }
  }, [name, dirtyFields.name]);

  useEffect(() => {
    if (dirtyFields.niche && typeof niche === 'string') {
      usePersonaStore.getState().setNiche(niche);
    }
  }, [niche, dirtyFields.niche]);

  useEffect(() => {
    if (dirtyFields.scriptPrompt && typeof scriptPrompt === 'string') {
      usePersonaStore.getState().setScriptPrompt(scriptPrompt);
    }
  }, [scriptPrompt, dirtyFields.scriptPrompt]);

  return null;
}

/* -----------------
   Local Components
------------------ */

//---------------
// PersonaPageError explains the unavailable dependency and offers recovery.
//---------------
type PersonaPageErrorProps = { onRetry: () => Promise<void>; isRetrying: boolean };

const PersonaPageError = ({ onRetry, isRetrying }: PersonaPageErrorProps) => {
  const { t } = useI18n();

  return (
    <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center py-8">
      <section
        aria-live="polite"
        className="w-full max-w-xl rounded-2xl border border-red-200 bg-white px-6 py-10 text-center shadow-[0_12px_36px_rgba(13,43,69,0.08)] sm:px-10"
      >
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertIcon />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">
          {t('persona.loadError')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-500">
          {t('persona.loadErrorHint')}
        </p>
        <button
          type="button"
          disabled={isRetrying}
          onClick={() => void onRetry()}
          className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRetrying && <SpinnerIcon />}
          {t('persona.tryAgain')}
        </button>
      </section>
    </main>
  );
};

//---------------
// PersonaHeader — persona screen title and subtitle, with a debug mode
// badge when unlocked (10 clicks on the logo).
// In edit mode it shows the edit copy instead of the create copy.
//---------------
const PersonaHeader = ({ editing }: { editing: boolean }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
        <SparklesIcon />
      </span>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-neutral-900">
          {t(editing ? 'personas.editTitle' : 'persona.title')}
        </h1>
        <p className="text-sm text-neutral-500">{t(editing ? 'personas.editSubtitle' : 'persona.subtitle')}</p>
      </div>
    </div>
  );
};

//---------------
//---------------
// PersonaAvatarSection — visual identity choice: AI-generated or photo upload
// Every persona has a face, so this section is always rendered; "no face" is
// a per-post choice (NewPostFaceField on /posts/new).
//---------------
const PersonaAvatarSection = () => {
  const [source, setSource] = useState<'characters' | 'upload'>('characters');
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  return (
    <section data-error-field="avatar">
      <SectionDivider label={t('persona.photoLabel')} />
      <div className="mt-4 inline-flex gap-1 rounded-lg border border-neutral-300 bg-neutral-100 p-1">
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
        <PersonaPhotoPicker />
      </div>
      {result && !result.success && result.error === t('persona.errAvatar') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};

//---------------
// SourceTab — photo source tab button (AI or upload)
//---------------
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
      active ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
    }`}
  >
    {icon}
    {label}
  </button>
);

//---------------
// PersonaCharacterPicker — ready-made character selection
//---------------
const PersonaCharacterPicker = () => {
  const avatarUrl = usePersonaStore((s) => s.avatarUrl);
  const searchParams = useSearchParams();
  const personasQuery = usePersonaListQuery();
  const editId = searchParams.get('edit');
  const editingAvatarUrl = editId
    ? personasQuery.data?.find((persona) => persona.id === editId)?.avatarUrl
    : undefined;
  const selectedAvatarUrl = avatarUrl ?? editingAvatarUrl ?? null;
  // Fixed start index (mount only): changing `opts` would recreate the
  // carousel and restart autoplay, undoing the stop() on selection. The
  // carousel stays where the user left it — no position reset.
  const startIndexRef = useRef(getCharacterIndex(avatarUrl ?? editingAvatarUrl ?? null));
  const autoplay = useRef(Autoplay({ delay: editId ? 1_000_000 : 5000, stopOnInteraction: true }));
  const { t } = useI18n();

  const handleCharacterSelect = (imageUrl: string): void => {
    autoplay.current.stop();
    usePersonaStore.getState().setAvatarUrl(imageUrl);
  };

  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-neutral-700">{t('persona.characterLabel')}</p>
      <p className="mt-3 text-sm leading-5 text-neutral-600">{t('persona.characterHint')}</p>
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
                    <span className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-accent text-white shadow-md ring-2 ring-white">
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

//---------------
// PersonaPhotoPicker — upload de foto do dispositivo
//---------------
const PersonaPhotoPicker = () => {
  const photo = usePersonaStore((s) => s.photo);
  const storedPhotoUrl = usePersonaStore((s) => s.storedPhotoUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    usePersonaStore.getState().setPhoto(file);
    e.target.value = '';
  };

  // Edit mode with no new file: show the photo already stored, so the tab is
  // not an empty uploader for a persona that clearly has a face.
  if (!photo && storedPhotoUrl) {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-neutral-300 bg-white p-3">
        <Image
          src={storedPhotoUrl}
          alt={t('persona.photoLabel')}
          width={56}
          height={96}
          unoptimized
          className="aspect-9/16 h-24 w-14 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-900">{t('persona.photoCurrent')}</div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-xs font-medium text-accent hover:underline"
        >
          {t('persona.photoUpload')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handlePick}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        onChange={handlePick}
        className="hidden"
      />
      {photo ? (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-300 bg-white p-3">
          <Image
            src={URL.createObjectURL(photo)}
            alt={t('persona.photoLabel')}
            width={56}
            height={96}
            unoptimized
            className="aspect-9/16 h-24 w-14 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-900">{photo.name}</div>
            <div className="mt-0.5 text-xs text-neutral-500">{formatFileSize(photo.size)}</div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-medium text-accent hover:underline"
          >
            {t('persona.photoUpload')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-white px-6 py-8 text-sm font-medium text-neutral-700 transition-colors hover:border-accent/60 hover:bg-red-50/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors group-hover:bg-red-100 group-hover:text-accent">
            <ImageIcon />
          </span>
          <span>{t('persona.photoUpload')}</span>
        </button>
      )}
      <p className="mt-3 text-sm leading-5 text-neutral-600">{t('persona.photoHint')}</p>
    </div>
  );
};

//---------------
// PersonaNameField — nome da persona (RHF: valida no onBlur)
//---------------
const PersonaNameField = () => {
  const { register, formState: { errors } } = useFormContext();
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  return (
    <div>
      <label htmlFor="persona-name" className="text-md block font-medium text-neutral-900">
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
        <p role="alert" className="mt-1 text-sm text-red-600">{t('persona.errName')}</p>
      ) : null}
      {result && !result.success && result.error === t('persona.errName') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </div>
  );
};

//---------------
// PersonaVoiceSection — voice choice among the house voices.
// In edit mode, the sample language starts from the persona's saved language
// instead of the pt-br default.
//---------------
const PersonaVoiceSection = ({ personaLanguage }: { personaLanguage?: string }) => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  return (
    <section data-error-field="voice">
      <SectionDivider label={t('persona.voiceLabel')} />
      <PersonaHouseVoicePicker personaLanguage={personaLanguage} />
      {result && !result.success && result.error === t('persona.errVoice') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};

//---------------
// matchSampleLanguage — picks the voice sample code closest to the
// persona language: exact ('es' → 'es') or by prefix ('pt' → 'pt-br').
// Returns undefined when there is no match.
//---------------
const matchSampleLanguage = (
  personaLanguage: string,
  samples: Array<{ code: string }>,
): string | undefined => {
  const lang = personaLanguage.trim().toLowerCase();
  if (!lang) return undefined;
  const codes = samples.map((sample) => sample.code);
  const exact = codes.find((code) => code.toLowerCase() === lang);
  if (exact) return exact;
  return codes.find((code) => {
    const normalized = code.toLowerCase();
    return normalized.startsWith(`${lang}-`) || lang.startsWith(`${normalized}-`);
  });
};

//---------------
// PersonaHouseVoicePicker — house voice grid
//---------------
const PersonaHouseVoicePicker = ({ personaLanguage }: { personaLanguage?: string }) => {
  const voicesQuery = useVoicesQuery();
  const sampleLanguagesQuery = useVoiceSampleLanguagesQuery();
  const voiceId = usePersonaStore((s) => s.voiceId);
  // Manual user choice (null = not touched yet): wins over the default.
  const [sampleLanguage, setSampleLanguage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPickedVoiceRef = useRef<string | null>(null);
  const { t } = useI18n();

  const voices = voicesQuery.data ?? [];
  const matchedSampleLanguage = personaLanguage
    ? matchSampleLanguage(personaLanguage, sampleLanguagesQuery.data ?? [])
    : undefined;
  const effectiveSampleLanguage = sampleLanguage ?? matchedSampleLanguage ?? 'pt-br';

  const playVoiceSample = (pickedVoiceId: string, language: string): void => {
    audioRef.current?.pause();
    const audio = new Audio(
      `/voice-samples/${encodeURIComponent(pickedVoiceId)}-${encodeURIComponent(language)}.mp3`,
    );
    audioRef.current = audio;
    const playResult = audio.play();
    if (playResult) {
      void playResult.catch(() => {});
    }
  };

  const handlePickVoice = (pickedVoiceId: string) => {
    usePersonaStore.getState().setVoiceId(pickedVoiceId);
    lastPickedVoiceRef.current = pickedVoiceId;
    playVoiceSample(pickedVoiceId, effectiveSampleLanguage);
  };

  const handleSampleLanguageChange = (language: string) => {
    setSampleLanguage(language);
    // Switched language after listening to a sample? Restart the audio in the new language.
    const lastPickedVoice = lastPickedVoiceRef.current;
    if (lastPickedVoice) {
      playVoiceSample(lastPickedVoice, language);
    }
  };

  return (
    <div className="mt-4">
      <label className="mb-4 block max-w-sm text-sm font-medium text-neutral-700">
        {t('persona.sampleLanguage')}
        <span className="relative mt-2 block">
          <select
            data-testid="sample-language"
            value={effectiveSampleLanguage}
            onChange={(e) => handleSampleLanguageChange(e.target.value)}
            className="h-12 w-full appearance-none rounded-xl border border-neutral-300 bg-white px-4 pr-11 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:border-neutral-400 focus:border-accent focus:ring-4 focus:ring-accent/10 focus:outline-none"
          >
            {(sampleLanguagesQuery.data ?? []).map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-neutral-500">
            <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((voice) => {
          const isActive = voice.id === voiceId;
          return (
            <button
              key={voice.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => handlePickVoice(voice.id)}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isActive
                  ? 'border-accent bg-red-50/50'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  isActive ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                <MicIcon />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
                {voiceLabel(voice.id)}
              </span>
              {isActive && (
                <span className="text-accent">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

//---------------
// PersonaSubmit — persona validation and submit (create/edit).
// Create: POST /api/persona (persona alone). Success → /posts, the app's
// home, so the user lands where the results are.
// In edit mode the button shows the save copy instead of the create copy.
//---------------
const PersonaSubmit = ({ editId }: { editId: string | null }) => {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateMutation = useUpdatePersonaMutation();
  const { handleSubmit: validateForm } = useFormContext();
  const [isPending, setIsPending] = useState(false);

  // Same page serves create and edit: the id comes from ?edit= (current route)
  // or the legacy /personas/<id>/edit.
  const editingPersonaId = resolveEditingPersonaId(pathname, editId);
  const isEditing = Boolean(editingPersonaId);

  const handleSubmit = async () => {
    const state = usePersonaStore.getState();
    if (!state.name.trim()) {
      state.setResult({ success: false, error: t('persona.errName') });
      scrollToErrorField('name');
      return;
    }
    // storedPhotoUrl: the persona already has an uploaded photo (photo_path),
    // so editing it needs no new file and no character. Without this the
    // "pick a face" validation blocked every save of a photo persona.
    if (!state.photo && !state.avatarUrl && !state.storedPhotoUrl) {
      state.setResult({ success: false, error: t('persona.errAvatar') });
      scrollToErrorField('avatar');
      return;
    }
    if (!state.voiceId) {
      state.setResult({ success: false, error: t('persona.errVoice') });
      scrollToErrorField('voice');
      return;
    }

    const language = resolveScriptLanguage(locale);

    state.setResult(null);
    setIsPending(true);
    try {
      const personaId = editingPersonaId;
      if (personaId) {
        const formData = new FormData();
        formData.append('name', state.name.trim());
        if (state.avatarUrl) formData.append('avatarUrl', state.avatarUrl);
        if (state.voiceId) formData.append('voiceId', state.voiceId);
        if (state.videoAspect) formData.append('videoAspect', state.videoAspect);
        if (state.videoLayout) formData.append('videoLayout', state.videoLayout);
        if (state.scriptPrompt.trim()) formData.append('scriptPrompt', state.scriptPrompt.trim());
        if (state.niche.trim()) formData.append('niche', state.niche.trim());
        const result = await updateMutation.mutateAsync({ personaId, formData });
        usePersonaStore.getState().setResult(result);
        if (result.success) {
          await queryClient.invalidateQueries({ queryKey: ['persona-list'] });
          router.back();
        } else if (result.error === 'prompt_rejected') {
          scrollToErrorField('script');
        }
      } else {
        const result = await createPersona(state.buildPersonaFormData(language));
        usePersonaStore.getState().setResult(result);
        if (result.success) {
          await queryClient.invalidateQueries({ queryKey: ['persona-list'] });
          // Creating a persona lands on the personas list, so the user
          // immediately sees the persona they just created.
          router.push('/personas');
        } else if (result.error === 'prompt_rejected') {
          scrollToErrorField('script');
        }
      }
    } catch {
      usePersonaStore.getState().setResult({ success: false, error: t('persona.errServer') });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={validateForm(() => void handleSubmit())}
        disabled={isPending || updateMutation.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <SpinnerIcon />
            {t(isEditing ? 'personas.saving' : 'persona.submitting')}
          </>
        ) : (
          t(isEditing ? 'personas.save' : 'persona.submit')
        )}
      </button>
      <p className="mt-3 text-center text-sm leading-5 text-neutral-600">
        {t(isEditing ? 'personas.saveHint' : 'persona.submitHint')}
      </p>
    </div>
  );
};

//---------------
// PersonaFeedback — creation result (success or error)
//---------------
const PersonaFeedback = () => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();
  const { reset } = useFormContext<{
    name: string;
    niche: string;
    scriptPrompt: string;
  }>();

  if (!result) return null;

  //---------------
  // Clears the store AND the RHF fields: without reset() the inputs keep
  // showing the old text while the store is already empty.
  //---------------
  const handleCreateAnother = () => {
    reset({ name: '', niche: '', scriptPrompt: '' });
    usePersonaStore.getState().resetForm();
  };

  if (result.success) {
    return (
      <section>
        <SectionDivider label={t('persona.result')} />
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-start gap-3.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
              <CheckIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-green-900">{t('persona.created')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-green-800">{t('persona.createdHint')}</p>
              {result.warnings && result.warnings.length > 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-amber-700">
                  {mapPersonaImageWarnings(result.warnings, t)}
                </p>
              ) : null}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleCreateAnother}
                  className="text-xs font-medium text-green-800/80 hover:text-green-900"
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

//---------------
// PersonaErrorDialog — create/update error in a modal, so the user does
// not lose the message (it used to sit in a box at the page bottom).
//---------------
const PersonaErrorDialog = () => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();

  if (!result || result.success) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="persona-error-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <AlertIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="persona-error-dialog-title" className="text-lg font-semibold text-neutral-900">
              {t('persona.failed')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-neutral-600">{result.error}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => usePersonaStore.getState().setResult(null)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t('persona.tryAgain')}
          </button>
        </div>
      </div>
    </div>
  );
};

//---------------
// getCharacterIndex — finds the saved avatar in the carousel without scrolling it.
// Returns the first item when the image is not an available character.
//---------------
const getCharacterIndex = (avatarUrl: string | null): number => {
  const match = avatarUrl?.match(/\/file-(\d+)\.png$/);
  const index = match ? Number(match[1]) - 1 : 0;
  return index >= 0 && index < DEFAULT_PERSONA_FACE_IDS.length ? index : 0;
};

//---------------
// PersonaPageSkeleton — placeholder de carregamento da tela
//---------------
const PersonaPageSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="space-y-8">
    <div className="flex items-center gap-3">
      <div className="skeleton-shimmer size-10 shrink-0 rounded-xl" />
      <div className="space-y-2">
        <div className="skeleton-shimmer h-5 w-40 rounded" />
        <div className="skeleton-shimmer h-3.5 w-64 rounded" />
      </div>
    </div>
    <section className="space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex gap-2"><div className="skeleton-shimmer h-9 w-28 rounded-lg" /><div className="skeleton-shimmer h-9 w-24 rounded-lg" /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /></div>
      <div className="space-y-2"><div className="skeleton-shimmer h-4 w-28 rounded" /><div className="skeleton-shimmer h-12 w-full rounded-xl" /></div>
    </section>
    <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="skeleton-shimmer h-4 w-32 rounded" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="skeleton-shimmer h-16 rounded-xl" /><div className="skeleton-shimmer h-16 rounded-xl" /><div className="skeleton-shimmer h-16 rounded-xl" /></div>
    </section>
    <section className="space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="skeleton-shimmer h-4 w-36 rounded" />
      <div className="skeleton-shimmer h-12 w-full rounded-xl" />
      <div className="skeleton-shimmer h-24 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3"><div className="skeleton-shimmer h-12 rounded-xl" /><div className="skeleton-shimmer h-12 rounded-xl" /><div className="skeleton-shimmer h-12 rounded-xl" /></div>
    </section>
    <div className="skeleton-shimmer h-12 w-full rounded-xl" />
  </div>
);
