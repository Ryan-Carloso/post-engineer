import { isFirstCommentWarningCode, type FirstCommentWarningCode } from '@/lib/contracts/first-comment';

export interface FirstCommentOutcomeWarning {
  provider: string;
  accountId: string;
  code: FirstCommentWarningCode;
}

export function commentWarningsFromOutcomes(raw: unknown): FirstCommentOutcomeWarning[] {
  if (!Array.isArray(raw)) return [];
  const found: FirstCommentOutcomeWarning[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const row: Record<string, unknown> = { ...item };
    if (row.status !== 'published' || !Array.isArray(row.warnings)) continue;
    const provider = typeof row.provider === 'string' ? row.provider : '';
    const accountId = typeof row.accountId === 'string' ? row.accountId : '';
    for (const code of row.warnings) {
      if (!isFirstCommentWarningCode(code)) continue;
      const key = `${provider}:${accountId}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ provider, accountId, code });
    }
  }
  return found;
}
