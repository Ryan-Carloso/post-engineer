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
import { useDebugStore } from '@/lib/debug-store';
import { normalizeDebugTaskResponse } from '@/lib/debug-video';
import { parsePersonaForm, personaFormSchema } from '@/lib/persona-schema';
import { openUpgradeDialogIfInsufficient } from '@/lib/upgrade-dialog-store';
import { useI18n } from '@/lib/i18n/provider';
import { PersonaTokensSection } from './persona-tokens';
import { PersonaImageLibrarySection } from './persona-image-library';
import { scrollToErrorField } from '@/lib/scroll-to-error';
import type { TranslationKey } from '@/lib/i18n';
import { DEFAULT_PERSONA_FACE_IDS } from '@/lib/persona-faces';
import {
  AlertIcon,
  CheckIcon,
  SparklesIcon,
  ImageIcon,
  MicIcon,
  FilmIcon,
  SECTION_LABEL_CLASS,
  SpinnerIcon,
  UploadIcon,
  BugIcon,
  formatFileSize,
  INPUT_CLASS,
} from '@/lib/ui';

const VOICE_LABEL: Record<string, TranslationKey> = {
  calm: 'persona.voiceCalm',
  energetic: 'persona.voiceEnergetic',
  young: 'persona.voiceYoung',
  deep: 'persona.voiceDeep',
};

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
  const personaMode = usePersonaStore((s) => s.personaMode);

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
    store.setAvatarUrl(persona.avatarUrl ?? persona.photoUrl ?? null);
    store.setVoiceId(persona.voiceId ?? null);
    store.setVideoAspect(persona.videoAspect ?? '9:16');
    store.setScriptPrompt(persona.scriptPrompt ?? '');
    store.setNiche(persona.niche ?? '');
    store.setResult(null);
    methods.setValue('name', persona.name);
    methods.setValue('scriptPrompt', persona.scriptPrompt ?? '');
    methods.setValue('niche', persona.niche ?? '');
  }, [editingPersona, methods]);

  if (voicesQuery.isError || sampleLanguagesQuery.isError || personasQuery.isError) {
    return <PersonaPageError />;
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
            <PersonaModeSelector />
            <PersonaNameField />
            {personaMode === 'persona' ? <PersonaAvatarSection /> : null}
            {/* The server decides facelessness from the stored face_mix_percent
                (see POST /api/persona/images), not from the create-flow store:
                an editing persona whose face_mix_percent is 0 must not show
                the library, or every upload would be rejected. The persona
                must also be loaded: while the list is fetching (or errored),
                editingPersona is undefined and the section stays hidden
                instead of flashing for a faceless persona. */}
            {personaMode === 'persona' &&
            editingPersonaId &&
            editingPersona !== undefined &&
            editingPersona.faceMixPercent !== 0 ? (
                <PersonaImageLibrarySection personaId={editingPersonaId} />
              ) : null}
            {/* Faceless: no avatar — voice is still required, video is 100% stock. */}
            {/* Mix + quality + cost: enabled in persona mode, locked at 0% in faceless. */}
            <PersonaTokensSection />
          </section>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <PersonaVoiceSection personaLanguage={editingPersona?.language} />
          </section>
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
            <PersonaPreferencesSection />
          </section>
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
const PersonaPageError = () => {
  const { t } = useI18n();
  const personasQuery = usePersonaListQuery();
  const voicesQuery = useVoicesQuery();
  const sampleLanguagesQuery = useVoiceSampleLanguagesQuery();

  const retry = async (): Promise<void> => {
    const requests: Array<Promise<unknown>> = [];
    if (voicesQuery.isError) requests.push(voicesQuery.refetch());
    if (sampleLanguagesQuery.isError) requests.push(sampleLanguagesQuery.refetch());
    if (personasQuery.isError) requests.push(personasQuery.refetch());
    await Promise.all(requests);
  };

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
          disabled={voicesQuery.isFetching}
          onClick={() => void retry()}
          className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {voicesQuery.isFetching && <SpinnerIcon />}
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
  const debugMode = useDebugStore((s) => s.debugMode);
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
        <SparklesIcon />
      </span>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-neutral-900">
          {t(editing ? 'personas.editTitle' : 'persona.title')}
          {debugMode ? (
            <span title="Debug mode ativo" aria-label="Debug mode ativo" className="flex size-6 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <BugIcon />
            </span>
          ) : null}
        </h1>
        <p className="text-sm text-neutral-500">{t(editing ? 'personas.editSubtitle' : 'persona.subtitle')}</p>
      </div>
    </div>
  );
};

//---------------
// PersonaModeSelector — choose between Consumer Persona (AI avatar + lipsync)
// or Video Faceless (100% stock footage, no avatar, no face filter).
// The voice can be chosen in both modes.
//---------------
const PersonaModeSelector = () => {
  const personaMode = usePersonaStore((s) => s.personaMode);
  const setPersonaMode = usePersonaStore((s) => s.setPersonaMode);
  const { t } = useI18n();

  return (
    <section>
      <SectionDivider label={t('persona.modeLabel')} />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('persona.modeLabel')}>
        <button
          type="button"
          role="radio"
          aria-checked={personaMode === 'persona'}
          onClick={() => setPersonaMode('persona')}
          className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            personaMode === 'persona'
              ? 'border-accent bg-red-50/50 ring-2 ring-accent/10'
              : 'border-neutral-200 bg-white hover:border-neutral-400'
          }`}
        >
          <span
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
              personaMode === 'persona' ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            <SparklesIcon />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-neutral-900">
              {t('persona.modePersona')}
            </strong>
            <span className="mt-1 block text-sm leading-5 text-neutral-500">
              {t('persona.modePersonaHint')}
            </span>
          </span>
          {personaMode === 'persona' ? (
            <span className="mt-0.5 shrink-0 text-accent">
              <CheckIcon />
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={personaMode === 'faceless'}
          onClick={() => setPersonaMode('faceless')}
          className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            personaMode === 'faceless'
              ? 'border-accent bg-red-50/50 ring-2 ring-accent/10'
              : 'border-neutral-200 bg-white hover:border-neutral-400'
          }`}
        >
          <span
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
              personaMode === 'faceless' ? 'bg-accent text-white' : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            <FilmIcon />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-neutral-900">
              {t('persona.modeFaceless')}
            </strong>
            <span className="mt-1 block text-sm leading-5 text-neutral-500">
              {t('persona.modeFacelessHint')}
            </span>
          </span>
          {personaMode === 'faceless' ? (
            <span className="mt-0.5 shrink-0 text-accent">
              <CheckIcon />
            </span>
          ) : null}
        </button>
      </div>
    </section>
  );
};

//---------------
//---------------
// PersonaAvatarSection — visual identity choice: AI-generated or photo upload
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
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    usePersonaStore.getState().setPhoto(file);
    e.target.value = '';
  };

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
                {t(VOICE_LABEL[voice.id] ?? 'persona.voiceCalm')}
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
// PersonaPreferencesSection — optional persona content defaults
//---------------
const PersonaPreferencesSection = () => {
  const videoAspect = usePersonaStore((s) => s.videoAspect);
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();
  const { register, formState: { errors } } = useFormContext();
  return (
    <section>
      <SectionDivider label={t('personas.preferencesLabel')} />
      <div className="mt-4 space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <fieldset>
          <legend className="text-sm font-semibold text-neutral-800">{t('personas.aspectLabel')}</legend>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {['9:16', '16:9', '1:1'].map((aspect) => {
              const isSelected = videoAspect === aspect;
              return (
                <button
                  key={aspect}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => usePersonaStore.getState().setVideoAspect(aspect)}
                  className={`flex min-h-14 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isSelected
                      ? 'border-accent bg-red-50 text-accent ring-2 ring-accent/10'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-400 hover:bg-white'
                  }`}
                >
                  {aspect}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block text-sm font-semibold text-neutral-800">
          {t('personas.nicheLabel')}
          <input
            type="text"
            className={INPUT_CLASS}
            placeholder={t('personas.nichePlaceholder')}
            data-testid="persona-niche"
            {...register('niche')}
          />
          {errors.niche ? (
            <span role="alert" className="mt-1 block text-sm font-normal text-red-600">{t('personas.nicheMaxError')}</span>
          ) : null}
        </label>
        <label className="block text-sm font-semibold text-neutral-800" data-error-field="script">
          {t('personas.scriptLabel')}
          <textarea className={`${INPUT_CLASS} min-h-28 resize-y`} placeholder={t('personas.scriptPlaceholder')} {...register('scriptPrompt')} />
          {errors.scriptPrompt ? (
            <span role="alert" className="mt-1 block text-sm font-normal text-red-600">{t('personas.scriptMaxError')}</span>
          ) : null}
        </label>
        {result && !result.success && result.error === 'prompt_rejected' ? (
          <InlineFieldError message={t('persona.errPromptRejected')} />
        ) : null}
      </div>
    </section>
  );
};

//---------------
// PersonaDebugSubmit — alternative debug-mode submit: generates the video
// through the REAL flow (/api/persona/video-job debug branch, with
// moderation and token charging) without creating a persona/schedule,
// and unlocks the download when done.
//---------------
const PersonaDebugSubmit = () => {
  const { t, locale } = useI18n();
  const { handleSubmit } = useFormContext();
  const [status, setStatus] = useState<'idle' | 'starting' | 'generating' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const pollingRef = useRef(false);

  useEffect(() => () => { pollingRef.current = false; }, []);

  const poll = async (taskId: string): Promise<void> => {
    pollingRef.current = true;
    while (pollingRef.current) {
      try {
        const response = await fetch(`/api/persona/video-status/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => null);
        setLogs((current) => [...current, `GET status (${response.status})\n${JSON.stringify(body, null, 2)}`]);
        if (!response.ok) {
          setError(readDebugError(body));
          setStatus('error');
          pollingRef.current = false;
          return;
        }
        const task = normalizeDebugTaskResponse(body);
        if (!task || typeof task.state !== 'number') {
          setError('Resposta de status inválida do engine.');
          setStatus('error');
          pollingRef.current = false;
          return;
        }
        if (typeof task.progress === 'number') setProgress(task.progress);
        if (task.state === -1) {
          setError(task.error ?? 'Task failed.');
          setStatus('error');
          pollingRef.current = false;
          return;
        }
        if (task.state === 1) {
          setDownloadUrl(`/api/persona/video-download/${encodeURIComponent(taskId)}/final-1.mp4`);
          setProgress(100);
          setStatus('done');
          pollingRef.current = false;
          return;
        }
      } catch (requestError: unknown) {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
        setStatus('error');
        pollingRef.current = false;
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    }
  };

  const generate = async (): Promise<void> => {
    if (status === 'starting' || status === 'generating') return;
    setStatus('starting');
    setError(null);
    setDownloadUrl(null);
    setProgress(0);
    setLogs(['POST /api/persona/video-job (debug)\nEnviando os dados do formulário de persona.']);
    try {
      const formData = usePersonaStore.getState().buildPersonaFormData(locale);
      formData.append('debugMode', '1');
      // Mesmo schema zod do server — falha aqui, sem round-trip.
      const parsed = parsePersonaForm(formData, 'debug');
      if (!parsed.ok) {
        setError(
          parsed.error === 'video_subject is required.'
            ? t('persona.errSubjectMissing')
            : parsed.error,
        );
        setStatus('idle');
        scrollToErrorField('script');
        return;
      }
      const response = await fetch('/api/persona/video-job', { method: 'POST', body: formData });
      const body: unknown = await response.json().catch(() => null);
      setLogs((current) => [...current, `POST resposta (${response.status})\n${JSON.stringify(body, null, 2)}`]);
      if (openUpgradeDialogIfInsufficient(response.status, (body as { code?: unknown } | null)?.code)) {
        // Sem saldo: dialog global de upgrade.
        setStatus('idle');
        return;
      }
      if (!response.ok || !isRecord(body) || typeof body.taskId !== 'string') {
        setError(readDebugError(body));
        setStatus('error');
        return;
      }
      setStatus('generating');
      void poll(body.taskId);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setStatus('error');
    }
  };

  const percentage = progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
  return (
    <section className="space-y-4">
      <button type="button" data-testid="debug-generate" onClick={handleSubmit(() => void generate())} disabled={status === 'starting' || status === 'generating'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60">
        {status === 'generating' ? `Gerando vídeo (${percentage}%)...` : 'Gerar vídeo para download'}
      </button>
      {status === 'done' && downloadUrl ? <a data-testid="debug-download" href={downloadUrl} download="post-engineer-debug.mp4" className="flex w-full items-center justify-center rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white">Baixar vídeo</a> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {logs.length > 0 ? <details open className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-200"><summary className="cursor-pointer font-semibold text-amber-300">LOG DO DEBUG</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap">{logs.join('\n\n')}</pre></details> : null}
    </section>
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const readDebugError = (value: unknown): string => {
  if (isRecord(value)) {
    for (const key of ['error', 'message', 'detail', 'details']) {
      if (typeof value[key] === 'string') return value[key];
    }
  }
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
};

//---------------
// PersonaSubmit — persona validation and submit (create/edit).
// Create: POST /api/persona (persona alone — scheduling is a separate flow,
// at /schedule). Success → /schedule?personaId= to schedule right after.
// In edit mode the button shows the save copy instead of the create copy.
//---------------
const PersonaSubmit = ({ editId }: { editId: string | null }) => {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateMutation = useUpdatePersonaMutation();
  const debugMode = useDebugStore((s) => s.debugMode);
  const { handleSubmit: validateForm } = useFormContext();
  const [isPending, setIsPending] = useState(false);

  if (debugMode) {
    return <PersonaDebugSubmit />;
  }

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
    if (!state.photo && !state.avatarUrl) {
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
          router.push(`/schedule?personaId=${result.personaId}`);
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
    result.error === t('fillSchedule.mustSelectAccount')
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
// InlineFieldError — validation error next to the invalid field.
//---------------
const InlineFieldError = ({ message }: { message: string }) => (
  <p role="alert" className="mt-2 text-sm font-medium text-red-700">{message}</p>
);

//---------------
// SectionDivider — divider with label
//---------------
const SectionDivider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3">
    <span className={SECTION_LABEL_CLASS}>{label}</span>
    <span className="h-px flex-1 bg-neutral-200" />
  </div>
);

//---------------
// getCharacterIndex — encontra o avatar salvo no carrossel sem executar scroll.
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
