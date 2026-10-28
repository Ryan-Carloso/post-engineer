'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

//---------------
// CopyPromptBlock — the detail page's signature element and its
// primary action: the full prompt in a dark panel, a big accent
// copy button, and the explanation around it (what copying does,
// where the prompt goes — the user's own agent — and what happens
// next). GitHub is not part of this flow and is not mentioned
// here; it appears only as a small link at the bottom of the
// detail page. Presentational: props + callback only, no fetch.
//---------------

export default function CopyPromptBlock({ prompt }: { prompt: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    // Outside a secure context navigator.clipboard has no writeText;
    // in that case keep the "Copy this prompt" label instead of
    // claiming a copy that never happened.
    if (typeof navigator.clipboard?.writeText !== 'function') {
      return;
    }
    navigator.clipboard
      .writeText(prompt)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        // Keep the "Copy this prompt" label — the copy did not happen,
        // so the user must not paste an empty clipboard into their agent.
      });
  };

  return (
    <section className="mt-12">
      <p className="leading-relaxed text-[#414d63]">{t('recipes.copyExplanation')}</p>
      <div className="mt-6 overflow-hidden rounded-xl bg-[#101728] shadow-[0_8px_24px_rgba(16,23,40,0.25)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <span className="text-xs font-semibold text-slate-300">
            {t('recipes.copyFullPrompt')}
          </span>
          <Button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-[#ff544c] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#ff544c]/90"
          >
            {copied ? t('recipes.copiedPrompt') : t('recipes.copyFullPrompt')}
          </Button>
        </div>
        <pre
          data-testid="full-prompt"
          className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-300 select-text"
        >
          {prompt}
        </pre>
      </div>
      <p className="mt-4 leading-relaxed text-[#414d63]">{t('recipes.copyNext')}</p>
    </section>
  );
}
