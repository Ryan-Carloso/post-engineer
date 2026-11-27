export const TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due'];

export type AccessReason = 'trial' | 'subscription' | 'none';

export interface AccessStatus {
  endsAt: string;
  active: boolean;
  daysLeft: number;
  reason: AccessReason;
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function accessReasonOf(subscriptionStatus: string | null): AccessReason {
  if (subscriptionStatus === null) return 'trial';
  if (!isSubscriptionStatus(subscriptionStatus)) {
    throw new Error(`unknown subscription_status: ${subscriptionStatus}`);
  }
  return ENTITLED_SUBSCRIPTION_STATUSES.includes(subscriptionStatus) ? 'subscription' : 'none';
}

export function computeAccessStatus(
  row: { accessUntil: string; subscriptionStatus: string | null },
  now: Date,
): AccessStatus {
  const end = Date.parse(row.accessUntil);
  if (Number.isNaN(end)) {
    throw new Error(`access_until is not a valid timestamp: ${row.accessUntil}`);
  }
  const remainingMs = end - now.getTime();
  return {
    endsAt: row.accessUntil,
    active: remainingMs > 0,
    daysLeft: remainingMs > 0 ? Math.ceil(remainingMs / DAY_MS) : 0,
    reason: accessReasonOf(row.subscriptionStatus),
  };
}
