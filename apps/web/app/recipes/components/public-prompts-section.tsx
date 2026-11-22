'use client';

import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/lib/ui';
import { useCopyPrompt } from '@/lib/use-copy-prompt';
import { useUserPromptsQuery } from '@/lib/use-user-prompts';
import { promptFailureKey } from '@/lib/user-prompts-client';
import UserPromptRow from './user-prompt-row';

export default function PublicPromptsSection(): React.ReactElement {
  const { t } = useI18n();
  const query = useUserPromptsQuery();
  const { copiedSlug, loadingSlug, failure, copyPrompt } = useCopyPrompt();

  const listing = query.data !== undefined && query.data.success ? query.data.body.prompts : null;
  const publicPrompts = (listing ?? []).filter((prompt) => prompt.visibility === 'public');

  if (query.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-text" data-testid="public-prompts-loading">
        <SpinnerIcon />
      </p>
    );
  }

  if (listing === null) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="public-prompts-section">
      {failure === null ? null : (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t(promptFailureKey(failure))}
        </p>
      )}
      {publicPrompts.length === 0 ? (
        <p className="text-sm text-muted-text">{t('recipes.noPublicPrompts')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-text">{t('userPrompts.communityHint')}</p>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {publicPrompts.map((prompt) => (
              <UserPromptRow
                key={prompt.slug}
                prompt={prompt}
                busy={loadingSlug !== null}
                copied={copiedSlug === prompt.slug}
                onCopy={() => void copyPrompt(prompt.slug)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
