'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { getPrompt } from '../prompts';
import PromptDetail from '../prompt-detail';

export default function PromptDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const prompt = getPrompt(slug);

  return (
    <div className="mx-auto w-full max-w-4xl">
      {prompt ? (
        <PromptDetail prompt={prompt} />
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
