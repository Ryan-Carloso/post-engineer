'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApiKeysQuery, useCreateApiKeyMutation, useRevokeApiKeyMutation } from '@/lib/api';
import type { ApprovalMode } from '@/lib/api-keys';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import { KeyIcon, SpinnerIcon } from '@/lib/ui';

const MAX_VISIBLE_KEYS = 4;

export default function ApiKeysSection({
  onKeyCreated,
}: {
  onKeyCreated?: (key: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const query = useApiKeysQuery();
  const createMutation = useCreateApiKeyMutation();
  const revokeMutation = useRevokeApiKeyMutation();

  const [isCreating, setIsCreating] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyMode, setKeyMode] = useState<ApprovalMode>('yolo');
  const [newKeyData, setNewKeyData] = useState<{ name: string; key: string } | null>(null);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const { copied, copy } = useCopyText();

  const keys = query.data ?? [];
  const visibleKeys = showAllKeys ? keys : keys.slice(0, MAX_VISIBLE_KEYS);
  const hasHiddenKeys = keys.length > MAX_VISIBLE_KEYS;

  const canSubmit = keyName.trim().length > 0 && !createMutation.isPending;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      const result = await createMutation.mutateAsync({
        name: keyName.trim(),
        personaIds: null,
        approvalMode: keyMode,
      });
      setNewKeyData({ name: result.name, key: result.key });
      onKeyCreated?.(result.key);
      setKeyName('');
      setKeyMode('yolo');
      setIsCreating(false);
    } catch {
    }
  };

  const handleCopy = () => {
    if (newKeyData === null) return;
    copy(newKeyData.key);
  };

  const handleRevoke = (id: string) => {
    if (window.confirm(t('apiKeys.revokeConfirm'))) {
      void revokeMutation.mutateAsync(id);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center lg:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-hairline bg-card shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
            <KeyIcon />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold tracking-tight text-ink">{t('apiKeys.title')}</h2>
              <span className="text-sm font-medium text-faint">({keys.length})</span>
            </div>
            <p className="text-sm leading-5 text-muted-text">{t('apiKeys.subtitle')}</p>
          </div>
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            data-testid="generate-api-key-btn"
            onClick={() => {
              setIsCreating(true);
              setNewKeyData(null);
            }}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-soft"
          >
            {t('apiKeys.generateButton')}
          </Button>
        </div>
      </div>

      <div className="p-4 pt-0 lg:p-6 lg:pt-0">
        {newKeyData ? (
          <div
            data-testid="api-key-created-banner"
            className="mb-6 rounded-xl border border-success/30 bg-success-soft p-4 text-success"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-success">{t('apiKeys.createSuccess')}</span>
              <span className="text-xs font-semibold text-success">({newKeyData.name})</span>
            </div>
            <p className="mb-3 text-xs text-success">{t('apiKeys.warningCopyOnce')}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                data-testid="raw-api-key-value"
                value={newKeyData.key}
                className="w-full rounded-lg border border-success/30 bg-card px-3 py-2 font-mono text-sm text-ink select-all"
              />
              <Button
                type="button"
                data-testid="copy-api-key-btn"
                onClick={handleCopy}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {copied ? t('apiKeys.copied') : t('apiKeys.copyKey')}
              </Button>
            </div>
          </div>
        ) : null}

        {isCreating ? (
          <form
            onSubmit={handleCreate}
            data-testid="create-api-key-form"
            className="mb-6 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
          >
            <label htmlFor="api-key-name-input" className="block text-xs font-medium text-ink-soft">
              {t('apiKeys.nameLabel')}
            </label>
            <fieldset>
              <legend className="block text-xs font-medium text-ink-soft">{t('apiKeys.modeLabel')}</legend>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                {(['yolo', 'approval'] as const).map((mode) => (
                  <label
                    key={mode}
                    className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-3 py-2"
                  >
                    <input
                      type="radio"
                      name="api-key-mode"
                      data-testid={`api-key-mode-${mode}`}
                      value={mode}
                      checked={keyMode === mode}
                      onChange={() => setKeyMode(mode)}
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="api-key-name-input"
                type="text"
                data-testid="api-key-name-input"
                placeholder={t('apiKeys.namePlaceholder')}
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-muted-text focus:outline-none"
              />
              <div className="flex shrink-0 gap-2">
                <Button
                  type="submit"
                  data-testid="submit-create-key-btn"
                  disabled={!canSubmit}
                  className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink disabled:opacity-50"
                >
                  {createMutation.isPending ? <SpinnerIcon /> : t('apiKeys.create')}
                </Button>
                <Button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-sunken"
                >
                  {t('apiKeys.cancel')}
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {query.isLoading ? (
          <div className="flex justify-center py-6 text-faint">
            <SpinnerIcon />
          </div>
        ) : query.isError ? (
          <p className="py-4 text-sm text-destructive">{t('apiKeys.loadError')}</p>
        ) : keys.length === 0 ? (
          <div
            data-testid="api-keys-empty-state"
            className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-xl border border-hairline bg-card shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
              <KeyIcon />
            </span>
            <p className="mt-4 text-sm font-bold text-ink">{t('apiKeys.emptyTitle')}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-text">{t('apiKeys.emptyDesc')}</p>
            <Button
              type="button"
              data-testid="api-keys-empty-cta"
              onClick={() => {
                setIsCreating(true);
                setNewKeyData(null);
              }}
              className="mt-5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-soft"
            >
              {t('apiKeys.emptyCta')}
            </Button>
          </div>
        ) : (
          <>
            <table className="hidden w-full border-collapse sm:table" data-testid="api-keys-table">
              <thead>
                <tr className="border-b border-hairline text-left text-xs font-semibold text-muted-text">
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colName')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colMode')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colLastUsed')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colStatus')}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t('apiKeys.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleKeys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt);
                  return (
                    <tr key={key.id} data-testid={`api-key-row-${key.id}`} className="text-sm">
                      <td className="px-4 py-3.5">
                        <span className="block font-semibold text-ink">{key.name}</span>
                        <span className="mt-0.5 block font-mono text-xs text-faint">{key.keyPrefix}</span>
                      </td>
                      <td className="px-4 py-3.5 text-muted-text">
                        {key.approvalMode === 'approval' ? t('apiKeys.modeApproval') : t('apiKeys.modeYolo')}
                      </td>
                      <td className="px-4 py-3.5 text-muted-text">
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleDateString()
                          : t('apiKeys.neverUsed')}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isRevoked ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success'
                          }`}
                        >
                          <span className={`size-1.5 rounded-full ${isRevoked ? 'bg-red-500' : 'bg-emerald-500'}`} />
                          {isRevoked ? t('apiKeys.revoked') : t('apiKeys.active')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {!isRevoked ? (
                          <Button
                            type="button"
                            data-testid={`revoke-key-btn-${key.id}`}
                            onClick={() => handleRevoke(key.id)}
                            disabled={revokeMutation.isPending}
                            className="rounded-lg border border-destructive/30 bg-card px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive-soft"
                          >
                            {t('apiKeys.revoke')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="divide-y divide-hairline rounded-xl border border-line sm:hidden">
              {visibleKeys.map((key) => {
                const isRevoked = Boolean(key.revokedAt);
                return (
                  <div
                    key={key.id}
                    className="flex items-start justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-ink">{key.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                            isRevoked ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success'
                          }`}
                        >
                          {isRevoked ? t('apiKeys.revoked') : t('apiKeys.active')}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-text">
                        <span className="font-mono">{key.keyPrefix}</span>
                        <span>{key.approvalMode === 'approval' ? t('apiKeys.modeApproval') : t('apiKeys.modeYolo')}</span>
                        <span>
                          {key.lastUsedAt
                            ? t('apiKeys.lastUsed').replace('{date}', new Date(key.lastUsedAt).toLocaleDateString())
                            : t('apiKeys.neverUsed')}
                        </span>
                      </div>
                    </div>

                    {!isRevoked ? (
                      <Button
                        type="button"
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokeMutation.isPending}
                        className="shrink-0 rounded-lg border border-destructive/30 bg-card px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive-soft"
                      >
                        {t('apiKeys.revoke')}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {hasHiddenKeys ? (
              <Button
                type="button"
                data-testid="api-keys-show-all-toggle"
                onClick={() => setShowAllKeys((previous) => !previous)}
                variant="ghost"
                className="mt-3 rounded-lg px-2 py-1 text-sm font-semibold text-muted-text hover:text-ink"
              >
                {showAllKeys ? t('apiKeys.showFewer') : t('apiKeys.showAll').replace('{count}', String(keys.length))}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
