import { FIRST_COMMENT_FIELD, isFirstCommentWarningCode, type FirstCommentWarningCode } from '@/lib/contracts/first-comment';
import { isCommentProvider } from '@/lib/contracts/providers';

export function appendFirstComment(formData: FormData, provider: string, text: string | null | undefined): void {
  if (text === null || text === undefined || text === '') return;
  if (!isCommentProvider(provider)) return;
  formData.append(FIRST_COMMENT_FIELD, text);
}

export function narrowFirstCommentWarnings(value: unknown): FirstCommentWarningCode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isFirstCommentWarningCode);
}
