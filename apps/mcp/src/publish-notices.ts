export function noticeSummary(userNotices: unknown[]): string {
  const lines: string[] = [];
  for (const item of userNotices) {
    if (typeof item !== 'object' || item === null) continue;
    const notice = (item as { notice?: unknown }).notice;
    if (typeof notice === 'string' && notice.length > 0) lines.push(notice);
  }
  if (lines.length === 0) return '';
  return ` ${lines.join(' ')} Only the user can fix this account. Do not retry.`;
}
