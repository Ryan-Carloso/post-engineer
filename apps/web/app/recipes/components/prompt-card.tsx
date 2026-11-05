'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import { ComposeIcon, GlobeIcon } from '@/lib/ui';
import type { PromptEntry } from '../prompts';

//---------------
// PromptCard — one grid card in the prompts hub: an icon tile
// (Globe for news from the world, Compose for a PR write-up
// turned into a script), a kind pill, the title, one objective
// line, and a footer with two actions: copy the full prompt right
// here, or open the prompt's detail page to read it first. The
// card is an article, not one big link, because a button cannot
// live inside a link. The list never links straight to GitHub.
//---------------

export default function PromptCard({ prompt }: { prompt: PromptEntry }) {
  const { t } = useI18n();
  const { copied, copy } = useCopyText();
  const Icon = prompt.icon === 'globe' ? GlobeIcon : ComposeIcon;
  const href = `/recipes/${prompt.slug}`;

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-[#edf0f4] bg-white p-5 shadow-[0_8px_24px_rgba(20,32,51,0.04)] transition hover:border-[#101728] hover:shadow-[0_12px_28px_rgba(20,32,51,0.08)] sm:p-6">
      <span className="flex items-center justify-between">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[#f7f8fa] text-[#101728] ring-1 ring-[#e3e8ef]">
          <Icon />
        </span>
        <span className="rounded-full bg-[#ff544c]/10 px-3 py-1 text-xs font-bold tracking-wider text-[#ff544c] uppercase">
          {t(prompt.kindKey)}
        </span>
      </span>
      <h3 className="mt-5 text-xl font-bold tracking-tight text-[#101728]">
        <Link
          href={href}
          className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-[#ff544c] focus-visible:outline-none"
        >
          {t(prompt.titleKey)}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[#414d63]">
        {t(prompt.objectiveKey)}
      </p>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#e3e8ef] pt-4 text-sm">
        <Button
          type="button"
          data-testid={`copy-prompt-${prompt.slug}`}
          onClick={() => copy(prompt.prompt)}
          className="rounded-lg bg-[#ff544c] px-3.5 py-2 font-bold text-white transition-colors hover:bg-[#ff544c]/90"
        >
          {copied ? t('recipes.copiedPrompt') : t('recipes.copyPrompt')}
        </Button>
        <Link href={href} className="inline-flex items-center gap-1 font-semibold text-[#ff544c]">
          {t('recipes.openPrompt')}
          <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </article>
  );
}
