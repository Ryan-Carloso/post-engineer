'use client';

import { useState } from 'react';
import { useCopyText } from '@/lib/use-copy-text';
import { fetchPrompt, type PromptCallFailure } from '@/lib/user-prompts-client';

export interface CopyPromptState {
  copiedSlug: string | null;
  loadingSlug: string | null;
  failure: PromptCallFailure | null;
  copyPrompt: (slug: string) => Promise<void>;
}

export function useCopyPrompt(): CopyPromptState {
  const { copied, copy } = useCopyText();
  const [lastCopied, setLastCopied] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [failure, setFailure] = useState<PromptCallFailure | null>(null);

  const copyPrompt = async (slug: string): Promise<void> => {
    setFailure(null);
    setLoadingSlug(slug);
    const result = await fetchPrompt(slug);
    setLoadingSlug(null);
    if (!result.success) {
      setFailure(result);
      return;
    }
    copy(result.body.prompt.prompt);
    setLastCopied(slug);
  };

  return { copiedSlug: copied ? lastCopied : null, loadingSlug, failure, copyPrompt };
}
