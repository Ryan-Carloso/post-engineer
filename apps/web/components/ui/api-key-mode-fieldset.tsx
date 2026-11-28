'use client';

import type { ReactNode } from 'react';
import type { ApprovalMode } from '@/lib/api-keys';
import { useI18n } from '@/lib/i18n/provider';

const MODES: readonly ApprovalMode[] = ['yolo', 'approval'];

export default function ApiKeyModeFieldset({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled: boolean;
}): ReactNode {
  const { t } = useI18n();
  return (
    <fieldset disabled={disabled}>
      <legend className="block text-xs font-medium text-ink-soft">{t('apiKeys.modeLabel')}</legend>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {MODES.map((mode) => (
          <label
            key={mode}
            className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-3 py-2"
          >
            <input
              type="radio"
              name={name}
              data-testid={`${name}-${mode}`}
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">
                {mode === 'yolo' ? t('apiKeys.modeYolo') : t('apiKeys.modeApproval')}
              </span>
              <span className="block text-xs text-muted-text">
                {mode === 'yolo' ? t('apiKeys.modeYoloHint') : t('apiKeys.modeApprovalHint')}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
