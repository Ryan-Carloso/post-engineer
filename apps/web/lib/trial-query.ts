'use client';

import { useQuery } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase/client';
import { computeTrialStatus, TRIAL_DAYS, type TrialStatus } from '@/lib/trial-status';

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_QUERY_KEY = ['trial-status'] as const;

export async function fetchTrialStatus(now: () => Date = () => new Date()): Promise<TrialStatus | null> {
  const supabase = createSupabaseClient();
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(`trial session lookup failed: ${sessionError.message}`);
  const userId = session.session?.user.id;
  if (userId === undefined) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('trial_ends_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`trial lookup failed: ${error.message}`);
  const current = now();
  const endsAt = data === null ? new Date(current.getTime() + TRIAL_DAYS * DAY_MS).toISOString() : data.trial_ends_at;
  return computeTrialStatus(endsAt, current);
}

export function useTrialStatusQuery() {
  return useQuery<TrialStatus | null>({
    queryKey: TRIAL_QUERY_KEY,
    queryFn: () => fetchTrialStatus(),
    staleTime: 5 * 60_000,
  });
}
