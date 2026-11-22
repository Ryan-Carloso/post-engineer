'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PromptSummary } from '@/lib/user-prompts-types';

const ACTION_CLASS =
  'rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:opacity-50';

export interface UserPromptRowProps {
  prompt: PromptSummary;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onToggleVisibility?: () => void;
  onDelete?: () => void;
}

export default function UserPromptRow({
  prompt,
  busy,
  copied,
  onCopy,
  onEdit,
  onToggleVisibility,
  onDelete,
}: UserPromptRowProps): React.ReactElement {
  const { t } = useI18n();
  const isPublic = prompt.visibility === 'public';

  return (
    <li
      data-testid={`user-prompt-${prompt.slug}`}
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold tracking-tight text-ink">
            <Link
              href={`/recipes/${encodeURIComponent(prompt.slug)}`}
              data-testid={`user-prompt-link-${prompt.slug}`}
              className="hover:text-brand hover:underline"
            >
              {prompt.title}
            </Link>
          </h3>
          <p className="font-mono text-xs text-muted-text">{prompt.slug}</p>
        </div>
        {prompt.source === 'community' ? (
          <span
            data-testid={`user-prompt-source-${prompt.slug}`}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase',
              prompt.verified ? 'bg-success-soft text-success ring-1 ring-success/30' : 'bg-brand/10 text-brand',
            )}
          >
            {t(prompt.verified ? 'userPrompts.verifiedBadge' : 'userPrompts.communityBadge')}
          </span>
        ) : (
          <span
            data-testid={`user-prompt-visibility-${prompt.slug}`}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold ring-1',
              isPublic ? 'bg-success-soft text-success ring-success/30' : 'bg-surface text-ink-soft ring-line',
            )}
          >
            {t(isPublic ? 'userPrompts.badgePublic' : 'userPrompts.badgePrivate')}
          </span>
        )}
      </div>
      {prompt.description.length > 0 ? <p className="text-sm leading-relaxed text-ink-soft">{prompt.description}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onCopy} disabled={busy} className={ACTION_CLASS}>
          {copied ? t('userPrompts.copied') : t('userPrompts.copy')}
        </Button>
        {onEdit === undefined ? null : (
          <Button type="button" onClick={onEdit} disabled={busy} className={ACTION_CLASS}>
            {t('userPrompts.edit')}
          </Button>
        )}
        {onToggleVisibility === undefined ? null : (
          <Button type="button" onClick={onToggleVisibility} disabled={busy} className={ACTION_CLASS}>
            {t(isPublic ? 'userPrompts.makePrivate' : 'userPrompts.makePublic')}
          </Button>
        )}
        {onDelete === undefined ? null : (
          <Button type="button" onClick={onDelete} disabled={busy} className={cn(ACTION_CLASS, 'text-destructive')}>
            {t('userPrompts.delete')}
          </Button>
        )}
      </div>
    </li>
  );
}
