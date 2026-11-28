'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  usePersonasQuery,
  useRevokeApiKeyMutation,
  useUpdateApiKeyMutation,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import ApiKeyCreateForm, { type CreateKeyValues } from '@/components/ui/api-key-create-form';
import ApiKeyCreatedCard from '@/components/ui/api-key-created-card';
import ApiKeyEditForm from '@/components/ui/api-key-edit-form';
import ApiKeysTable from '@/components/ui/api-keys-table';
import { KeyIcon, SpinnerIcon } from '@/lib/ui';

export default function ApiKeysSection({ onKeyCreated }: { onKeyCreated?: () => void }): ReactNode {
  const { t } = useI18n();
  const query = useApiKeysQuery();
  const personasQuery = usePersonasQuery();
  const createMutation = useCreateApiKeyMutation();
  const revokeMutation = useRevokeApiKeyMutation();
  const updateMutation = useUpdateApiKeyMutation();

  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const keys = query.data ?? [];
  const personas = personasQuery.data ?? [];
  const editingKey = keys.find((key) => key.id === editingId && !key.revokedAt) ?? null;

  const handleCreate = (values: CreateKeyValues): void => {
    createMutation.mutate(values, {
      onSuccess: (result) => {
        setCreated({ name: result.name, key: result.key });
        onKeyCreated?.();
      },
    });
  };

  const handleRevoke = (id: string): void => {
    if (!window.confirm(t('apiKeys.revokeConfirm'))) return;
    if (editingId === id) setEditingId(null);
    revokeMutation.mutate(id);
  };

  const handleEdit = (id: string): void => {
    updateMutation.reset();
    setEditingId(id);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(16,23,40,0.02)]">
      <div className="flex min-w-0 items-center gap-3.5 p-4 lg:p-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-hairline bg-card shadow-[0_4px_12px_rgba(16,23,40,0.06)]">
          <KeyIcon />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink">{t('apiKeys.title')}</h2>
          <p className="text-sm leading-5 text-muted-text">{t('apiKeys.subtitle')}</p>
        </div>
      </div>

      <div className="p-4 pt-0 lg:p-6 lg:pt-0">
        {created ? (
          <ApiKeyCreatedCard
            name={created.name}
            secret={created.key}
            onCreateAnother={() => {
              createMutation.reset();
              setCreated(null);
            }}
          />
        ) : (
          <ApiKeyCreateForm
            personas={personas}
            personasLoadFailed={personasQuery.isError}
            pending={createMutation.isPending}
            failed={createMutation.isError}
            onSubmit={handleCreate}
          />
        )}

        <details data-testid="manage-keys" className="group mt-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-bold text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <span>
              {t('apiKeys.manageTitle')} <span className="font-medium text-faint">({keys.length})</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted-text transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>

          <div className="mt-4">
            {editingKey ? (
              <ApiKeyEditForm
                key={editingKey.id}
                apiKey={editingKey}
                personas={personas}
                personasLoadFailed={personasQuery.isError}
                pending={updateMutation.isPending}
                failed={updateMutation.isError}
                onSave={(values) =>
                  updateMutation.mutate(
                    { id: editingKey.id, ...values },
                    { onSuccess: () => setEditingId(null) },
                  )
                }
                onCancel={() => setEditingId(null)}
              />
            ) : null}
            {revokeMutation.isError ? (
              <p role="alert" data-testid="revoke-api-key-error" className="mb-3 text-sm text-destructive">
                {t('apiKeys.revokeError')}
              </p>
            ) : null}
            {query.isLoading ? (
              <div className="flex justify-center py-6 text-faint">
                <SpinnerIcon />
              </div>
            ) : query.isError ? (
              <p className="py-4 text-sm text-destructive">{t('apiKeys.loadError')}</p>
            ) : keys.length === 0 ? (
              <div data-testid="api-keys-empty-state" className="rounded-xl border border-dashed border-line px-6 py-8 text-center">
                <p className="text-sm font-bold text-ink">{t('apiKeys.emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-text">{t('apiKeys.emptyDesc')}</p>
              </div>
            ) : (
              <ApiKeysTable
                keys={keys}
                personas={personas}
                busy={revokeMutation.isPending || updateMutation.isPending}
                onEdit={handleEdit}
                onRevoke={handleRevoke}
              />
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
