'use client';

import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/provider';
import { formatVersionDate } from '@/lib/relative-time';
import { SpinnerIcon } from '@/lib/ui';
import { promptFailureKey } from '@/lib/user-prompts-client';
import { PromptVersionReadError, promptVersionQueryOptions } from '@/lib/use-user-prompts';
import type { PromptVersionSummary } from '@/lib/user-prompts-types';

const ACTION_CLASS =
  'rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50';

export interface PromptVersionRowProps {
  slug: string;
  entry: PromptVersionSummary;
  currentTitle: string;
  currentBody: string;
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onCompare: () => void;
}

export default function PromptVersionRow({
  slug,
  entry,
  currentTitle,
  currentBody,
  expanded,
  disabled,
  onToggle,
  onRestore,
  onCompare,
}: PromptVersionRowProps): React.ReactElement {
  const { t, locale } = useI18n();
  const full = useQuery({ ...promptVersionQueryOptions(slug, entry.version), enabled: expanded });
  const sameAsCurrent = entry.previewTruncated ? full.data?.version.body === currentBody : entry.preview === currentBody;
  const canRestore = !entry.current && !sameAsCurrent;

  let fullText: React.ReactNode = null;
  if (expanded) {
    if (full.isError) {
      fullText = (
        <p role="alert" data-testid={`prompt-version-full-error-${entry.version}`} className="mt-2 text-sm text-destructive">
          {t(full.error instanceof PromptVersionReadError ? promptFailureKey(full.error.failure) : 'userPrompts.errorGeneric')}
        </p>
      );
    } else if (full.data === undefined) {
      fullText = (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-text">
          <SpinnerIcon />
        </p>
      );
    } else {
      fullText = (
        <pre
          data-testid={`prompt-version-full-${entry.version}`}
          className="mt-2 max-h-96 overflow-auto rounded-xl bg-surface p-3 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap text-ink-soft"
        >
          {full.data.version.body}
        </pre>
      );
    }
  }

  return (
    <li data-testid={`prompt-version-${entry.version}`} className="rounded-2xl border border-hairline bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink">{t('userPrompts.versionLabel', { version: entry.version })}</span>
          {entry.current ? (
            <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-bold text-success ring-1 ring-success/30">
              {t('userPrompts.historyCurrent')}
            </span>
          ) : null}
          <span className="text-xs text-muted-text">{formatVersionDate(entry.createdAt, locale)}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid={`prompt-version-toggle-${entry.version}`}
            className={ACTION_CLASS}
            disabled={disabled}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {t(expanded ? 'userPrompts.historyHideFull' : 'userPrompts.historyViewFull')}
          </button>
          {entry.version > 1 ? (
            <button
              type="button"
              data-testid={`prompt-version-changes-${entry.version}`}
              className={ACTION_CLASS}
              disabled={disabled}
              onClick={onCompare}
            >
              {t('userPrompts.historyChanges')}
            </button>
          ) : null}
          {canRestore ? (
            <button
              type="button"
              data-testid={`prompt-version-restore-${entry.version}`}
              className={ACTION_CLASS}
              disabled={disabled}
              onClick={onRestore}
            >
              {t('userPrompts.restoreButton')}
            </button>
          ) : null}
        </div>
      </div>
      {entry.title !== currentTitle ? (
        <p className="mt-1 text-xs text-muted-text">{t('userPrompts.historyTitleThen', { title: entry.title })}</p>
      ) : null}
      {expanded ? (
        fullText
      ) : (
        <p className="mt-2 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-ink-soft">
          {entry.preview}
          {entry.previewTruncated ? '…' : ''}
        </p>
      )}
    </li>
  );
}
