'use client';

import { useState } from 'react';

import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';

import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { PersonaHouseVoicePicker } from './voice-picker';
import { PersonaVoiceClonePanel, VoiceTabButton } from './voice-clone-picker';

export const PersonaVoiceSection = ({ personaLanguage }: { personaLanguage?: string }) => {
  const result = usePersonaStore((s) => s.result);
  const { t } = useI18n();
  const [voiceTab, setVoiceTab] = useState<'house' | 'clone'>('house');

  return (
    <section data-error-field="voice">
      <SectionDivider label={t('persona.voiceLabel')} />
      <div
        role="tablist"
        aria-label={t('persona.voiceLabel')}
        className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1"
      >
        <VoiceTabButton
          active={voiceTab === 'house'}
          label={t('persona.voiceHouseTab')}
          onSelect={() => setVoiceTab('house')}
        />
        <VoiceTabButton
          active={voiceTab === 'clone'}
          label={t('persona.voiceCloneTab')}
          onSelect={() => setVoiceTab('clone')}
        />
      </div>
      <div hidden={voiceTab !== 'house'}>
        <PersonaHouseVoicePicker />
      </div>
      <div hidden={voiceTab !== 'clone'}>
        <PersonaVoiceClonePanel personaLanguage={personaLanguage} />
      </div>
      {result && !result.success && result.error === t('persona.errVoice') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};
