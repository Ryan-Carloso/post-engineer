import type { PromptSource } from '@/lib/contracts/prompts';

export interface PromptListFilter {
  q?: string;
  source?: PromptSource;
}

interface Searchable {
  slug: string;
  title: string;
  description: string;
  source: PromptSource;
}

function searchTerms(q: string | undefined): string[] {
  if (q === undefined) return [];
  return q.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
}

export function filterPromptSummaries<Prompt extends Searchable>(prompts: Prompt[], filter: PromptListFilter): Prompt[] {
  const terms = searchTerms(filter.q);
  return prompts.filter((prompt) => {
    if (filter.source !== undefined && prompt.source !== filter.source) return false;
    const haystack = `${prompt.slug} ${prompt.title} ${prompt.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
