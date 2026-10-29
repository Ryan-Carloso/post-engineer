'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { ComposeIcon, GlobeIcon } from '@/lib/ui';
import type { PromptEntry } from '../prompts';

//---------------
// PromptCard — one grid card in the prompts hub: an icon tile
// (Globe for news from the world, Compose for a PR write-up
// turned into a script), a kind pill, the title, one objective
// line, and a footer with the step count and the link to the
// prompt's own detail page. The whole card is the link. The list
// never shows the full prompt and never links straight to GitHub.
//---------------

export default function PromptCard({ prompt }: { prompt: PromptEntry }) {
  const { t } = useI18n();
  const Icon = prompt.icon === 'globe' ? GlobeIcon : ComposeIcon;

  return (
    <Link
      href={`/recipes/${prompt.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-[#edf0f4] bg-white p-5 shadow-[0_8px_24px_rgba(20,32,51,0.04)] transition hover:-translate-y-0.5 hover:border-[#101728] hover:shadow-[0_12px_28px_rgba(20,32,51,0.08)] focus-visible:ring-2 focus-visible:ring-[#ff544c] focus-visible:outline-none sm:p-6"
    >
      <span className="flex items-center justify-between">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[#f7f8fa] text-[#101728] ring-1 ring-[#e3e8ef]">
          <Icon />
        </span>
        <span className="rounded-full bg-[#ff544c]/10 px-3 py-1 text-xs font-bold tracking-wider text-[#ff544c] uppercase">
          {t(prompt.kindKey)}
        </span>
      </span>
      <span className="mt-5 block text-xl font-bold tracking-tight text-[#101728]">
        {t(prompt.titleKey)}
      </span>
      <span className="mt-2 block flex-1 text-sm leading-relaxed text-[#414d63]">
        {t(prompt.objectiveKey)}
      </span>
      <span className="mt-6 flex items-center justify-between border-t border-[#e3e8ef] pt-4 text-sm">
        <span className="text-[#718096]">
          {t('recipes.stepCount', { count: prompt.stepKeys.length })}
        </span>
        <span className="font-semibold text-[#ff544c]">
          {t('recipes.openPrompt')}{' '}
          <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </span>
      </span>
    </Link>
  );
}
