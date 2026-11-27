import { z } from 'zod';

export const FIRST_COMMENT_MAX_LENGTH = 1000;

export const FIRST_COMMENT_WARNING_CODES = [
  'FIRST_COMMENT_FAILED',
  'FIRST_COMMENT_RECONNECT_REQUIRED',
  'FIRST_COMMENT_UNSUPPORTED_CHAT',
  'FIRST_COMMENT_TOO_LONG',
] as const;
export type FirstCommentWarningCode = (typeof FIRST_COMMENT_WARNING_CODES)[number];

export function isFirstCommentWarningCode(value: unknown): value is FirstCommentWarningCode {
  return typeof value === 'string' && (FIRST_COMMENT_WARNING_CODES as readonly string[]).includes(value);
}

export const FirstCommentWarningSchema = z.object({
  provider: z.string(),
  accountId: z.string(),
  code: z.enum(FIRST_COMMENT_WARNING_CODES),
});

export const FIRST_COMMENT_FIELD = 'firstComment';

export type FirstCommentCheck = { ok: true; value: string | null } | { ok: false; error: string };

export function checkFirstComment(raw: unknown): FirstCommentCheck {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'firstComment must be a string.' };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed.length > FIRST_COMMENT_MAX_LENGTH) {
    return { ok: false, error: `firstComment must be at most ${FIRST_COMMENT_MAX_LENGTH} characters.` };
  }
  return { ok: true, value: trimmed };
}
