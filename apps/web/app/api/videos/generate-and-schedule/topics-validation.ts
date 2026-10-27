// Topic validation for POST /api/videos/generate-and-schedule, extracted
// from route.ts so the route stays under the file-size ratchet while the
// segments contract is added. Runs before any token is charged.
import type { NextResponse } from 'next/server';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { MAX_POST_TOPICS } from '@/lib/schedule/slot-distribution';
import { MAX_TOPIC_CHARS, validationFailed } from './prepare-persona';

const MAX_TOPICS = MAX_POST_TOPICS;

export function validateTopics(rawTopics: string[]): string[] | NextResponse {
  if (rawTopics.length === 0) {
    return validationFailed(ERROR_CODES.TOPICS_REQUIRED, formatErrorMessage(ERROR_CODES.TOPICS_REQUIRED), 'topics');
  }
  if (rawTopics.length > MAX_TOPICS) {
    return validationFailed(
      ERROR_CODES.TOPICS_LIMIT_EXCEEDED,
      formatErrorMessage(ERROR_CODES.TOPICS_LIMIT_EXCEEDED),
      'topics',
    );
  }
  const topics = rawTopics.map((t) => t.trim());
  for (let i = 0; i < topics.length; i += 1) {
    if (topics[i].length === 0) {
      return validationFailed(ERROR_CODES.VALIDATION_FAILED, `Topic ${i + 1} is empty.`, `topics.${i}`);
    }
    if (topics[i].length > MAX_TOPIC_CHARS) {
      return validationFailed(
        ERROR_CODES.VALIDATION_FAILED,
        `Topic ${i + 1} must be at most ${MAX_TOPIC_CHARS} characters.`,
        `topics.${i}`,
      );
    }
  }
  return topics;
}
