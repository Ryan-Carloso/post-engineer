'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { useI18n } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n';
import { SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { fetchPromptVersion, fetchPromptVersions, promptFailureKey } from '@/lib/user-prompts-client';
import { USER_PROMPTS_KEY, useRestorePromptVersionMutation, userPromptVersionKey, userPromptVersionsKey } from '@/lib/use-user-prompts';
import type { PromptVersionSummary } from '@/lib/user-prompts-types';
import PromptVersionRow from './prompt-version-row';

interface Notice {
  tone: 'success' | 'info' | 'error';
  key: TranslationKey;
  vars?: Record<string, number>;
}

const NOTICE_CLASS: Record<Notice['tone'], string> = {
  success: 'bg-success-soft text-success',
  info: 'bg-warning-soft text-warning',
  error: 'bg-destructive-soft text-destructive',
};

export interface PromptVersionHistoryProps {
  slug: string;
  currentVersion: number;
  currentTitle: string;
  currentBody: string;
}

export default function PromptVersionHistory({
  slug,
  currentVersion,
  currentTitle,
  currentBody,
}: PromptVersionHistoryProps): React.ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const restore = useRestorePromptVersionMutation();
  const [target, setTarget] = useState<PromptVersionSummary | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checking, setChecking] = useState(false);

  const history = useInfiniteQuery({
    queryKey: userPromptVersionsKey(slug),
    queryFn: ({ pageParam }) => fetchPromptVersions(slug, pageParam === undefined ? {} : { before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.success && last.body.nextCursor !== null ? last.body.nextCursor : undefined),
    staleTime: 30_000,
  });

  const pages = history.data?.pages ?? [];
  const entries = pages.flatMap((page) => (page.success ? page.body.versions : []));
  const failedPage = pages.find((page) => !page.success);
  const busy = restore.isPending || history.isFetchingNextPage || checking;

  function toggle(version: number): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  function requestRestore(entry: PromptVersionSummary): void {
    setNotice(null);
    if (!entry.previewTruncated) {
      setTarget(entry);
      return;
    }
    setChecking(true);
    queryClient
      .fetchQuery({
        queryKey: userPromptVersionKey(slug, entry.version),
        queryFn: () => fetchPromptVersion(slug, entry.version),
        staleTime: 60_000,
      })
      .then((result) => {
        if (!result.success) {
          setNotice({ tone: 'error', key: promptFailureKey(result) });
        } else if (result.body.version.body === currentBody) {
          setNotice({ tone: 'info', key: 'userPrompts.restoreUnchanged' });
        } else {
          setTarget(entry);
        }
      })
      .catch(() => setNotice({ tone: 'error', key: 'userPrompts.errorGeneric' }))
      .finally(() => setChecking(false));
  }

  function confirmRestore(): void {
    if (target === null) return;
    restore
      .mutateAsync({ slug, version: target.version, expectedCurrentVersion: currentVersion })
      .then((result) => {
        setTarget(null);
        if (result.success) {
          setNotice(
            result.body.restored
              ? { tone: 'success', key: 'userPrompts.restoreDone', vars: { version: result.body.prompt.version } }
              : { tone: 'info', key: 'userPrompts.restoreUnchanged' },
          );
          return;
        }
        setNotice({ tone: 'error', key: promptFailureKey(result) });
        if (result.code === 'PROMPT_VERSION_CONFLICT') void queryClient.invalidateQueries({ queryKey: USER_PROMPTS_KEY });
      })
      .catch(() => {
        setTarget(null);
        setNotice({ tone: 'error', key: 'userPrompts.errorGeneric' });
      });
  }

  let body: React.ReactNode;
  if (history.isPending) {
    body = (
      <p className="mt-4 flex items-center gap-2 text-sm text-muted-text" data-testid="prompt-version-loading">
        <SpinnerIcon />
      </p>
    );
  } else if (failedPage !== undefined && entries.length === 0) {
    body = (
      <p role="alert" data-testid="prompt-version-error" className="mt-4 text-sm text-destructive">
        {t(failedPage.success ? 'userPrompts.errorGeneric' : promptFailureKey(failedPage))}
      </p>
    );
  } else {
    body = (
      <>
        {entries.every((entry) => entry.current) ? (
          <p className="mt-4 text-sm text-muted-text">{t('userPrompts.historyEmpty')}</p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-3">
          {entries.map((entry) => (
            <PromptVersionRow
              key={entry.versionId}
              slug={slug}
              entry={entry}
              currentTitle={currentTitle}
              currentBody={currentBody}
              expanded={expanded.has(entry.version)}
              disabled={busy}
              onToggle={() => toggle(entry.version)}
              onRestore={() => requestRestore(entry)}
            />
          ))}
        </ul>
        {failedPage !== undefined ? (
          <p role="alert" data-testid="prompt-version-error" className="mt-3 text-sm text-destructive">
            {t(failedPage.success ? 'userPrompts.errorGeneric' : promptFailureKey(failedPage))}
          </p>
        ) : null}
        {history.hasNextPage ? (
          <button
            type="button"
            data-testid="prompt-version-older"
            disabled={busy}
            className="mt-3 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              void history.fetchNextPage();
            }}
          >
            {t('userPrompts.historyShowOlder')}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section data-testid="prompt-version-history" className="mt-12">
      <h2 className="text-xl font-bold tracking-tight text-ink">{t('userPrompts.historyTitle')}</h2>
      {notice === null ? null : (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="prompt-version-notice"
          data-tone={notice.tone}
          className={cn('mt-3 rounded-xl px-3 py-2 text-sm', NOTICE_CLASS[notice.tone])}
        >
          {t(notice.key, notice.vars)}
        </p>
      )}
      {body}
      <ConfirmDialog
        open={target !== null}
        pending={restore.isPending}
        title={t('userPrompts.restoreDialogTitle', { version: target?.version ?? 0 })}
        body={t('userPrompts.restoreDialogBody', { next: currentVersion + 1 })}
        cancelLabel={t('userPrompts.restoreCancel')}
        confirmLabel={t('userPrompts.restoreConfirm')}
        onClose={() => setTarget(null)}
        onConfirm={confirmRestore}
      />
    </section>
  );
}
