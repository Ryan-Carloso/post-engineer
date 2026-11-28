'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiKeyItem } from '@/lib/api-keys-client';
import type { ApprovalMode } from '@/lib/api-keys';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import ApiKeyModeFieldset from '@/components/ui/api-key-mode-fieldset';
import ApiKeyPersonaPicker, { isScopeValid, type PickerPersona } from '@/components/ui/api-key-persona-picker';
import { SpinnerIcon } from '@/lib/ui';

export default function ApiKeyEditForm({
  apiKey,
  personas,
  personasLoadFailed,
  pending,
  failed,
  onSave,
  onCancel,
}: {
  apiKey: ApiKeyItem;
  personas: PickerPersona[];
  personasLoadFailed: boolean;
  pending: boolean;
  failed: boolean;
  onSave: (values: { approvalMode: ApprovalMode; personaIds: string[] | null }) => void;
  onCancel: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(apiKey.approvalMode);
  const [personaIds, setPersonaIds] = useState<string[] | null>(apiKey.personaIds);

  const canSave = !pending && isScopeValid(personaIds);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (canSave) onSave({ approvalMode, personaIds });
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="edit-api-key-form"
      className="mb-4 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <p className="text-sm font-bold text-ink">{t('apiKeys.editAria', { name: apiKey.name })}</p>
      <ApiKeyModeFieldset name="api-key-edit-mode" value={approvalMode} onChange={setApprovalMode} disabled={pending} />
      <ApiKeyPersonaPicker
        idPrefix="api-key-edit"
        personas={personas}
        loadFailed={personasLoadFailed}
        value={personaIds}
        onChange={setPersonaIds}
        disabled={pending}
      />
      {failed ? (
        <p role="alert" data-testid="edit-api-key-error" className="text-sm text-destructive">
          {t('apiKeys.updateError')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          data-testid="save-api-key-btn"
          disabled={!canSave}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink disabled:opacity-50"
        >
          {pending ? <SpinnerIcon /> : t('apiKeys.save')}
        </Button>
        <Button
          type="button"
          data-testid="cancel-edit-api-key-btn"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-sunken"
        >
          {t('apiKeys.cancel')}
        </Button>
      </div>
    </form>
  );
}
