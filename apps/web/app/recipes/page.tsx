'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import SiteFooter from '@/components/site-footer';
import { PROMPTS } from './prompts';
import PromptCard from './prompt-card';

//---------------
// Prompts hub list — editorial list, not a generic card grid: an
// icon tile, a kind label per entry (recipe vs prompt, which is
// true about the content — this list is not a sequence, so no
// 01/02 numbering), a strong title, one objective line, then a
// link to the entry's detail page. The full prompt lives on the
// detail page, not here, and the list never links straight to
// GitHub. Route stays /recipes; only the display name changed
// to "Get your prompts" (via i18n), so existing links and the
// public middleware path keep working. Solid colors only, from
// the existing palette: ink #101728, paper #f7f8fa, accent
// #ff544c. No gradients, no purple/blue AI slop. Type: black-
// weight display, regular body, mono for the prompt data on the
// detail page — no new font family, the repo loads none. To add
// a prompt, add one entry to PROMPTS in prompts.ts.
//---------------

export default function RecipesPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-16 sm:py-20">
        <Link href="/" className="text-sm text-[#718096] hover:text-[#101728]">
          ← Post Engineer
        </Link>
        <p className="mt-10 text-xs font-bold tracking-[0.2em] text-[#ff544c] uppercase">
          Post Engineer MCP
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-[#101728] sm:text-5xl">
          {t('recipes.title')}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#414d63]">
          {t('recipes.subtitle')}
        </p>
        <div className="mt-12 divide-y divide-[#e3e8ef] border-y border-[#e3e8ef]">
          {PROMPTS.map((prompt) => (
            <PromptCard key={prompt.slug} prompt={prompt} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
