export const HOOK_TITLE_MAX_WORDS = 7;
export const HOOK_TITLE_MAX_CHARS = 60;
export const HOOK_TITLE_SECONDS = 3;

export const HOOK_TITLE_CODES = {
  empty: 'HOOK_TITLE_EMPTY',
  tooManyWords: 'HOOK_TITLE_TOO_MANY_WORDS',
  tooLong: 'HOOK_TITLE_TOO_LONG',
  invalidChars: 'HOOK_TITLE_INVALID_CHARS',
} as const;

export type HookTitleCode = (typeof HOOK_TITLE_CODES)[keyof typeof HOOK_TITLE_CODES];

const CONTROL_CHARS = /\p{Cc}/u;

export function normalizeHookTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function checkHookTitle(value: string): HookTitleCode | null {
  if (CONTROL_CHARS.test(value)) return HOOK_TITLE_CODES.invalidChars;
  const text = normalizeHookTitle(value);
  if (text.length === 0) return HOOK_TITLE_CODES.empty;
  if ([...text].length > HOOK_TITLE_MAX_CHARS) return HOOK_TITLE_CODES.tooLong;
  if (text.split(' ').length > HOOK_TITLE_MAX_WORDS) return HOOK_TITLE_CODES.tooManyWords;
  return null;
}

const MESSAGES: Record<HookTitleCode, string> = {
  HOOK_TITLE_EMPTY: 'The hook title must not be empty or only spaces.',
  HOOK_TITLE_TOO_MANY_WORDS: `The hook title must have at most ${HOOK_TITLE_MAX_WORDS} words.`,
  HOOK_TITLE_TOO_LONG: `The hook title must have at most ${HOOK_TITLE_MAX_CHARS} characters.`,
  HOOK_TITLE_INVALID_CHARS: 'The hook title must not contain a newline or a control character.',
};

export function hookTitleMessage(code: HookTitleCode): string {
  return MESSAGES[code];
}

export function hookTitleIssueMessage(code: HookTitleCode): string {
  return `${code}: ${MESSAGES[code]}`;
}
