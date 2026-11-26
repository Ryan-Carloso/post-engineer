export const TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialStatus {
  endsAt: string;
  active: boolean;
  daysLeft: number;
}

export function computeTrialStatus(endsAt: string, now: Date): TrialStatus {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) {
    throw new Error(`trial_ends_at is not a valid timestamp: ${endsAt}`);
  }
  const remainingMs = end - now.getTime();
  return {
    endsAt,
    active: remainingMs > 0,
    daysLeft: remainingMs > 0 ? Math.ceil(remainingMs / DAY_MS) : 0,
  };
}
