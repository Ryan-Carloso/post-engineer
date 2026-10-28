'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import SiteFooter from '@/components/site-footer';

//---------------
// Recipes list — editorial list, not a generic card grid: a large
// accent number per recipe, a strong title, one objective line, then
// the action (doc link, or a copyable prompt panel). Solid colors
// only, from the existing palette: ink #101728, paper #f7f8fa,
// accent #ff544c. No gradients, no purple/blue AI slop.
// To add a recipe, add one entry to RECIPES below and its i18n
// title/objective keys in both locales. An entry is either a doc
// link (href) or a copy-ready prompt shown on the page (prompt);
// the GitHub PRs entry is prompt-only by design, so its prompt
// text is the deliverable and there is no doc link to invent.
// The prompt is English by design: generation language is en.
//---------------

const GITHUB_PRS_PROMPT = [
  'Turn this GitHub pull request into one persona video.',
  '',
  'PR to use (paste the PR title, description, and a short change summary, plus any linked issues):',
  '- Title: ...',
  '- Description: ...',
  '- What changed: ...',
  '- Linked issues: ...',
  '',
  'Rules:',
  '- Use the Post Engineer MCP server and the singular video tool, generate_persona_video.',
  '- First, call validate_script with your script and only proceed when it is valid — validate before any token is debited.',
  '- Script: spoken text only, no links, hashtags, markdown, emojis, or stage directions.',
  '- Structure: first segment is the hook, last segment is the CTA, exactly one of each.',
  '- Length: 60–200 words total, hook 20–30 words (8–12 seconds), body at least 30 words, CTA 5–20 words, at most 12 segments.',
  '- Language: en only.',
  '- Media: at most 6, only if they match the PR (screenshots, diagrams, or repo visuals); otherwise generate without media.',
  '- Then generate one video for this PR and publish it where the user asked, scheduled or asap.',
  '- Never invent PR details: if the title, description, or change summary is missing, ask for it instead of guessing.',
].join('\n');

const RECIPES = [
  {
    titleKey: 'recipes.dailyNewsTitle',
    objectiveKey: 'recipes.dailyNewsObjective',
    href: 'https://github.com/Ryan-Carloso/post-engineer/blob/main/docs/recipes/daily-news.md',
    prompt: null,
  },
  {
    titleKey: 'recipes.githubPrsTitle',
    objectiveKey: 'recipes.githubPrsObjective',
    href: null,
    prompt: GITHUB_PRS_PROMPT,
  },
] as const;

export default function RecipesPage() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = () => {
    void navigator.clipboard.writeText(GITHUB_PRS_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

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
        <ol className="mt-12 divide-y divide-[#e3e8ef] border-y border-[#e3e8ef]">
          {RECIPES.map((recipe, index) => (
            <li key={recipe.titleKey} className="flex gap-5 py-8 sm:gap-8 sm:py-10">
              <span
                aria-hidden="true"
                className="w-10 shrink-0 text-3xl font-black text-[#ff544c] sm:text-4xl"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-bold tracking-tight text-[#101728]">
                  {t(recipe.titleKey)}
                </h2>
                <p className="mt-2 leading-relaxed text-[#414d63]">
                  {t(recipe.objectiveKey)}
                </p>
                {recipe.href ? (
                  <a
                    href={recipe.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-block font-medium text-[#ff544c] hover:underline"
                  >
                    {t('recipes.viewRecipe')} →
                  </a>
                ) : null}
                {recipe.prompt ? (
                  <div className="mt-6 overflow-hidden rounded-xl bg-[#101728] shadow-[0_8px_24px_rgba(16,23,40,0.25)]">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                      <span className="text-xs font-semibold text-slate-300">
                        {t('recipes.githubPrsTitle')}
                      </span>
                      <Button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
                      >
                        {copied ? t('recipes.copiedPrompt') : t('recipes.copyPrompt')}
                      </Button>
                    </div>
                    <pre
                      data-testid="github-prs-prompt"
                      className="max-h-96 overflow-auto p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-slate-300 select-text"
                    >
                      {recipe.prompt}
                    </pre>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
}
