import { httpStatusOf } from '@/lib/account-break';
import type { FirstCommentWarningCode } from '@/lib/contracts/first-comment';
import type { CommentProvider } from '@/lib/contracts/providers';

const META_RECONNECT_CODES: ReadonlySet<number> = new Set([10, 190, 200, 299]);
const SCOPE_REASONS: ReadonlySet<string> = new Set([
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'PERMISSION_DENIED',
]);

function reasonOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('reason' in error)) return undefined;
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

function providerCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('providerCode' in error)) return undefined;
  const code = (error as { providerCode?: unknown }).providerCode;
  return typeof code === 'number' ? code : undefined;
}

export function classifyFirstCommentError(provider: CommentProvider, error: unknown): FirstCommentWarningCode {
  if (provider === 'telegram') return 'FIRST_COMMENT_FAILED';
  const status = httpStatusOf(error);
  if (status === 401) return 'FIRST_COMMENT_RECONNECT_REQUIRED';
  const reason = reasonOf(error);
  if (reason !== undefined && SCOPE_REASONS.has(reason)) return 'FIRST_COMMENT_RECONNECT_REQUIRED';
  if (provider === 'youtube') return 'FIRST_COMMENT_FAILED';
  if (status === 403) return 'FIRST_COMMENT_RECONNECT_REQUIRED';
  const providerCode = providerCodeOf(error);
  if (providerCode !== undefined && META_RECONNECT_CODES.has(providerCode)) return 'FIRST_COMMENT_RECONNECT_REQUIRED';
  return 'FIRST_COMMENT_FAILED';
}
