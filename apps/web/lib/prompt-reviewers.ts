import 'server-only';

import { isScopedApiKey } from '@/lib/api-keys';
import { isUuid } from '@/lib/schedule-slot-id';

export const PROMPT_REVIEWERS_ENV = 'PROMPT_REVIEWER_USER_IDS';

export class PromptReviewerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptReviewerConfigError';
  }
}

export function parseReviewerIds(raw: string | undefined): string[] {
  if (raw === undefined) {
    throw new PromptReviewerConfigError(`${PROMPT_REVIEWERS_ENV} is not set`);
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const invalid = entries.filter((entry) => !isUuid(entry));
  if (invalid.length > 0) {
    throw new PromptReviewerConfigError(`${PROMPT_REVIEWERS_ENV} holds ${invalid.length} entry that is not a user id`);
  }
  return [...new Set(entries)];
}

export function readReviewerIds(): string[] {
  return parseReviewerIds(process.env[PROMPT_REVIEWERS_ENV]);
}

interface ReviewerCandidate {
  userId: string;
  isApiKey?: boolean;
  personaIds?: string[] | null;
}

export function isPromptReviewer(auth: ReviewerCandidate): boolean {
  if (isScopedApiKey(auth)) return false;
  return readReviewerIds().includes(auth.userId.toLowerCase());
}
