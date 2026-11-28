export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'beta',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due'];

export type AccessReason = 'beta' | 'subscription' | 'none';

export interface AccessStatus {
  endsAt: string;
  active: boolean;
  reason: AccessReason;
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export function accessReasonOf(subscriptionStatus: string | null): AccessReason {
  if (subscriptionStatus === null) return 'beta';
  if (!isSubscriptionStatus(subscriptionStatus)) {
    throw new Error(`unknown subscription_status: ${subscriptionStatus}`);
  }
  if (subscriptionStatus === 'beta') return 'beta';
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
  return {
    endsAt: row.accessUntil,
    active: end - now.getTime() > 0,
    reason: accessReasonOf(row.subscriptionStatus),
  };
}
