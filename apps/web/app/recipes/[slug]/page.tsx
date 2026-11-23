'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { USER_PROMPT_SLUG_PATTERN } from '@/lib/contracts/prompts';
import UserPromptDetail from '../components/user-prompt-detail';

export default function PromptDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';

  return (
    <div className="mx-auto w-full max-w-4xl">
      {USER_PROMPT_SLUG_PATTERN.test(slug) ? (
        <UserPromptDetail slug={slug} />
      ) : (
        <div>
          <p className="leading-relaxed text-ink-soft">{t('recipes.notFound')}</p>
          <Link
            href="/recipes"
            className="mt-4 inline-block font-medium text-brand hover:underline"
          >
            ← {t('recipes.backToPrompts')}
          </Link>
        </div>
      )}
    </div>
  );
}
