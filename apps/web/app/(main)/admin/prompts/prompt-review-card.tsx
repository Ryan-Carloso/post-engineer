'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { INPUT_CLASS, SECTION_LABEL_CLASS } from '@/lib/ui';
import { USER_PROMPT_LIMITS } from '@/lib/contracts/prompts';
import type { PromptReview } from '@/lib/user-prompts-client';

export interface PromptReviewEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  prompt: string;
  contentHash: string;
  authorId: string;
}

export interface PromptReviewCardProps {
  entry: PromptReviewEntry;
  pending: boolean;
  onDecide: (review: PromptReview) => void;
}

export default function PromptReviewCard({ entry, pending, onDecide }: PromptReviewCardProps): React.ReactElement {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const canReject = !pending && reason.trim().length > 0;

  return (
    <li
      data-testid={`prompt-review-${entry.slug}`}
      className="flex flex-col gap-3 rounded-2xl border border-hairline bg-card p-4 sm:p-5"
    >
      <div>
        <h2 className="text-lg font-bold tracking-tight text-ink">{entry.title}</h2>
        <p className="font-mono text-xs text-muted-text">{entry.slug}</p>
        <p className="mt-1 text-xs text-muted-text">{t('userPrompts.reviewAuthor', { author: entry.authorId })}</p>
      </div>
      {entry.description.length > 0 ? <p className="text-sm text-ink-soft">{entry.description}</p> : null}
      <pre
        data-testid={`prompt-review-text-${entry.slug}`}
        className="max-h-128 overflow-auto rounded-xl border border-line bg-surface p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink"
      >
        {entry.prompt}
      </pre>
      {rejecting ? (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className={SECTION_LABEL_CLASS}>{t('userPrompts.reviewReasonLabel')}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={USER_PROMPT_LIMITS.rejectionReason}
              rows={3}
              disabled={pending}
              autoFocus
              className={INPUT_CLASS}
            />
            <span className="mt-1 block text-xs text-muted-text">{t('userPrompts.reviewReasonHint')}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!canReject}
              onClick={() => onDecide({ decision: 'reject', contentHash: entry.contentHash, reason: reason.trim() })}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {t('userPrompts.reviewConfirmReject')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setRejecting(false);
                setReason('');
              }}
              className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:border-ink"
            >
              {t('userPrompts.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() => onDecide({ decision: 'approve', contentHash: entry.contentHash })}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {t('userPrompts.reviewApprove')}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:border-ink disabled:opacity-50"
          >
            {t('userPrompts.reviewReject')}
          </Button>
        </div>
      )}
    </li>
  );
}
