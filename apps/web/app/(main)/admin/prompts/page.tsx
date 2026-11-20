'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/lib/ui';
import { useReviewPromptMutation, useReviewQueueQuery } from '@/lib/use-user-prompts';
import { promptFailureKey, type PromptReview } from '@/lib/user-prompts-client';
import PromptReviewCard from './prompt-review-card';

type Notice = { kind: 'done' } | { kind: 'stale' } | { kind: 'failed'; message: string };

export default function PromptReviewPage(): React.ReactElement {
  const { t } = useI18n();
  const query = useReviewQueueQuery();
  const mutation = useReviewPromptMutation();
  const [notice, setNotice] = useState<Notice | null>(null);

  const decide = async (id: string, review: PromptReview): Promise<void> => {
    setNotice(null);
    const result = await mutation.mutateAsync({ id, review });
    if (result.success) {
      setNotice({ kind: 'done' });
      return;
    }
    if (result.code === 'PROMPT_REVIEW_STALE') {
      setNotice({ kind: 'stale' });
      await query.refetch();
      return;
    }
    setNotice({ kind: 'failed', message: t(promptFailureKey(result)) });
  };

  const queue = query.data !== undefined && query.data.success ? query.data.body : null;
  const forbidden = query.data !== undefined && !query.data.success && query.data.status === 403;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t('userPrompts.reviewTitle')}</h1>
        <p className="mt-1 text-sm text-muted-text">{t('userPrompts.reviewSubtitle')}</p>
      </header>

      {notice === null ? null : (
        <p
          role={notice.kind === 'failed' ? 'alert' : 'status'}
          className={notice.kind === 'done' ? 'text-sm font-medium text-success' : 'text-sm font-medium text-destructive'}
        >
          {notice.kind === 'done'
            ? t('userPrompts.reviewDone')
            : notice.kind === 'stale'
              ? t('userPrompts.reviewStale')
              : notice.message}
        </p>
      )}

      {query.isPending ? (
        <SpinnerIcon />
      ) : forbidden ? (
        <p role="alert" className="text-sm text-destructive">
          {t('userPrompts.reviewForbidden')}
        </p>
      ) : queue === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">{t('userPrompts.loadError')}</p>
          <Button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:border-ink"
          >
            {t('userPrompts.retry')}
          </Button>
        </div>
      ) : (
        <>
          {queue.truncated ? <p className="text-sm text-muted-text">{t('userPrompts.reviewTruncated')}</p> : null}
          {queue.prompts.length === 0 ? (
            <p className="text-sm text-muted-text">{t('userPrompts.reviewEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {queue.prompts.map((entry) => (
                <PromptReviewCard
                  key={`${entry.id}:${entry.contentHash}`}
                  entry={entry}
                  pending={mutation.isPending}
                  onDecide={(review) => void decide(entry.id, review)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
