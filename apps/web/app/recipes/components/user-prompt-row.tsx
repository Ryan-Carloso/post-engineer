'use client';

import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/lib/i18n';
import type { PromptSummary } from '@/lib/user-prompts-types';

const STATUS_KEY: Record<NonNullable<PromptSummary['status']>, TranslationKey> = {
  private: 'userPrompts.statusPrivate',
  pending: 'userPrompts.statusPending',
  approved: 'userPrompts.statusApproved',
  rejected: 'userPrompts.statusRejected',
};

const STATUS_TONE: Record<NonNullable<PromptSummary['status']>, string> = {
  private: 'bg-surface text-ink-soft ring-line',
  pending: 'bg-warning-soft text-warning ring-warning/30',
  approved: 'bg-success-soft text-success ring-success/30',
  rejected: 'bg-destructive-soft text-destructive ring-destructive/30',
};

const ACTION_CLASS =
  'rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink disabled:opacity-50';

export interface UserPromptRowProps {
  prompt: PromptSummary;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onPublish?: () => void;
  onWithdraw?: () => void;
  onDelete?: () => void;
}

export default function UserPromptRow({
  prompt,
  busy,
  copied,
  onCopy,
  onEdit,
  onPublish,
  onWithdraw,
  onDelete,
}: UserPromptRowProps): React.ReactElement {
  const { t } = useI18n();
  const status = prompt.status;
  const canPublish = status === 'private' || status === 'rejected';
  const canWithdraw = status === 'pending' || status === 'approved';

  return (
    <li
      data-testid={`user-prompt-${prompt.slug}`}
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold tracking-tight text-ink">{prompt.title}</h3>
          <p className="font-mono text-xs text-muted-text">{prompt.slug}</p>
        </div>
        {status === null ? (
          <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold tracking-wider text-brand uppercase">
            {t('userPrompts.communityBadge')}
          </span>
        ) : (
          <span
            data-testid={`user-prompt-status-${prompt.slug}`}
            className={cn('rounded-full px-3 py-1 text-xs font-bold ring-1', STATUS_TONE[status])}
          >
            {t(STATUS_KEY[status])}
          </span>
        )}
      </div>
      {prompt.description.length > 0 ? <p className="text-sm leading-relaxed text-ink-soft">{prompt.description}</p> : null}
      {status === 'rejected' && prompt.rejectionReason !== null ? (
        <p className="text-sm text-destructive">{t('userPrompts.rejectionReason', { reason: prompt.rejectionReason })}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onCopy} disabled={busy} className={ACTION_CLASS}>
          {copied ? t('userPrompts.copied') : t('userPrompts.copy')}
        </Button>
        {onEdit === undefined ? null : (
          <Button type="button" onClick={onEdit} disabled={busy} className={ACTION_CLASS}>
            {t('userPrompts.edit')}
          </Button>
        )}
        {canPublish && onPublish !== undefined ? (
          <Button type="button" onClick={onPublish} disabled={busy} className={ACTION_CLASS}>
            {t('userPrompts.publish')}
          </Button>
        ) : null}
        {canWithdraw && onWithdraw !== undefined ? (
          <Button type="button" onClick={onWithdraw} disabled={busy} className={ACTION_CLASS}>
            {t('userPrompts.withdraw')}
          </Button>
        ) : null}
        {onDelete === undefined ? null : (
          <Button type="button" onClick={onDelete} disabled={busy} className={cn(ACTION_CLASS, 'text-destructive')}>
            {t('userPrompts.delete')}
          </Button>
        )}
      </div>
    </li>
  );
}
