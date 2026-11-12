'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import ApiKeysSection from '@/components/ui/api-keys-section';
import McpDocsSection from '@/components/ui/mcp-docs-section';
import { PROMPTS } from './prompts';
import { useSignedIn } from './viewer-context';
import PromptsHero from './components/prompts-hero';
import HubStep from './components/hub-step';
import SignInCta from './components/sign-in-cta';
import PromptCard from './components/prompt-card';
import AddPromptLink from './components/add-prompt-link';

//---------------
// Prompts hub — the one place to start with the Post Engineer MCP
// server: a short why-MCP-first note, then three numbered steps:
// 1) your API key (the key manager when signed in, a sign-in call to
// action otherwise), 2) the setup prompt to paste into your agent (a
// key created in step 1 is filled into it; the key lives only in this
// page's state, never persisted), 3) the recipe prompts, each copyable
// from its card or readable on its detail page. Rendered inside the
// AppShell for signed-in users and the public frame otherwise (see
// layout.tsx). Route stays /recipes; the old /api-keys page redirects
// here (next.config.ts). To add a prompt, add one entry to PROMPTS in
// prompts.ts.
//---------------

export default function RecipesPage() {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-8 lg:gap-10">
      <PromptsHero title={t('recipes.title')} subtitle={t('recipes.subtitle')} />
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight text-ink">{t('recipes.whyMcpTitle')}</h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <li className="rounded-2xl border border-hairline bg-card p-5">
            <p className="text-base font-bold text-ink">{t('recipes.whyMcpRoutinesTitle')}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('recipes.whyMcpRoutinesBody')}</p>
          </li>
          <li className="rounded-2xl border border-hairline bg-card p-5">
            <p className="text-base font-bold text-ink">{t('recipes.whyMcpAutomationTitle')}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{t('recipes.whyMcpAutomationBody')}</p>
          </li>
        </ul>
      </section>
      <HubStep number={1} title={t('recipes.stepKeyTitle')} hint={t('recipes.stepKeyHint')}>
        {signedIn ? (
          <ApiKeysSection onKeyCreated={setCreatedKey} />
        ) : (
          <SignInCta label={t('recipes.signInCta')} hint={t('recipes.signInHint')} />
        )}
      </HubStep>
      <HubStep number={2} title={t('recipes.stepSetupTitle')} hint={t('recipes.stepSetupHint')}>
        <McpDocsSection apiKey={createdKey} />
      </HubStep>
      <HubStep number={3} title={t('recipes.stepRecipesTitle')} hint={t('recipes.stepRecipesHint')}>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {PROMPTS.map((prompt) => (
            <li key={prompt.slug}>
              <PromptCard prompt={prompt} />
            </li>
          ))}
        </ul>
        <AddPromptLink />
      </HubStep>
    </div>
  );
}
