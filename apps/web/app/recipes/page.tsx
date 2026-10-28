'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import SiteFooter from '@/components/site-footer';

//---------------
// Recipes list — initial version, intentionally minimal: title + one-line
// objective per recipe, each linking to its versioned recipe doc in the
// repo. The user will improve this page later; no search, filter,
// analytics, pagination, or admin here. To add a recipe, add one entry to
// RECIPES below and its i18n title/objective keys in both locales.
//---------------

const RECIPES = [
  {
    titleKey: 'recipes.dailyNewsTitle',
    objectiveKey: 'recipes.dailyNewsObjective',
    href: 'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
  },
] as const;

export default function RecipesPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">
        <Link href="/" className="text-sm text-[#718096] hover:text-[#101728]">
          ← Post Engineer
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#101728] sm:text-4xl">
          {t('recipes.title')}
        </h1>
        <p className="mt-2 text-sm text-[#8a94a8]">{t('recipes.subtitle')}</p>
        <ul className="mt-8 space-y-4">
          {RECIPES.map((recipe) => (
            <li
              key={recipe.href}
              className="rounded-3xl border border-[#edf0f4] bg-white p-6 shadow-sm sm:p-8"
            >
              <h2 className="text-xl font-bold tracking-tight text-[#101728]">
                {t(recipe.titleKey)}
              </h2>
              <p className="mt-2 leading-relaxed text-[#414d63]">
                {t(recipe.objectiveKey)}
              </p>
              <a
                href={recipe.href}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block font-medium text-[#ff544c] hover:underline"
              >
                {t('recipes.viewRecipe')} →
              </a>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
