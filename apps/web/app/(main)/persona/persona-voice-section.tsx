'use client';

import { useState } from 'react';

import { useVoicesQuery } from '@/lib/api';
import { resolvePersonaVoice, VOICE_FALLBACK_REASONS } from '@/lib/voice-fallback';
import { useI18n } from '@/lib/i18n/provider';
import { usePersonaStore } from '@/lib/store';

import { InlineFieldError, SectionDivider } from './persona-section-parts';
import { PersonaHouseVoicePicker } from './voice-picker';
import { PersonaVoiceClonePanel, VoiceTabButton } from './voice-clone-picker';

/** True once a create form is ready, or an edit form has loaded its persona.
 *  The list route omits a missing voice_id (undefined) and the page writes
 *  null; that loaded-empty state must warn, the not-yet-loaded null must not. */
export function isPersonaVoiceHydrated(
  editingPersonaId: string | null,
  editingPersona: unknown,
): boolean {
  return editingPersonaId ? editingPersona !== undefined : true;
}

export const PersonaVoiceSection = ({
  voiceHydrated = true,
  isEditing = false,
}: {
  voiceHydrated?: boolean;
  /** True while editing a saved persona. The create form starts with a
   *  null voiceId; VOICE_MISSING must not warn until a persona exists. */
  isEditing?: boolean;
}) => {
  const { t } = useI18n();
  const result = usePersonaStore((s) => s.result);
  const savedVoiceId = usePersonaStore((s) => s.voiceId);
  const language = usePersonaStore((s) => s.language);
  const voicesQuery = useVoicesQuery();
  const [voiceTab, setVoiceTab] = useState<'house' | 'clone'>('house');

  //---------------
  // Voice-fallback warning (issue #277): the saved persona voice is checked
  // against the LIVE served catalog (the same list the picker renders and
  // the engine speaks with). A voice the catalog no longer lists is
  // reported amber — with the house default the dispatch would swap in —
  // before the user ever generates a video, so the swap the API persists is
  // never a surprise. A freshly picked voice from either tab is in the
  // catalog by construction, so the warning only ever names a stale id.
  // Language comes from the persona store so a legacy non-English row is
  // not promised an English house swap the API will refuse.
  //---------------
  const catalogIds = new Set((voicesQuery.data ?? []).map((voice) => voice.id));
  // Skip the check while the catalog is loading, failed, or empty: an empty
  // set would flag every house voice as retired, and a load failure is
  // already surfaced by the picker's own retry states.
  const resolution =
    !voiceHydrated || catalogIds.size === 0
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
        <p role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800" data-testid="persona-voice-fallback-warning">
          {t('persona.voiceUnavailableWarning')}
        </p>
      ) : showFallback && fallback !== null ? (
        <p role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800" data-testid="persona-voice-fallback-warning">
          {fallback.fromVoice.length === 0
            ? t(fallbackKey, { toVoice: fallback.toVoice })
            : t(fallbackKey, { fromVoice: fallback.fromVoice, toVoice: fallback.toVoice })}
        </p>
      ) : null}
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
        <PersonaVoiceClonePanel />
      </div>
      {result && !result.success && result.error === t('persona.errVoice') ? (
        <InlineFieldError message={result.error} />
      ) : null}
    </section>
  );
};
