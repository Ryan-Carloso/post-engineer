import { describe, expect, it } from 'vitest';
import { filterPromptSummaries, searchOrClause, searchTerms } from '@/lib/prompt-search';

const PROMPTS = [
  { slug: 'daily-news', title: 'Daily News', description: 'Headlines of the day', source: 'official' as const },
  { slug: 'my-report', title: 'Weekly Report', description: 'For the team', source: 'own' as const },
  { slug: 'shared-report', title: 'Report', description: 'Shared by a user', source: 'community' as const },
];

describe('filterPromptSummaries', () => {
  it('returns every prompt when there is no filter', () => {
    expect(filterPromptSummaries(PROMPTS, {})).toEqual(PROMPTS);
    expect(filterPromptSummaries(PROMPTS, { q: '   ' })).toEqual(PROMPTS);
  });

  it('requires every search word to appear in the slug, title or description, ignoring case', () => {
    expect(filterPromptSummaries(PROMPTS, { q: 'REPORT team' }).map((prompt) => prompt.slug)).toEqual(['my-report']);
    expect(filterPromptSummaries(PROMPTS, { q: 'headlines' }).map((prompt) => prompt.slug)).toEqual(['daily-news']);
    expect(filterPromptSummaries(PROMPTS, { q: 'nothing-like-this' })).toEqual([]);
  });

  it('keeps only the requested source', () => {
    expect(filterPromptSummaries(PROMPTS, { source: 'community' }).map((prompt) => prompt.slug)).toEqual(['shared-report']);
  });

  it('combines the source with the search words', () => {
    expect(filterPromptSummaries(PROMPTS, { q: 'report', source: 'own' }).map((prompt) => prompt.slug)).toEqual(['my-report']);
    expect(filterPromptSummaries(PROMPTS, { q: 'news', source: 'own' })).toEqual([]);
  });

  it('splits the search text on anything that is not a letter, digit or hyphen, so database filters need no escaping', () => {
    expect(searchTerms('Weekly,report (v2) 50%_off')).toEqual(['weekly', 'report', 'v2', '50', 'off']);
    expect(searchTerms('café-news')).toEqual(['café-news']);
    expect(searchTerms(undefined)).toEqual([]);
  });

  it('builds one case-insensitive match over the slug, title and description', () => {
    expect(searchOrClause('news')).toBe('slug.ilike.%news%,title.ilike.%news%,description.ilike.%news%');
  });
});
