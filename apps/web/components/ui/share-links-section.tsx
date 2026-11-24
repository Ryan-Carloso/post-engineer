'use client';

import { useState, type ReactNode } from 'react';
import { usePersonasQuery } from '@/lib/api';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import {
  useCreateShareLinkMutation,
  useRevokeShareLinkMutation,
  useShareLinksQuery,
  type ShareLinkFailure,
  type ShareLinkItem,
} from '@/lib/share-links-client';
import { SHARE_LINK_MAX_ACTIVE } from '@/lib/contracts/share-links';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { GlobeIcon, INPUT_CLASS, SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';

type LinkStatus = 'active' | 'revoked' | 'expired';

const STATUS_KEY: Record<LinkStatus, TranslationKey> = {
  active: 'shareLinks.statusActive',
  revoked: 'shareLinks.statusRevoked',
  expired: 'shareLinks.statusExpired',
};

const STATUS_STYLE: Record<LinkStatus, string> = {
  active: 'bg-success-soft text-success',
  revoked: 'bg-destructive-soft text-destructive',
  expired: 'bg-sunken text-muted-text',
};

const ALL_PERSONAS = '';

function statusOf(link: ShareLinkItem, now: number): LinkStatus {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now) return 'expired';
  return 'active';
}

function failureKey(failure: ShareLinkFailure, action: 'create' | 'revoke'): TranslationKey {
  if (failure === 'limit') return 'shareLinks.limitError';
  return action === 'create' ? 'shareLinks.createError' : 'shareLinks.revokeError';
}

export default function ShareLinksSection(): ReactNode {
  const { t, locale } = useI18n();
  const query = useShareLinksQuery();
  const personasQuery = usePersonasQuery();
  const createMutation = useCreateShareLinkMutation();
  const revokeMutation = useRevokeShareLinkMutation();
  const { copied, copy } = useCopyText();

  const [personaId, setPersonaId] = useState(ALL_PERSONAS);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ShareLinkItem | null>(null);

  const links = query.data ?? [];
  const personas = personasQuery.data ?? [];
  const now = Date.now();
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' });
  const busy = createMutation.isPending || revokeMutation.isPending;

  const handleCreate = async (): Promise<void> => {
    setErrorKey(null);
    setCreatedUrl(null);
    const result = await createMutation.mutateAsync(personaId === ALL_PERSONAS ? null : [personaId]);
    if (!result.success) {
      setErrorKey(failureKey(result.error, 'create'));
      return;
    }
    setCreatedUrl(`${window.location.origin}${result.value.path}`);
  };

  const handleRevoke = async (): Promise<void> => {
    if (revokeTarget === null) return;
    setErrorKey(null);
    const result = await revokeMutation.mutateAsync(revokeTarget.id);
    setRevokeTarget(null);
    if (!result.success) setErrorKey(failureKey(result.error, 'revoke'));
  };

  const scopeLabel = (link: ShareLinkItem): string =>
    link.personaIds === null
      ? t('shareLinks.scopeAll')
      : t('shareLinks.scopePersonas', { count: link.personaIds.length });

  return (
    <section
      data-testid="share-links-section"
      className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(16,23,40,0.02)]"
    >
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-hairline bg-card shadow-[0_4px_12px_rgba(16,23,40,0.06)] [&>svg]:size-5">
            <GlobeIcon />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-ink">{t('shareLinks.title')}</h2>
            <p className="text-sm leading-5 text-muted-text">{t('shareLinks.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="share-link-persona" className="block text-xs font-medium text-ink-soft">
              {t('shareLinks.personaLabel')}
            </label>
            <select
              id="share-link-persona"
              data-testid="share-link-persona"
              value={personaId}
              disabled={busy}
              onChange={(event) => setPersonaId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value={ALL_PERSONAS}>{t('shareLinks.personaAll')}</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            data-testid="create-share-link-btn"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-soft disabled:opacity-60"
          >
            {createMutation.isPending ? <SpinnerIcon /> : t('shareLinks.createButton')}
          </Button>
        </div>

        {errorKey !== null ? (
          <p role="alert" data-testid="share-links-error" className="text-sm text-destructive">
            {t(errorKey, { max: SHARE_LINK_MAX_ACTIVE })}
          </p>
        ) : null}

        {createdUrl !== null ? (
          <div
            data-testid="share-link-created-banner"
            className="rounded-xl border border-success/30 bg-success-soft p-4 text-success"
          >
            <p className="font-bold">{t('shareLinks.createdTitle')}</p>
            <p className="mt-1 mb-3 text-xs">{t('shareLinks.copyOnce')}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label={t('shareLinks.linkField')}
                data-testid="share-link-url"
                value={createdUrl}
                className="w-full min-w-0 rounded-lg border border-success/30 bg-card px-3 py-2 font-mono text-sm text-ink select-all"
              />
              <Button
                type="button"
                data-testid="copy-share-link-btn"
                onClick={() => copy(createdUrl)}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {copied ? t('shareLinks.copied') : t('shareLinks.copy')}
              </Button>
            </div>
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="flex justify-center py-4 text-faint">
            <SpinnerIcon />
          </div>
        ) : query.isError ? (
          <p className="text-sm text-destructive">{t('shareLinks.loadError')}</p>
        ) : links.length === 0 ? (
          <div
            data-testid="share-links-empty-state"
            className="rounded-xl border border-dashed border-line px-6 py-8 text-center"
          >
            <p className="text-sm font-bold text-ink">{t('shareLinks.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-text">{t('shareLinks.emptyDesc')}</p>
          </div>
        ) : (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-text">{t('shareLinks.listTitle')}</h3>
            <ul className="divide-y divide-hairline rounded-xl border border-line">
              {links.map((link) => {
                const status = statusOf(link, now);
                return (
                  <li
                    key={link.id}
                    data-testid={`share-link-row-${link.id}`}
                    className="flex items-start justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{scopeLabel(link)}</span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                            STATUS_STYLE[status],
                          )}
                        >
                          {t(STATUS_KEY[status])}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-text">
                        <span>{t('shareLinks.created', { date: formatDate(link.createdAt) })}</span>
                        <span>
                          {link.expiresAt === null
                            ? t('shareLinks.noExpiry')
                            : t('shareLinks.expires', { date: formatDate(link.expiresAt) })}
                        </span>
                        <span>
                          {link.lastViewedAt === null
                            ? t('shareLinks.neverViewed')
                            : t('shareLinks.lastViewed', { date: formatDate(link.lastViewedAt) })}
                        </span>
                      </div>
                    </div>
                    {status === 'active' ? (
                      <Button
                        type="button"
                        data-testid={`revoke-share-link-btn-${link.id}`}
                        disabled={busy}
                        onClick={() => setRevokeTarget(link)}
                        className="shrink-0 rounded-lg border border-destructive/30 bg-card px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive-soft"
                      >
                        {t('shareLinks.revoke')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <ConfirmDialog
        tone="destructive"
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
        detail={
          revokeTarget === null
            ? ''
            : `${scopeLabel(revokeTarget)} · ${t('shareLinks.created', { date: formatDate(revokeTarget.createdAt) })}`
        }
        title={t('shareLinks.revokeTitle')}
        body={t('shareLinks.revokeBody')}
        cancelLabel={t('shareLinks.cancel')}
        confirmLabel={t('shareLinks.revokeConfirm')}
        pending={revokeMutation.isPending}
      />
    </section>
  );
}
