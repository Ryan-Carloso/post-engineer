import { checkFirstComment, FIRST_COMMENT_FIELD, type FirstCommentWarningCode } from '@/lib/contracts/first-comment';
import type { CommentProvider } from '@/lib/contracts/providers';
import { logger } from '@/lib/logger';
import { redactCredentialFragments } from '@/lib/scrub';
import { classifyFirstCommentError } from './classify';
import { exceedsFirstCommentLimit } from './limits';

export type FirstCommentRun = (text: string) => Promise<'posted' | 'unsupported_chat'>;

export type FirstCommentField = { ok: true; text: string | null } | { ok: false; error: string };

export function readFirstCommentField(formData: FormData): FirstCommentField {
  const raw = formData.get(FIRST_COMMENT_FIELD);
  const checked = checkFirstComment(raw);
  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, text: checked.value };
}

function messageOf(error: unknown): string {
  return redactCredentialFragments(error instanceof Error ? error.message : String(error));
}

export async function attemptFirstComment(
  context: { provider: CommentProvider; accountId: string; text: string | null },
  run: FirstCommentRun,
): Promise<{ warnings?: FirstCommentWarningCode[] }> {
  const { provider, accountId, text } = context;
  if (text === null) return {};
  if (exceedsFirstCommentLimit(provider, text)) {
    logger.warn('upload-content: first comment exceeds the network limit', { provider, accountId });
    return { warnings: ['FIRST_COMMENT_TOO_LONG'] };
  }
  try {
    const outcome = await run(text);
    if (outcome === 'unsupported_chat') {
      logger.warn('upload-content: first comment skipped, the chat has no linked discussion group', { provider, accountId });
      return { warnings: ['FIRST_COMMENT_UNSUPPORTED_CHAT'] };
    }
    return {};
  } catch (error) {
    const code = classifyFirstCommentError(provider, error);
    logger.warn('upload-content: first comment failed, the post stays published', {
      provider,
      accountId,
      code,
      error: messageOf(error),
    });
    return { warnings: [code] };
  }
}
