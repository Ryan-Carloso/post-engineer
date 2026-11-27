'use client';

import { useQuery } from '@tanstack/react-query';
import { createSupabaseClient } from '@/lib/supabase/client';
import { computeAccessStatus, TRIAL_DAYS, type AccessStatus } from '@/lib/access-status';

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCESS_QUERY_KEY = ['access-status'] as const;

export async function fetchAccessStatus(now: () => Date = () => new Date()): Promise<AccessStatus | null> {
  const supabase = createSupabaseClient();
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(`access session lookup failed: ${sessionError.message}`);
  const userId = session.session?.user.id;
  if (userId === undefined) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('access_until,subscription_status')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`access lookup failed: ${error.message}`);
  const current = now();
  const accessUntil =
    data === null ? new Date(current.getTime() + TRIAL_DAYS * DAY_MS).toISOString() : data.access_until;
  return computeAccessStatus(
    { accessUntil, subscriptionStatus: data === null ? null : data.subscription_status },
    current,
  );
}

export function useAccessQuery() {
  return useQuery<AccessStatus | null>({
    queryKey: ACCESS_QUERY_KEY,
    queryFn: () => fetchAccessStatus(),
    staleTime: 5 * 60_000,
  });
}
