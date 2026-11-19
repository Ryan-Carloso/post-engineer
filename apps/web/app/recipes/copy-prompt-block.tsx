'use client';

import { useI18n } from '@/lib/i18n/provider';
import { useCopyText } from '@/lib/use-copy-text';
import { Button } from '@/components/ui/button';
import AgentLogos from '@/components/ui/agent-logos';

export default function CopyPromptBlock({ prompt }: { prompt: string }) {
  const { t } = useI18n();
  const { copied, copy } = useCopyText();

  return (
    <section className="mt-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AgentLogos agents={['cursor', 'claude', 'opencode']} size="sm" />
        <p className="leading-relaxed text-ink-soft">{t('recipes.copyExplanation')}</p>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl bg-code shadow-[0_8px_24px_rgba(16,23,40,0.25)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <span className="text-xs font-semibold text-code-text">
            {t('recipes.copyFullPrompt')}
          </span>
          <Button
            type="button"
            onClick={() => copy(prompt)}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand/90"
          >
            {copied ? t('recipes.copiedPrompt') : t('recipes.copyFullPrompt')}
          </Button>
        </div>
        <pre
          data-testid="full-prompt"
          className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-code-text select-text"
        >
          {prompt}
        </pre>
      </div>
      <p className="mt-4 leading-relaxed text-ink-soft">{t('recipes.copyNext')}</p>
    </section>
  );
}
