'use client';

import { useI18n } from '@/lib/i18n/provider';

export const ADD_PROMPT_URL =
  'https://github.com/Ryan-Carloso/post-engineer/issues/new?template=prompt_request.md';

export default function AddPromptLink() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-0.5">
      <a
        href={ADD_PROMPT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center self-start text-sm text-brand underline decoration-dotted transition-colors hover:decoration-solid"
      >
        {t('recipes.addYourPrompt')}
      </a>
      <span className="text-xs text-ink/60">
        {t('recipes.addYourPromptHint')}
      </span>
    </div>
  );
}
