'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/provider';
import { SpinnerIcon } from '@/lib/ui';
import { cn } from '@/lib/utils';
import { fetchPrompt, promptFailureKey } from '@/lib/user-prompts-client';
import CopyPromptBlock from '../copy-prompt-block';

export const userPromptDetailKey = (slug: string) => ['user-prompts', 'detail', slug] as const;

export default function UserPromptDetail({ slug }: { slug: string }): React.ReactElement {
  const { t } = useI18n();
  const query = useQuery({ queryKey: userPromptDetailKey(slug), queryFn: () => fetchPrompt(slug), staleTime: 30_000 });

  const backLink = (
    <Link href="/recipes" className="text-sm text-muted-text hover:text-ink">
      ← {t('recipes.backToPrompts')}
    </Link>
  );

  if (query.isPending) {
    return (
      <div>
        {backLink}
        <p className="mt-10 flex items-center gap-2 text-sm text-muted-text" data-testid="user-prompt-detail-loading">
          <SpinnerIcon />
        </p>
      </div>
    );
  }

  const result = query.data;
  if (result === undefined || !result.success) {
    const message =
      result !== undefined && result.status === 404
        ? t('recipes.notFound')
        : t(result === undefined ? 'userPrompts.errorGeneric' : promptFailureKey(result));
    return (
      <div>
        <p role="alert" className="leading-relaxed text-ink-soft">
          {message}
        </p>
        <div className="mt-4">{backLink}</div>
      </div>
    );
  }

  const prompt = result.body.prompt;
  const isPublic = prompt.visibility === 'public';

  return (
    <div data-testid={`user-prompt-detail-${prompt.slug}`}>
      {backLink}
      <div className="mt-10 flex flex-wrap items-center gap-2">
        {prompt.source === 'community' ? (
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase',
              prompt.verified ? 'bg-success-soft text-success ring-1 ring-success/30' : 'bg-brand/10 text-brand',
            )}
          >
            {t(prompt.verified ? 'userPrompts.verifiedBadge' : 'userPrompts.communityBadge')}
          </span>
        ) : (
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-bold ring-1',
              isPublic ? 'bg-success-soft text-success ring-success/30' : 'bg-surface text-ink-soft ring-line',
            )}
          >
            {t(isPublic ? 'userPrompts.badgePublic' : 'userPrompts.badgePrivate')}
          </span>
        )}
        <span className="text-xs font-semibold text-muted-text">
          {t('userPrompts.versionLabel', { version: prompt.version })}
        </span>
      </div>
      <h1 className="mt-3 text-4xl font-black tracking-tight wrap-break-word text-ink sm:text-5xl">{prompt.title}</h1>
      <p className="mt-2 font-mono text-sm text-muted-text">{prompt.slug}</p>
      {prompt.description.length > 0 ? (
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft">{prompt.description}</p>
      ) : null}
      {prompt.source === 'community' && !prompt.verified ? (
        <p className="mt-4 max-w-2xl text-sm text-muted-text">{t('userPrompts.communityHint')}</p>
      ) : null}
      <CopyPromptBlock prompt={prompt.prompt} />
    </div>
  );
}
