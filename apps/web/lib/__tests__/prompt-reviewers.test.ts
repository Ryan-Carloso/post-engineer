import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPromptReviewer, parseReviewerIds, PromptReviewerConfigError, readReviewerIds } from '@/lib/prompt-reviewers';

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseReviewerIds', () => {
  it('splits a comma list, trims, lowercases and removes duplicates', () => {
    expect(parseReviewerIds(` ${REVIEWER.toUpperCase()} , ${ALICE},${REVIEWER} `)).toEqual([REVIEWER, ALICE]);
  });

  it('accepts an empty string as "no reviewers" on purpose', () => {
    expect(parseReviewerIds('')).toEqual([]);
    expect(parseReviewerIds(' , ')).toEqual([]);
  });

  it('throws when the variable is not set instead of falling back to a default', () => {
    expect(() => parseReviewerIds(undefined)).toThrow(PromptReviewerConfigError);
  });

  it('throws when an entry is not a user id, without echoing the entry', () => {
    expect(() => parseReviewerIds(`${REVIEWER},not-a-uuid`)).toThrow(PromptReviewerConfigError);
    expect(() => parseReviewerIds('secret-looking-value')).not.toThrow(/secret-looking-value/);
  });
});

describe('isPromptReviewer', () => {
  it('is true for a listed user on a session', () => {
    vi.stubEnv('PROMPT_REVIEWER_USER_IDS', REVIEWER);
    expect(isPromptReviewer({ userId: REVIEWER })).toBe(true);
    expect(isPromptReviewer({ userId: REVIEWER.toUpperCase() })).toBe(true);
  });

  it('is false for a user who is not listed', () => {
    vi.stubEnv('PROMPT_REVIEWER_USER_IDS', REVIEWER);
    expect(isPromptReviewer({ userId: ALICE })).toBe(false);
  });

  it('is true for an unscoped API key and false for a persona-scoped one', () => {
    vi.stubEnv('PROMPT_REVIEWER_USER_IDS', REVIEWER);
    expect(isPromptReviewer({ userId: REVIEWER, isApiKey: true, personaIds: null })).toBe(true);
    expect(isPromptReviewer({ userId: REVIEWER, isApiKey: true, personaIds: [] })).toBe(false);
  });

  it('throws when the list is not configured', () => {
    vi.stubEnv('PROMPT_REVIEWER_USER_IDS', undefined);
    expect(() => isPromptReviewer({ userId: REVIEWER })).toThrow(PromptReviewerConfigError);
    expect(() => readReviewerIds()).toThrow(PromptReviewerConfigError);
  });
});
