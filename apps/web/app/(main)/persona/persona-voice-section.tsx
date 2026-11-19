'use client';

import { useState } from 'react';

import { useVoicesQuery } from '@/lib/api';
import { resolvePersonaVoice, VOICE_FALLBACK_REASONS } from '@/lib/voice-fallback';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';

import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { PersonaHouseVoicePicker } from './voice-picker';
import { PersonaVoiceClonePanel, VoiceTabButton } from './voice-clone-picker';

export function isPersonaVoiceHydrated(
  editingPersonaId: string | null,
  editingPersona: unknown,
): boolean {
  return editingPersonaId ? editingPersona !== undefined : true;
}

export const PersonaVoiceSection = ({
  voiceHydrated = true,
  isEditing = false,
  hasVoiceAudio = false,
}: {
  voiceHydrated?: boolean;
  isEditing?: boolean;
  hasVoiceAudio?: boolean;
}) => {
  const { t } = useI18n();
  const result = usePersonaStore((s) => s.result);
  const savedVoiceId = usePersonaStore((s) => s.voiceId);
  const language = usePersonaStore((s) => s.language);
  const voicesQuery = useVoicesQuery();
  const [voiceTab, setVoiceTab] = useState<'house' | 'clone'>('house');

  const catalogIds = new Set((voicesQuery.data ?? []).map((voice) => voice.id));
  const resolution =
    !voiceHydrated || hasVoiceAudio || catalogIds.size === 0
      ? null
      : resolvePersonaVoice(savedVoiceId, language, { catalogIds });
  const unavailable = resolution?.kind === 'unavailable';
  const fallback = resolution?.kind === 'fallback' ? resolution : null;
  const showMissing = isEditing && fallback?.reason === VOICE_FALLBACK_REASONS.VOICE_MISSING;
  const showFallback =
    fallback !== null &&
    (fallback.reason !== VOICE_FALLBACK_REASONS.VOICE_MISSING || showMissing);
  const fallbackKey =
    fallback?.reason === VOICE_FALLBACK_REASONS.VOICE_MISSING
      ? 'persona.voiceFallbackMissingWarning'
      : 'persona.voiceFallbackWarning';

  return (
    <section data-error-field="voice">
      <SectionDivider label={t('persona.voiceLabel')} />
      {unavailable ? (
        <p role="status" className="mb-3 rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning" data-testid="persona-voice-fallback-warning">
          {t('persona.voiceUnavailableWarning')}
        </p>
      ) : showFallback && fallback !== null ? (
        <p role="status" className="mb-3 rounded-xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning" data-testid="persona-voice-fallback-warning">
          {fallback.fromVoice.length === 0
            ? t(fallbackKey, { toVoice: fallback.toVoice })
            : t(fallbackKey, { fromVoice: fallback.fromVoice, toVoice: fallback.toVoice })}
        </p>
      ) : null}
      <div
        role="tablist"
        aria-label={t('persona.voiceLabel')}
        className="inline-flex gap-1 rounded-lg bg-sunken p-1"
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
        <PersonaVoiceClonePanel />
      </div>
      {result && !result.success && result.error === t('persona.errVoice') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};
