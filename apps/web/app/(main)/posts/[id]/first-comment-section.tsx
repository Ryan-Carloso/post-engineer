'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FIRST_COMMENT_MAX_LENGTH, type FirstCommentWarningCode } from '@/lib/contracts/first-comment';
import { COMMENT_PROVIDERS } from '@/lib/contracts/providers';
import { useUpdateFirstCommentMutation } from '@/lib/api-first-comment';
import type { FirstCommentOutcomeWarning } from '@/lib/first-comment/outcome-warnings';
import { useI18n } from '@/lib/i18n/provider';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { providerLabel } from '@/lib/publish-user-notice';
import { INPUT_CLASS, SECTION_LABEL_CLASS } from '@/lib/ui';
import { cn } from '@/lib/utils';

const WARNING_KEYS: Record<
  FirstCommentWarningCode,
  'posts.commentWarningFailed' | 'posts.commentWarningReconnect' | 'posts.commentWarningUnsupportedChat' | 'posts.commentWarningTooLong'
> = {
  FIRST_COMMENT_FAILED: 'posts.commentWarningFailed',
  FIRST_COMMENT_RECONNECT_REQUIRED: 'posts.commentWarningReconnect',
  FIRST_COMMENT_UNSUPPORTED_CHAT: 'posts.commentWarningUnsupportedChat',
  FIRST_COMMENT_TOO_LONG: 'posts.commentWarningTooLong',
};

const FirstCommentWarnings = ({ warnings }: { warnings: readonly FirstCommentOutcomeWarning[] }) => {
  const { t } = useI18n();
  return (
    <>
      {warnings.map((warning) => (
        <p
          key={`${warning.provider}:${warning.accountId}:${warning.code}`}
          data-first-comment-warning={warning.code}
          className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-sm text-warning"
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t(WARNING_KEYS[warning.code], { provider: providerLabel(warning.provider) })}</span>
        </p>
      ))}
    </>
  );
};

export const FirstCommentSection = ({
  slotId,
  firstComment,
  warnings,
  canEdit,
}: {
  slotId: string;
  firstComment: string | null;
  warnings: readonly FirstCommentOutcomeWarning[];
  canEdit: boolean;
}) => {
  const { t } = useI18n();
  const update = useUpdateFirstCommentMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(firstComment ?? '');

  if (firstComment === null && !canEdit && warnings.length === 0) return null;

  const handleSave = (): void => {
    update.mutate(
      { slotId, firstComment: draft.trim() === '' ? null : draft.trim() },
      { onSuccess: () => setEditing(false) },
    );
  };

  const networks = COMMENT_PROVIDERS.map((provider) => PROVIDER_LABELS[provider]).join(', ');

  return (
    <section aria-label={t('posts.firstCommentLabel')} className="mt-6">
      <p className={cn(SECTION_LABEL_CLASS, 'tracking-wide')}>{t('posts.firstCommentLabel')}</p>
      {editing ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor="slot-first-comment">{t('posts.firstCommentLabel')}</label>
          <textarea
            id="slot-first-comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={FIRST_COMMENT_MAX_LENGTH}
            className={INPUT_CLASS}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('posts.firstCommentHint', { networks, max: FIRST_COMMENT_MAX_LENGTH })}
          </p>
          {update.isError && (
            <p className="mt-2 text-sm text-destructive" role="alert">{t('posts.firstCommentSaveError')}</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={update.isPending}>
              {t('posts.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setEditing(false); setDraft(firstComment ?? ''); }}
              disabled={update.isPending}
            >
              {t('posts.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 rounded-xl bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-primary">
            {firstComment ?? t('posts.firstCommentNone')}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => { setDraft(firstComment ?? ''); setEditing(true); }}
              className="mt-2 rounded-xl border border-input px-4 py-2 text-sm font-semibold text-primary hover:bg-background"
            >
              {t('posts.editFirstComment')}
            </button>
          )}
        </>
      )}
      <FirstCommentWarnings warnings={warnings} />
    </section>
  );
};
