'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ApprovalMode } from '@/lib/api-keys';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import ApiKeyModeFieldset from '@/components/ui/api-key-mode-fieldset';
import ApiKeyPersonaPicker, { isScopeValid, type PickerPersona } from '@/components/ui/api-key-persona-picker';
import { SpinnerIcon } from '@/lib/ui';

export interface CreateKeyValues {
  name: string;
  approvalMode: ApprovalMode;
  personaIds: string[] | null;
}

export default function ApiKeyCreateForm({
  personas,
  personasLoadFailed,
  pending,
  failed,
  onSubmit,
}: {
  personas: PickerPersona[];
  personasLoadFailed: boolean;
  pending: boolean;
  failed: boolean;
  onSubmit: (values: CreateKeyValues) => void;
}): ReactNode {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('approval');
  const [personaIds, setPersonaIds] = useState<string[] | null>(null);

  const canSubmit = !pending && isScopeValid(personaIds);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: name.trim().length > 0 ? name.trim() : t('apiKeys.defaultKeyName'),
      approvalMode,
      personaIds,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="create-api-key-form"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <div>
        <label htmlFor="api-key-name-input" className="block text-xs font-medium text-ink-soft">
          {t('apiKeys.nameOptionalLabel')}
        </label>
        <input
          id="api-key-name-input"
          type="text"
          data-testid="api-key-name-input"
          placeholder={t('apiKeys.defaultKeyName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-muted-text focus:outline-none"
        />
      </div>
      <ApiKeyModeFieldset name="api-key-mode" value={approvalMode} onChange={setApprovalMode} disabled={pending} />
      <ApiKeyPersonaPicker
        idPrefix="api-key-create"
        personas={personas}
        loadFailed={personasLoadFailed}
        value={personaIds}
        onChange={setPersonaIds}
        disabled={pending}
      />
      {failed ? (
        <p role="alert" data-testid="create-api-key-error" className="text-sm text-destructive">
          {t('apiKeys.createError')}
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          data-testid="submit-create-key-btn"
          disabled={!canSubmit}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink disabled:opacity-50"
        >
          {pending ? <SpinnerIcon /> : t('apiKeys.create')}
        </Button>
      </div>
    </form>
  );
}
