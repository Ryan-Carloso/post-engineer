import { describe, expect, it } from 'vitest';
import {
  HOOK_TITLE_CODES,
  HOOK_TITLE_MAX_CHARS,
  HOOK_TITLE_MAX_WORDS,
  HOOK_TITLE_SECONDS,
  checkHookTitle,
  hookTitleIssueMessage,
  hookTitleMessage,
  normalizeHookTitle,
} from '../hook-title';

describe('hook title limits', () => {
  it('pins the shared literals', () => {
    expect(HOOK_TITLE_MAX_WORDS).toBe(7);
    expect(HOOK_TITLE_MAX_CHARS).toBe(60);
    expect(HOOK_TITLE_SECONDS).toBe(3);
  });

  it('accepts a title at exactly the word and character limits', () => {
    expect(checkHookTitle('one two three four five six seven')).toBeNull();
    expect(checkHookTitle('a'.repeat(HOOK_TITLE_MAX_CHARS))).toBeNull();
  });

  it('refuses one word over the word limit', () => {
    expect(checkHookTitle('one two three four five six seven eight')).toBe(
      HOOK_TITLE_CODES.tooManyWords,
    );
  });

  it('refuses one character over the character limit', () => {
    expect(checkHookTitle('a'.repeat(HOOK_TITLE_MAX_CHARS + 1))).toBe(HOOK_TITLE_CODES.tooLong);
  });

  it('counts characters by code point, like the engine', () => {
    expect(checkHookTitle('🌊'.repeat(HOOK_TITLE_MAX_CHARS))).toBeNull();
    expect(checkHookTitle('🌊'.repeat(HOOK_TITLE_MAX_CHARS + 1))).toBe(HOOK_TITLE_CODES.tooLong);
  });

  it('refuses an empty or blank title instead of treating it as absent', () => {
    expect(checkHookTitle('')).toBe(HOOK_TITLE_CODES.empty);
    expect(checkHookTitle('   ')).toBe(HOOK_TITLE_CODES.empty);
  });

  it('refuses a newline, a tab and any other control character', () => {
    expect(checkHookTitle('line one\nline two')).toBe(HOOK_TITLE_CODES.invalidChars);
    expect(checkHookTitle('tab\there')).toBe(HOOK_TITLE_CODES.invalidChars);
    expect(checkHookTitle('bell\u0007')).toBe(HOOK_TITLE_CODES.invalidChars);
  });

  it('measures the collapsed form, so extra spaces never count', () => {
    expect(checkHookTitle(`  ${'a '.repeat(7)}  `)).toBeNull();
    expect(normalizeHookTitle('  a   b  ')).toBe('a b');
  });

  it('keeps punctuation and case as written', () => {
    expect(normalizeHookTitle('I entered the sea clothed?')).toBe('I entered the sea clothed?');
  });

  it('has a message for every code', () => {
    for (const code of Object.values(HOOK_TITLE_CODES)) {
      expect(hookTitleMessage(code)).toContain('hook title');
      expect(hookTitleIssueMessage(code).startsWith(`${code}: `)).toBe(true);
    }
  });
});
