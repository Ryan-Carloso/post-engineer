'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApiKeysQuery, useCreateApiKeyMutation, usePersonasQuery, useRevokeApiKeyMutation } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { KeyIcon, SpinnerIcon } from '@/lib/ui';

export default function ApiKeysSection(): ReactNode {
  const { t } = useI18n();
  const query = useApiKeysQuery();
  const createMutation = useCreateApiKeyMutation();
  const revokeMutation = useRevokeApiKeyMutation();

  const [isCreating, setIsCreating] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [scopeMode, setScopeMode] = useState<'all' | 'specific'>('all');
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [newKeyData, setNewKeyData] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const keys = query.data ?? [];
  const personasQuery = usePersonasQuery();
  const personas = personasQuery.data ?? [];
  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

  const canSubmit =
    keyName.trim().length > 0 &&
    (scopeMode === 'all' || selectedPersonaIds.length > 0) &&
    !createMutation.isPending;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      const result = await createMutation.mutateAsync({
        name: keyName.trim(),
        personaIds: scopeMode === 'specific' ? selectedPersonaIds : null,
      });
      setNewKeyData({ name: result.name, key: result.key });
      setKeyName('');
      setScopeMode('all');
      setSelectedPersonaIds([]);
      setIsCreating(false);
    } catch {
      // Error handled by mutation
    }
  };

  const togglePersona = (personaId: string) => {
    setSelectedPersonaIds((previous) =>
      previous.includes(personaId)
        ? previous.filter((id) => id !== personaId)
        : [...previous, personaId],
    );
  };

  const scopeBadgeText = (personaIds: string[] | null): string =>
    personaIds === null
      ? t('apiKeys.scopeAllBadge')
      : t('apiKeys.scopeCount').replace('{count}', String(personaIds.length));

  const scopeBadgeTitle = (personaIds: string[] | null): string | undefined => {
    if (personaIds === null) return undefined;
    const names = personaIds.map((id) => personaNames.get(id) ?? id);
    return names.join(', ');
  };

  const handleCopy = () => {
    if (!newKeyData?.key) return;
    void navigator.clipboard.writeText(newKeyData.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRevoke = (id: string) => {
    if (window.confirm(t('apiKeys.revokeConfirm'))) {
      void revokeMutation.mutateAsync(id);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dfe5ec] bg-white shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center lg:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[#edf0f4] bg-white shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
            <KeyIcon />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold tracking-tight text-[#101728]">{t('apiKeys.title')}</h2>
              <span className="text-sm font-medium text-[#8a94a8]">({keys.length})</span>
            </div>
            <p className="text-sm leading-5 text-[#718096]">{t('apiKeys.subtitle')}</p>
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
            className="rounded-xl bg-[#101728] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1e293b]"
          >
            {t('apiKeys.generateButton')}
          </Button>
        </div>
      </div>

      <div className="p-4 pt-0 lg:p-6 lg:pt-0">
        {newKeyData ? (
          <div
            data-testid="api-key-created-banner"
            className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-emerald-800">{t('apiKeys.createSuccess')}</span>
              <span className="text-xs font-semibold text-emerald-600">({newKeyData.name})</span>
            </div>
            <p className="mb-3 text-xs text-emerald-700">{t('apiKeys.warningCopyOnce')}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                data-testid="raw-api-key-value"
                value={newKeyData.key}
                className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 select-all"
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
            className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="api-key-name-input" className="mb-1 block text-xs font-medium text-slate-700">
                  {t('apiKeys.nameLabel')}
                </label>
                <input
                  id="api-key-name-input"
                  type="text"
                  data-testid="api-key-name-input"
                  placeholder={t('apiKeys.namePlaceholder')}
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  data-testid="submit-create-key-btn"
                  disabled={!canSubmit}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {createMutation.isPending ? <SpinnerIcon /> : t('apiKeys.create')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setScopeMode('all');
                    setSelectedPersonaIds([]);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {t('apiKeys.cancel')}
                </Button>
              </div>
            </div>

            <fieldset>
              <legend className="mb-2 block text-xs font-medium text-slate-700">
                {t('apiKeys.scopeLabel')}
              </legend>
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="api-key-scope"
                    data-testid="api-key-scope-all"
                    checked={scopeMode === 'all'}
                    onChange={() => setScopeMode('all')}
                    className="size-4 accent-slate-900"
                  />
                  {t('apiKeys.scopeAll')}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="api-key-scope"
                    data-testid="api-key-scope-specific"
                    checked={scopeMode === 'specific'}
                    onChange={() => setScopeMode('specific')}
                    className="size-4 accent-slate-900"
                  />
                  {t('apiKeys.scopeSpecific')}
                </label>
              </div>

              {scopeMode === 'specific' ? (
                <div className="mt-3">
                  {personasQuery.isError ? (
                    <p className="text-xs text-red-500">{t('apiKeys.scopePersonasError')}</p>
                  ) : personas.length === 0 ? (
                    <div
                      data-testid="api-key-scope-empty"
                      className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center"
                    >
                      <p className="text-xs text-slate-500">{t('apiKeys.scopeNoPersonas')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {personas.map((persona) => (
                        <label
                          key={persona.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:border-slate-300"
                        >
                          <input
                            type="checkbox"
                            data-testid={`api-key-persona-${persona.id}`}
                            checked={selectedPersonaIds.includes(persona.id)}
                            onChange={() => togglePersona(persona.id)}
                            className="size-4 accent-slate-900"
                          />
                          {persona.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </fieldset>
          </form>
        ) : null}

        {query.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400">
            <SpinnerIcon />
          </div>
        ) : query.isError ? (
          <p className="py-4 text-sm text-red-500">{t('apiKeys.loadError')}</p>
        ) : keys.length === 0 ? (
          <div
            data-testid="api-keys-empty-state"
            className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-xl border border-[#edf0f4] bg-white shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
              <KeyIcon />
            </span>
            <p className="mt-4 text-sm font-bold text-slate-900">{t('apiKeys.emptyTitle')}</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">{t('apiKeys.emptyDesc')}</p>
            <Button
              type="button"
              data-testid="api-keys-empty-cta"
              onClick={() => {
                setIsCreating(true);
                setNewKeyData(null);
              }}
              className="mt-5 rounded-xl bg-[#101728] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1e293b]"
            >
              {t('apiKeys.emptyCta')}
            </Button>
          </div>
        ) : (
          <>
            <table className="hidden w-full border-collapse sm:table" data-testid="api-keys-table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colName')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colKeyPreview')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colCreated')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colPermissions')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colLastUsed')}</th>
                  <th className="px-4 py-3 font-semibold">{t('apiKeys.colStatus')}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t('apiKeys.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt);
                  const created = new Date(key.createdAt);
                  return (
                    <tr key={key.id} data-testid={`api-key-row-${key.id}`} className="text-sm">
                      <td className="px-4 py-3.5">
                        <span className="block font-semibold text-slate-900">{key.name}</span>
                        <span className="mt-0.5 block font-mono text-xs text-slate-400">{key.keyPrefix}</span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                        <span className="rounded-md bg-slate-100 px-2 py-1">{key.keyPrefix}</span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        <span className="block">{created.toLocaleDateString()}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          data-testid={`api-key-scope-badge-${key.id}`}
                          title={scopeBadgeTitle(key.personaIds ?? null)}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                        >
                          {scopeBadgeText(key.personaIds ?? null)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleDateString()
                          : t('apiKeys.neverUsed')}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isRevoked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
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
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
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
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 sm:hidden">
              {keys.map((key) => {
                const isRevoked = Boolean(key.revokedAt);
                return (
                  <div
                    key={key.id}
                    className="flex flex-col justify-between gap-2 p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{key.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                            isRevoked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isRevoked ? t('apiKeys.revoked') : t('apiKeys.active')}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-xs text-slate-500">
                        <span>{key.keyPrefix}</span>
                        <span>•</span>
                        <span title={scopeBadgeTitle(key.personaIds ?? null)}>
                          {scopeBadgeText(key.personaIds ?? null)}
                        </span>
                        <span>•</span>
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
                        className="self-start rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        {t('apiKeys.revoke')}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
