'use client';

import { useI18n } from '@/lib/i18n/provider';

//---------------
// Secondary call to action for the prompts hub: link out to the
// prompt_request issue template so users can submit a prompt of
// their own. Rendered once, below the card grid (and below the
// empty state), never inside it — cards themselves stay internal
// links to the detail pages.
//---------------

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
        className="inline-flex items-center self-start text-sm text-[#ff544c] underline decoration-dotted transition-colors hover:decoration-solid"
      >
        {t('recipes.addYourPrompt')}
      </a>
      <span className="text-xs text-[#101728]/60">
        {t('recipes.addYourPromptHint')}
      </span>
    </div>
  );
}
