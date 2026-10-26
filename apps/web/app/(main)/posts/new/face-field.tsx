'use client';

import { useNewPostStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n/provider';
import { CheckIcon, FilmIcon, ImageIcon, SparklesIcon } from '@/lib/ui';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CARD_CLASS, SectionTitle } from './section';

//---------------
// Video face — every persona has a face; "no face" is chosen here, per
// post (no lipsync, no library image). With a persona selected, "with the
// face" is the normal choice. Without one there is nothing to render, so
// the choice collapses to "no face" and the control says why. Same card
// pattern as the persona picker above: shadcn RadioGroup as the sr-only
// item + Label as the clickable card.
//
// A second card group asks what fills the video, with or without a face:
// stock footage only ("broll", the default) or catalog illustrations only
// ("svg"). The two never mix in one video.
//---------------
export const NewPostFaceField = () => {
  const { t } = useI18n();
  const faceless = useNewPostStore((s) => s.faceless);
  const setFaceless = useNewPostStore((s) => s.setFaceless);
  const withoutPersona = useNewPostStore((s) => s.withoutPersona);
  const facelessMaterial = useNewPostStore((s) => s.facelessMaterial);
  const setFacelessMaterial = useNewPostStore((s) => s.setFacelessMaterial);

  const facelessOption = {
    value: 'faceless',
    faceless: true,
    label: t('newPost.faceFaceless'),
    hint: withoutPersona
      ? t('newPost.faceFacelessNoPersonaHint')
      : t('newPost.faceFacelessHint'),
  } as const;
  const withFaceOption = {
    value: 'face',
    faceless: false,
    label: t('newPost.faceWithAvatar'),
    hint: t('newPost.faceWithAvatarHint'),
  } as const;
  // No persona means no face to render, so the "with face" option is not
  // merely preselected away — it is not offered at all.
  const options = withoutPersona ? [facelessOption] : [withFaceOption, facelessOption];

  const materialOptions = [
    {
      value: 'broll',
      label: t('newPost.faceMaterialBroll'),
      hint: t('newPost.faceMaterialBrollHint'),
      icon: <FilmIcon />,
    },
    {
      value: 'svg',
      label: t('newPost.faceMaterialSvg'),
      hint: t('newPost.faceMaterialSvgHint'),
      icon: <ImageIcon />,
    },
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
                'relative flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 transition-colors',
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
      <div className="space-y-3 border-t border-neutral-100 pt-4">
        <div>
          <p className="text-sm font-semibold text-neutral-900">{t('newPost.faceMaterialLabel')}</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-500">{t('newPost.faceMaterialHint')}</p>
        </div>
        <RadioGroup
          value={facelessMaterial}
          onValueChange={(value) => setFacelessMaterial(value === 'svg' ? 'svg' : 'broll')}
          aria-label={t('newPost.faceMaterialLabel')}
          className="grid gap-3"
        >
          {materialOptions.map((option) => {
            const itemId = `new-post-face-material-${option.value}`;
            const selected = facelessMaterial === option.value;
            return (
              <Label
                key={option.value}
                htmlFor={itemId}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'relative flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 transition-colors',
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
                  {option.icon}
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
      </div>
    </section>
  );
};
