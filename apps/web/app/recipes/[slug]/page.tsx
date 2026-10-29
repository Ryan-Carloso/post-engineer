'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n/provider';
import { getPrompt } from '../prompts';
import PromptDetail from '../prompt-detail';

//---------------
// Prompt detail route (/recipes/[slug]) — resolves the slug
// against the prompts hub data and renders the same PromptDetail
// component for every prompt. An unknown slug renders a plain
// not-found line with a link back, never a raw error. The route
// stays under /recipes, which the middleware already treats as
// public, so no middleware change is needed.
//---------------

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
          <p className="leading-relaxed text-[#414d63]">{t('recipes.notFound')}</p>
          <Link
            href="/recipes"
            className="mt-4 inline-block font-medium text-[#ff544c] hover:underline"
          >
            ← {t('recipes.backToPrompts')}
          </Link>
        </div>
      )}
    </div>
  );
}
