//---------------
// admin — the admin allowlist.
//
// Billing reconciliation review is a human decision, so it needs a human
// gate. ADMIN_USER_IDS is a comma-separated list of Supabase user ids;
// the sole operator sets it to their own id. Unset/empty = nobody is
// admin (fail closed).
//---------------

export function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function isAdminUser(userId: string): boolean {
  return adminUserIds().includes(userId);
}
