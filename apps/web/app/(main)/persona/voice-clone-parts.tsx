'use client';

import { MAX_CLONE_NAME_LENGTH } from '@/lib/cloned-voice-audio';
import type { ClonedVoicePublicRow } from '@/lib/cloned-voices-types';
import { useI18n } from '@/lib/i18n/provider';
import { CheckIcon, MicIcon, TrashIcon } from '@/lib/ui';

//---------------
// ClonedVoiceRow — one of the caller's own clones in the list. Shows
// the clone's name when it has one (the language code otherwise), its
// status, and the preview / use / delete actions for ready clones.
//---------------
export const ClonedVoiceRow = ({
  clone,
  isActive,
  deleting,
  onPlayPreview,
  onUse,
  onDelete,
}: {
  clone: ClonedVoicePublicRow;
  isActive: boolean;
  deleting: boolean;
  onPlayPreview: () => void;
  onUse: () => void;
  onDelete: () => void;
}) => {
  const { t } = useI18n();
  const statusLabel =
    clone.status === 'ready'
      ? t('persona.voiceCloneStatusReady')
      : clone.status === 'pending'
        ? t('persona.voiceCloneStatusPending')
        : t('persona.voiceCloneStatusFailed');
  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
        isActive ? 'border-accent bg-red-50/40' : 'border-neutral-200'
      }`}
    >
      <MicIcon />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{clone.name ?? clone.language ?? '—'}</span>
        {clone.name ? (
          <span className="ml-2 text-neutral-500">{clone.language ?? ''}</span>
        ) : null}
        <span className="ml-2 text-neutral-500">{statusLabel}</span>
      </span>
      {clone.status === 'ready' ? (
        <>
          <button
            type="button"
            className="text-sm font-medium text-accent hover:underline"
            onClick={onPlayPreview}
          >
            {t('persona.voiceClonePlayPreview')}
          </button>
          <button
            type="button"
            className="text-sm font-medium text-neutral-900 hover:underline"
            onClick={onUse}
          >
            {t('persona.voiceCloneUseOnPersona')}
          </button>
        </>
      ) : null}
      {isActive ? <CheckIcon /> : null}
      <button
        type="button"
        aria-label={t('persona.voiceCloneDelete')}
        onClick={onDelete}
        disabled={deleting}
        className="text-neutral-500 hover:text-red-600"
      >
        <TrashIcon />
      </button>
    </li>
  );
};

//---------------
// CloneNameField — optional display name for the clone being created.
// The engine stores it on the clone row (migration 024) and the clone
// list shows it instead of the bare language code.
//---------------
export const CloneNameField = ({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) => {
  const { t } = useI18n();
  return (
    <label className="block text-sm font-medium text-neutral-700">
      {t('persona.voiceCloneNameLabel')}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('persona.voiceCloneNamePlaceholder')}
        maxLength={MAX_CLONE_NAME_LENGTH}
        disabled={disabled}
        data-testid="voice-clone-name"
        className="mt-2 h-11 w-full max-w-sm rounded-xl border border-neutral-300 bg-white px-3 text-sm"
      />
    </label>
  );
};

//---------------
// CloneCleanToggle — the clean option (default ON, set by the caller):
// when on, the engine clones from the cleaned reference (denoise chain)
// instead of the raw recording.
//---------------
export const CloneCleanToggle = ({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) => {
  const { t } = useI18n();
  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-neutral-800">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          data-testid="voice-clone-clean-toggle"
          className="mt-1"
        />
        <span>{t('persona.voiceCloneCleanLabel')}</span>
      </label>
      <p className="mt-1 ml-6 text-xs text-neutral-500">{t('persona.voiceCloneCleanHint')}</p>
    </div>
  );
};

//---------------
// CleanedPreviewSection — the "Cleaned" half of the A/B preview: a
// button that fetches the cleaned version on demand, then the player.
//---------------
export const CleanedPreviewSection = ({
  cleanedBlobUrl,
  cleaning,
  disabled,
  onRequest,
}: {
  cleanedBlobUrl: string | null;
  cleaning: boolean;
  disabled: boolean;
  onRequest: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t('persona.voiceCloneCleanedLabel')}
      </p>
      {cleanedBlobUrl ? (
        <audio controls src={cleanedBlobUrl} className="w-full" data-testid="voice-clone-cleaned-preview" />
      ) : (
        <button
          type="button"
          onClick={onRequest}
          disabled={cleaning || disabled}
          data-testid="voice-clone-clean-preview-button"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:border-neutral-400 disabled:opacity-60"
        >
          {cleaning ? t('persona.voiceCloneCleanLoading') : t('persona.voiceCloneCleanPreviewButton')}
        </button>
      )}
    </div>
  );
};
