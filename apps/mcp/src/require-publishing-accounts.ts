export function requirePublishingAccounts(
  accounts: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const total = Object.values(accounts ?? {}).reduce(
    (sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0),
    0,
  );
  if (total === 0) {
    throw new Error(
      'Select at least one publishing account for this persona: pass accounts, e.g. { youtube: ["UC..."] }. Account IDs come from accounts (action: list).',
    );
  }
  return accounts ?? {};
}
