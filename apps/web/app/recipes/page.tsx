'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import ApiKeysSection from '@/components/ui/api-keys-section';
import McpDocsSection from '@/components/ui/mcp-docs-section';
import { useSignedIn } from './viewer-context';
import PromptsHero from './components/prompts-hero';
import HubStep from './components/hub-step';
import SignInCta from './components/sign-in-cta';
import PublicPromptsSection from './components/public-prompts-section';
import MyPromptsSection from './components/my-prompts-section';

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
        <PublicPromptsSection />
      </HubStep>
      {signedIn ? (
        <HubStep number={4} title={t('userPrompts.stepTitle')} hint={t('userPrompts.stepHint')}>
          <MyPromptsSection />
        </HubStep>
      ) : null}
    </div>
  );
}
