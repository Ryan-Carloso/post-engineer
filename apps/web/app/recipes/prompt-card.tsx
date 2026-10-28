'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { ComposeIcon, GlobeIcon } from '@/lib/ui';
import type { PromptEntry } from './prompts';

//---------------
// PromptCard — one list entry in the prompts hub: an icon tile
// (Globe for news from the world, Compose for a PR write-up
// turned into a script), a kind label, the title, one objective
// line, and a link to the prompt's own detail page. The list
// never shows the full prompt and never links straight to
// GitHub; the detail page is where the prompt lives. Presentational.
//---------------

export default function PromptCard({ prompt }: { prompt: PromptEntry }) {
  const { t } = useI18n();
  const Icon = prompt.icon === 'globe' ? GlobeIcon : ComposeIcon;

  return (
    <Link
      href={`/recipes/${prompt.slug}`}
      className="flex items-start gap-4 py-8 sm:py-10"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-[#101728] ring-1 ring-[#e3e8ef]">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-xs font-bold tracking-[0.2em] text-[#ff544c] uppercase">
          {t(prompt.kindKey)}
        </span>
        <span className="mt-1 block text-2xl font-bold tracking-tight text-[#101728]">
          {t(prompt.titleKey)}
        </span>
        <span className="mt-2 block leading-relaxed text-[#414d63]">
          {t(prompt.objectiveKey)}
        </span>
        <span className="mt-4 inline-block font-medium text-[#ff544c]">
          {t('recipes.openPrompt')} →
        </span>
      </span>
    </Link>
  );
}
