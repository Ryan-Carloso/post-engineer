'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiKeyItem } from '@/lib/api-keys-client';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import type { PickerPersona } from '@/components/ui/api-key-persona-picker';

const MAX_VISIBLE_KEYS = 4;

function KeyActions({
  apiKey,
  busy,
  onEdit,
  onRevoke,
  compact,
}: {
  apiKey: ApiKeyItem;
  busy: boolean;
  onEdit: (id: string) => void;
  onRevoke: (id: string) => void;
  compact: boolean;
}): ReactNode {
  const { t } = useI18n();
  if (apiKey.revokedAt) return null;
  const size = compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  return (
    <div className="flex shrink-0 justify-end gap-2">
      <Button
        type="button"
        data-testid={compact ? `edit-key-btn-mobile-${apiKey.id}` : `edit-key-btn-${apiKey.id}`}
        aria-label={t('apiKeys.editAria', { name: apiKey.name })}
        onClick={() => onEdit(apiKey.id)}
        disabled={busy}
        className={`h-auto rounded-lg border border-line bg-card font-semibold text-ink-soft hover:bg-sunken ${size}`}
      >
        {t('apiKeys.edit')}
      </Button>
      <Button
        type="button"
        data-testid={compact ? `revoke-key-btn-mobile-${apiKey.id}` : `revoke-key-btn-${apiKey.id}`}
        onClick={() => onRevoke(apiKey.id)}
        disabled={busy}
        className={`h-auto rounded-lg border border-destructive/30 bg-card font-semibold text-destructive hover:bg-destructive-soft ${size}`}
      >
        {t('apiKeys.revoke')}
      </Button>
    </div>
  );
}

export default function ApiKeysTable({
  keys,
  personas,
  busy,
  onEdit,
  onRevoke,
}: {
  keys: ApiKeyItem[];
  personas: PickerPersona[];
  busy: boolean;
  onEdit: (id: string) => void;
  onRevoke: (id: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const visibleKeys = showAll ? keys : keys.slice(0, MAX_VISIBLE_KEYS);
  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

  const modeLabel = (key: ApiKeyItem): string =>
    key.approvalMode === 'approval' ? t('apiKeys.modeApproval') : t('apiKeys.modeYolo');
  const scopeLabel = (key: ApiKeyItem): string => {
    if (key.personaIds === null) return t('apiKeys.scopeAll');
    const names = key.personaIds.flatMap((id) => personaNames.get(id) ?? []);
    return t('apiKeys.scopeSome', { count: key.personaIds.length, names: names.join(', ') });
  };
  const lastUsedLabel = (key: ApiKeyItem): string =>
    key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : t('apiKeys.neverUsed');
  const statusClass = (isRevoked: boolean): string =>
    isRevoked ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success';

  return (
    <>
      <table className="hidden w-full border-collapse sm:table" data-testid="api-keys-table">
        <thead>
          <tr className="border-b border-hairline text-left text-xs font-semibold text-muted-text">
            <th className="px-4 py-3 font-semibold">{t('apiKeys.colName')}</th>
            <th className="px-4 py-3 font-semibold">{t('apiKeys.colMode')}</th>
            <th className="px-4 py-3 font-semibold">{t('apiKeys.colPersonas')}</th>
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
                <td className="px-4 py-3.5 text-muted-text">{modeLabel(key)}</td>
                <td className="px-4 py-3.5 text-muted-text" data-testid={`api-key-scope-${key.id}`}>
                  {scopeLabel(key)}
                </td>
                <td className="px-4 py-3.5 text-muted-text">{lastUsedLabel(key)}</td>
                <td className="px-4 py-3.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(isRevoked)}`}
                  >
                    <span className={`size-1.5 rounded-full ${isRevoked ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    {isRevoked ? t('apiKeys.revoked') : t('apiKeys.active')}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <KeyActions apiKey={key} busy={busy} onEdit={onEdit} onRevoke={onRevoke} compact={false} />
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
            <div key={key.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-ink">{key.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${statusClass(isRevoked)}`}
                  >
                    {isRevoked ? t('apiKeys.revoked') : t('apiKeys.active')}
                  </span>
                </div>
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-text">
                  <span className="font-mono">{key.keyPrefix}</span>
                  <span>{modeLabel(key)}</span>
                  <span>{scopeLabel(key)}</span>
                  <span>
                    {key.lastUsedAt
                      ? t('apiKeys.lastUsed', { date: new Date(key.lastUsedAt).toLocaleDateString() })
                      : t('apiKeys.neverUsed')}
                  </span>
                </div>
              </div>
              <KeyActions apiKey={key} busy={busy} onEdit={onEdit} onRevoke={onRevoke} compact />
            </div>
          );
        })}
      </div>
      {keys.length > MAX_VISIBLE_KEYS ? (
        <Button
          type="button"
          data-testid="api-keys-show-all-toggle"
          onClick={() => setShowAll((previous) => !previous)}
          variant="ghost"
          className="mt-3 rounded-lg px-2 py-1 text-sm font-semibold text-muted-text hover:text-ink"
        >
          {showAll ? t('apiKeys.showFewer') : t('apiKeys.showAll', { count: keys.length })}
        </Button>
      ) : null}
    </>
  );
}
