'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n/provider';
import { CheckIcon, INPUT_CLASS, PlayIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import {
  filterHouseVoices,
  searchVoices,
  voiceSampleName,
  type GenderFilter,
  type OriginFilter,
  type VoiceOption,
} from '@/lib/voice-catalog';

//---------------
// VoiceTags — the gender/origin chips shown under a voice name. Translated
// here; the description itself stays in English (the voices are English).
//---------------
export function VoiceTags({ voice }: { voice: VoiceOption }) {
  const { t } = useI18n();
  const tags: string[] = [];
  if (voice.kind === 'character') {
    tags.push(t('persona.voiceTagCharacter'));
  } else if (voice.accent === 'us') {
    tags.push(t('persona.voiceFilterUs'));
  } else if (voice.accent === 'gb') {
    tags.push(t('persona.voiceFilterGb'));
  }
  if (voice.gender === 'female') {
    tags.push(t('persona.voiceFilterFemale'));
  } else if (voice.gender === 'male') {
    tags.push(t('persona.voiceFilterMale'));
  }
  if (tags.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted-text">
          {tag}
        </span>
      ))}
    </span>
  );
}

//---------------
// SegmentedControl — one row of mutually exclusive options, styled like the
// "House voices / Clone my voice" tabs above it so the section reads as one
// family of controls.
//---------------
function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'grid w-full rounded-lg bg-sunken p-1 sm:inline-flex sm:w-auto',
        options.length === 4 ? 'grid-cols-2 min-[400px]:grid-cols-4' : 'grid-cols-3',
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'truncate rounded-md p-1.5 text-xs font-medium transition-colors sm:px-3',
            option.value === value ? 'bg-card text-ink shadow-sm' : 'text-muted-text hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

//---------------
// VoicePickerDialog — searchable, filterable list of house voices. Each row
// plays its sample from the round button and picks the voice when clicked
// anywhere else; picking closes the dialog. Filters and search reset when it
// closes so the next open starts from the full list.
//---------------
export function VoicePickerDialog({
  open,
  onOpenChange,
  voices,
  selectedVoiceId,
  playingVoiceId,
  onPlay,
  onPick,
  labelFor,
  modelFor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voices: readonly VoiceOption[];
  selectedVoiceId: string | null;
  playingVoiceId: string | null;
  onPlay: (voice: VoiceOption) => void;
  onPick: (voice: VoiceOption) => void;
  /** Display name (catalog label, or the parsed OpenRouter voice). */
  labelFor: (voice: VoiceOption) => string;
  /** OpenRouter model line; '' when the voice has none. */
  modelFor: (voice: VoiceOption) => string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');

  const visible = searchVoices(filterHouseVoices(voices, gender, origin), query);

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setQuery('');
      setGender('all');
      setOrigin('all');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl bg-card p-0">
        <DialogHeader className="space-y-1 border-b border-line px-5 pt-5 pb-4 text-left">
          <DialogTitle>{t('persona.voicePickerTitle')}</DialogTitle>
          <DialogDescription className="text-muted-text">{t('persona.voicePickerHint')}</DialogDescription>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('persona.voicePickerSearch')}
            aria-label={t('persona.voicePickerSearch')}
            className={cn(INPUT_CLASS, 'mt-3')}
          />
          <div className="flex flex-wrap gap-2 pt-3">
            <SegmentedControl
              label={t('persona.voiceFilterGender')}
              value={gender}
              onChange={setGender}
              options={[
                { value: 'all', label: t('persona.voiceFilterAll') },
                { value: 'female', label: t('persona.voiceFilterFemale') },
                { value: 'male', label: t('persona.voiceFilterMale') },
              ]}
            />
            <SegmentedControl
              label={t('persona.voiceFilterOrigin')}
              value={origin}
              onChange={setOrigin}
              options={[
                { value: 'all', label: t('persona.voiceFilterAll') },
                { value: 'us', label: t('persona.voiceFilterUs') },
                { value: 'gb', label: t('persona.voiceFilterGb') },
                { value: 'character', label: t('persona.voiceFilterCharacters') },
              ]}
            />
          </div>
          <p className="pt-2 text-xs text-muted-text" aria-live="polite">
            {t('persona.voicePickerCount', { count: visible.length })}
          </p>
        </DialogHeader>
        <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
          {visible.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-text">{t('persona.voiceFilterEmpty')}</li>}
          {visible.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            const hasSample = voiceSampleName(voice) !== null;
            return (
              <li key={voice.id} className={cn('flex items-start gap-3 px-5 py-3', isSelected && 'bg-surface')}>
                <button
                  type="button"
                  onClick={() => onPlay(voice)}
                  disabled={!hasSample}
                  aria-label={t('persona.voicePlaySample', { name: labelFor(voice) })}
                  className={cn(
                    'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40',
                    playingVoiceId === voice.id
                      ? 'border-ink bg-ink text-on-ink'
                      : 'border-line bg-card text-ink-soft hover:border-muted-text',
                  )}
                >
                  <PlayIcon />
                </button>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  title={voice.id}
                  onClick={() => onPick(voice)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{labelFor(voice)}</span>
                      <VoiceTags voice={voice} />
                    </span>
                    {modelFor(voice) !== '' && (
                      <span className="block truncate text-xs text-muted-text">{modelFor(voice)}</span>
                    )}
                    {voice.description !== null && (
                      <span className="line-clamp-2 text-xs leading-relaxed text-muted-text">{voice.description}</span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="mt-1 text-ink">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
