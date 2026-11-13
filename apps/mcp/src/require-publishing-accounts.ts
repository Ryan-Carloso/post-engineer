//---------------
// requirePublishingAccounts — the client-side half of issue #572: a
// persona is born bound to at least one publishing account. Checked
// before any file is read, so a call the server would reject fails fast
// here instead of uploading bytes first. Returns the map unchanged so
// the caller can set it on the form in the same expression.
//---------------
export function requirePublishingAccounts(
  accounts: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const total = Object.values(accounts ?? {}).reduce(
    (sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0),
    0,
  );
  if (total === 0) {
    throw new Error(
      'Select at least one publishing account for this persona: pass accounts, e.g. { youtube: ["UC..."] }. Account IDs come from list_social_accounts.',
    );
  }
  return accounts ?? {};
}
