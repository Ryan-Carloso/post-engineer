import { z } from 'zod';
import {
  HOOK_TITLE_MAX_CHARS,
  HOOK_TITLE_MAX_WORDS,
  HOOK_TITLE_SECONDS,
  checkHookTitle,
  hookTitleIssueMessage,
} from './hook-title.js';

export const hookTitleField = z
  .string()
  .superRefine((value, ctx) => {
    const code = checkHookTitle(value);
    if (code !== null) ctx.addIssue({ code: 'custom', message: hookTitleIssueMessage(code) });
  })
  .describe(
    `Optional on-screen headline shown at the top of the video for its first ${HOOK_TITLE_SECONDS} seconds (less when the first segment is shorter), above any photos: at most ${HOOK_TITLE_MAX_WORDS} words and ${HOOK_TITLE_MAX_CHARS} characters, no newline or control character. Punctuation and case are kept as written. The engine sets it in at most two lines and moves the captions below it while it shows. A title that does not fit is left out and reported as a media warning; a title over the limits is refused with a stable HOOK_TITLE_* code before any token is charged.`,
  );
